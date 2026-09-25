/**
 * Human control over the AI systems in lib/aiSystems.ts: administrator on/off switches, the challenge
 * process for people who think an AI decision about them was wrong, and outcome monitoring.
 *
 * All three are stored as events in the hash-chained audit log rather than in tables of their own: who
 * switched a model off, who challenged what, and how it was resolved are exactly the records Team 2's
 * accountability framework asks to keep, and the audit log already makes them tamper-evident. The
 * behaviour model excludes these event types from training (META_EVENT_TYPES in behaviorModel.ts).
 */
import { and, count, desc, eq, gte, inArray, like } from "drizzle-orm";
import { db, securityLogsTable } from "@workspace/db";
import { recordEvent, type AuditEventType } from "./auditLog";
import { AI_SYSTEMS, isAiSystemId, type AiSystemId } from "./aiSystems";

export interface Actor {
  userId: number;
  email: string;
  ip: string;
  userAgent: string | undefined;
}

// ── On/off switches ─────────────────────────────────────────────────────────────────────────────────

const TOGGLE_DETAILS = /^system=([a-z-]+); enabled=(true|false); reason=([\s\S]*)$/;

export interface AiSystemState {
  enabled: boolean;
  changedAt: string | null;
  changedBy: string | null;
  reason: string | null;
}

// Short enough that a switch takes effect almost at once; long enough that a busy endpoint doesn't
// re-read the log on every request.
const STATE_CACHE_MS = 5000;
let stateCache: { at: number; states: Map<AiSystemId, AiSystemState> } | null = null;

export async function aiSystemStates(): Promise<Map<AiSystemId, AiSystemState>> {
  if (stateCache && Date.now() - stateCache.at < STATE_CACHE_MS) return stateCache.states;
  const rows = await db
    .select({ details: securityLogsTable.details, userEmail: securityLogsTable.userEmail, timestamp: securityLogsTable.timestamp })
    .from(securityLogsTable)
    .where(eq(securityLogsTable.eventType, "AI_SYSTEM_TOGGLED"))
    .orderBy(desc(securityLogsTable.timestamp), desc(securityLogsTable.id))
    .limit(500);
  const states = new Map<AiSystemId, AiSystemState>(AI_SYSTEMS.map((s) => [s.id, { enabled: true, changedAt: null, changedBy: null, reason: null }]));
  const settled = new Set<string>();
  for (const row of rows) {
    const m = TOGGLE_DETAILS.exec(row.details);
    if (!m || !isAiSystemId(m[1]!) || settled.has(m[1]!)) continue;
    settled.add(m[1]!);
    states.set(m[1]!, { enabled: m[2] === "true", changedAt: row.timestamp.toISOString(), changedBy: row.userEmail, reason: m[3]! });
  }
  stateCache = { at: Date.now(), states };
  return states;
}

/** The switch a model checks before it runs. */
export async function isAiSystemEnabled(id: AiSystemId): Promise<boolean> {
  return (await aiSystemStates()).get(id)?.enabled ?? true;
}

export async function setAiSystemEnabled(id: AiSystemId, enabled: boolean, reason: string, actor: Actor): Promise<void> {
  await recordEvent({
    eventType: "AI_SYSTEM_TOGGLED",
    details: `system=${id}; enabled=${enabled}; reason=${reason}`,
    userId: actor.userId,
    userEmail: actor.email,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
  stateCache = null;
}

// ── Challenges ──────────────────────────────────────────────────────────────────────────────────────

const CHALLENGE_DETAILS = /^system=([a-z-]+); ref=([^;]*); message=([\s\S]*)$/;
const RESOLUTION_DETAILS = /^challenge=(\d+); outcome=(upheld|not-upheld); note=([\s\S]*)$/;

export type ChallengeOutcome = "upheld" | "not-upheld";

export interface AiChallenge {
  id: number;
  systemId: AiSystemId;
  systemName: string;
  reference: string | null;
  message: string;
  submittedAt: string;
  submittedBy: string | null;
  status: "open" | "resolved";
  outcome: ChallengeOutcome | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export async function submitChallenge(systemId: AiSystemId, reference: string | null, message: string, actor: Actor): Promise<number> {
  return recordEvent({
    eventType: "AI_DECISION_CHALLENGED",
    details: `system=${systemId}; ref=${reference ?? ""}; message=${message}`,
    userId: actor.userId,
    userEmail: actor.email,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}

/** Every challenge, or one account's own, newest first, each with its resolution if it has one. */
export async function listChallenges(onlyUserId?: number): Promise<AiChallenge[]> {
  const filed = await db
    .select({ id: securityLogsTable.id, details: securityLogsTable.details, userEmail: securityLogsTable.userEmail, timestamp: securityLogsTable.timestamp })
    .from(securityLogsTable)
    .where(onlyUserId === undefined
      ? eq(securityLogsTable.eventType, "AI_DECISION_CHALLENGED")
      : and(eq(securityLogsTable.eventType, "AI_DECISION_CHALLENGED"), eq(securityLogsTable.userId, onlyUserId)))
    .orderBy(desc(securityLogsTable.id))
    .limit(200);
  if (filed.length === 0) return [];

  const resolutions = await db
    .select({ details: securityLogsTable.details, userEmail: securityLogsTable.userEmail, timestamp: securityLogsTable.timestamp })
    .from(securityLogsTable)
    .where(eq(securityLogsTable.eventType, "AI_CHALLENGE_RESOLVED"))
    .orderBy(securityLogsTable.id);
  const resolvedBy = new Map<number, { outcome: ChallengeOutcome; note: string; at: string; by: string | null }>();
  for (const r of resolutions) {
    const m = RESOLUTION_DETAILS.exec(r.details);
    // The first resolution recorded is the decision; a later one from a simultaneous review is ignored.
    if (m && !resolvedBy.has(Number(m[1]))) resolvedBy.set(Number(m[1]), { outcome: m[2] as ChallengeOutcome, note: m[3]!, at: r.timestamp.toISOString(), by: r.userEmail });
  }

  const challenges: AiChallenge[] = [];
  for (const row of filed) {
    const m = CHALLENGE_DETAILS.exec(row.details);
    if (!m || !isAiSystemId(m[1]!)) continue;
    const resolution = resolvedBy.get(row.id);
    challenges.push({
      id: row.id,
      systemId: m[1]!,
      systemName: AI_SYSTEMS.find((s) => s.id === m[1])!.name,
      reference: m[2] || null,
      message: m[3]!,
      submittedAt: row.timestamp.toISOString(),
      submittedBy: row.userEmail,
      status: resolution ? "resolved" : "open",
      outcome: resolution?.outcome ?? null,
      resolutionNote: resolution?.note ?? null,
      resolvedAt: resolution?.at ?? null,
      resolvedBy: resolution?.by ?? null,
    });
  }
  return challenges;
}

export class ChallengeNotFoundError extends Error {}
export class ChallengeAlreadyResolvedError extends Error {}

export async function resolveChallenge(challengeId: number, outcome: ChallengeOutcome, note: string, actor: Actor): Promise<void> {
  const [filed] = await db
    .select({ id: securityLogsTable.id })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.id, challengeId), eq(securityLogsTable.eventType, "AI_DECISION_CHALLENGED")));
  if (!filed) throw new ChallengeNotFoundError();
  const [existing] = await db
    .select({ id: securityLogsTable.id })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.eventType, "AI_CHALLENGE_RESOLVED"), like(securityLogsTable.details, `challenge=${challengeId}; %`)))
    .limit(1);
  if (existing) throw new ChallengeAlreadyResolvedError();
  await recordEvent({
    eventType: "AI_CHALLENGE_RESOLVED",
    details: `challenge=${challengeId}; outcome=${outcome}; note=${note}`,
    userId: actor.userId,
    userEmail: actor.email,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}

// ── Monitoring ──────────────────────────────────────────────────────────────────────────────────────

const MONITORED_EVENTS: AuditEventType[] = [
  "LOGIN_FACE_SUCCESS",
  "LOGIN_FACE_FAILED",
  "LOGIN_SUCCESS",
  "LOGIN_RISK_FLAGGED",
  "BEHAVIOR_MODEL_QUERIED",
  "CONTENT_PROFILE_QUERIED",
  "SECURITY_ALERT_NOTIFIED",
  "AI_DECISION_CHALLENGED",
];

export interface AiOutcomeWindow {
  days: number;
  faceScans: number;
  faceScanFailures: number;
  passwordSignIns: number;
  signInsFlagged: number;
  suggestionQueries: number;
  suggestionsShown: number;
  profileQueries: number;
  securityAlerts: number;
  challengesFiled: number;
}

async function outcomeWindow(days: number): Promise<AiOutcomeWindow> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ eventType: securityLogsTable.eventType, n: count() })
    .from(securityLogsTable)
    .where(and(gte(securityLogsTable.timestamp, since), inArray(securityLogsTable.eventType, MONITORED_EVENTS)))
    .groupBy(securityLogsTable.eventType);
  const n = (t: AuditEventType) => Number(rows.find((r) => r.eventType === t)?.n ?? 0);
  const [shown] = await db
    .select({ n: count() })
    .from(securityLogsTable)
    .where(and(gte(securityLogsTable.timestamp, since), eq(securityLogsTable.eventType, "BEHAVIOR_MODEL_QUERIED"), like(securityLogsTable.details, "suggested %")));
  return {
    days,
    faceScans: n("LOGIN_FACE_SUCCESS") + n("LOGIN_FACE_FAILED"),
    faceScanFailures: n("LOGIN_FACE_FAILED"),
    passwordSignIns: n("LOGIN_SUCCESS"),
    signInsFlagged: n("LOGIN_RISK_FLAGGED"),
    suggestionQueries: n("BEHAVIOR_MODEL_QUERIED"),
    suggestionsShown: Number(shown?.n ?? 0),
    profileQueries: n("CONTENT_PROFILE_QUERIED"),
    securityAlerts: n("SECURITY_ALERT_NOTIFIED"),
    challengesFiled: n("AI_DECISION_CHALLENGED"),
  };
}

export async function aiMonitoring(): Promise<AiOutcomeWindow[]> {
  return Promise.all([outcomeWindow(7), outcomeWindow(30)]);
}
