/**
 * Trains only on security_logs event-type sequences, never on upload
 * content — uploads are AES-256-GCM encrypted so only the owner can read
 * them, and decrypting content server-side to train on it would regress
 * that guarantee. Event types are already plaintext operational metadata.
 *
 * Predicts the next action using a 2nd-order Markov chain (last two events)
 * when there's enough evidence, falling back to 1st-order (last event only)
 * otherwise — never a hard failure, always a step down to the next-best
 * evidence.
 */

import { and, asc, eq, inArray, desc, notInArray } from "drizzle-orm";
import { db, securityLogsTable, usersTable } from "@workspace/db";
import { MAX_CONTRIBUTED_TRANSITIONS_PER_USER } from "./behaviorModelPrivacy";

// Excluded from both training and "last event" lookups: including these
// would make querying the model become the new "last event" (the widget
// would go permanently blank after the first call) and would teach the
// model to predict "query the model" as a next action.
// The AI governance events are excluded for the same reason: challenging a suggestion or switching a
// model off is a reaction to the model, not behaviour for it to learn and suggest.
const META_EVENT_TYPES: string[] = ["BEHAVIOR_MODEL_QUERIED", "AI_SYSTEM_TOGGLED", "AI_DECISION_CHALLENGED", "AI_CHALLENGE_RESOLVED", "PRIVACY_POLICY_ACKNOWLEDGED"];

// Anti-poisoning cap: limits how many of one user's transitions can enter
// a single training-corpus build, so a hyperactive account can't dominate
// what the model learns.
export const MAX_TRANSITIONS_PER_USER = 50;

// Memorisation/leakage defense: a transition is only surfaced as a
// prediction if seen from at least this many DISTINCT users, not just
// occurrences. Applied to the 2nd-order table too — a narrower 2-event
// context is if anything more likely to be unique to one user, not less.
export const MIN_DISTINCT_USERS = 3;

export interface TrainingRecord {
  userId: number;
  sequence: string[]; // eventType, chronological order
}

export interface BehaviorTransitionModel {
  // "fromEvent" -> "toEvent" -> count of DISTINCT users who exhibited it
  transitionsOrder1: Map<string, Map<string, number>>;
  // "eventBefore=>eventJustNow" -> "toEvent" -> distinct-user count
  transitionsOrder2: Map<string, Map<string, number>>;
  usersIncluded: number;
  transitionsObserved: number;
  builtAt: Date;
}

/** Only users.trainingConsentGiven === true contribute. Nothing is
 *  persisted: every call re-reads current consent fresh, so withdrawing
 *  consent (or deleting the account) is immediately reflected with no
 *  stale trained artifact anywhere retaining that user's contribution. */
export async function buildTrainingCorpus(): Promise<TrainingRecord[]> {
  const consentedUsers = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.trainingConsentGiven, true));
  if (consentedUsers.length === 0) return [];
  const userIds = consentedUsers.map((u) => u.id);

  const rows = await db
    .select({ userId: securityLogsTable.userId, eventType: securityLogsTable.eventType })
    .from(securityLogsTable)
    .where(and(inArray(securityLogsTable.userId, userIds), notInArray(securityLogsTable.eventType, META_EVENT_TYPES)))
    // Same tie-break reason as getRecentEventTypes below, but this one shapes
    // what the model LEARNS rather than what it's asked about: two same-
    // millisecond events ordered arbitrarily would record a transition in a
    // direction that never happened, and it would be counted as real evidence
    // toward the MIN_DISTINCT_USERS bar.
    .orderBy(asc(securityLogsTable.timestamp), asc(securityLogsTable.id));

  return assembleTrainingCorpus(rows, new Set(userIds));
}

export interface AuditEventRow {
  userId: number | null;
  eventType: string;
}

/** The consent gate, meta-event exclusion and per-user cap, applied to
 *  audit rows already in chronological order. buildTrainingCorpus() filters
 *  consent and meta events in SQL too; applying them here as well keeps this
 *  the one place the corpus rules live, so lib/aiSecurityValidation.ts can
 *  exercise exactly these rules with synthetic rows. */
export function assembleTrainingCorpus(rows: AuditEventRow[], consentedUserIds: ReadonlySet<number>): TrainingRecord[] {
  const byUser = new Map<number, string[]>();
  for (const row of rows) {
    if (row.userId === null || !consentedUserIds.has(row.userId) || META_EVENT_TYPES.includes(row.eventType)) continue;
    const seq = byUser.get(row.userId) ?? [];
    if (seq.length >= MAX_TRANSITIONS_PER_USER) continue;
    seq.push(row.eventType);
    byUser.set(row.userId, seq);
  }

  return Array.from(byUser.entries()).map(([userId, sequence]) => ({ userId, sequence }));
}

function recordTransition(table: Map<string, Map<string, number>>, from: string, to: string): void {
  if (!table.has(from)) table.set(from, new Map());
  const toMap = table.get(from)!;
  toMap.set(to, (toMap.get(to) ?? 0) + 1);
}

/** Deduplicates per user, per table, before counting — a user contributes
 *  at most one vote to any given transition, no matter how many times
 *  they personally exhibited it (see MIN_DISTINCT_USERS above). */
export function train(records: TrainingRecord[]): BehaviorTransitionModel {
  const transitionsOrder1 = new Map<string, Map<string, number>>();
  const transitionsOrder2 = new Map<string, Map<string, number>>();
  let transitionsObserved = 0;

  for (const record of records) {
    const seenOrder1 = new Set<string>();
    const seenOrder2 = new Set<string>();

    for (let i = 0; i < record.sequence.length - 1; i++) {
      const from = record.sequence[i]!;
      const to = record.sequence[i + 1]!;

      const key1 = `${from}=>${to}`;
      // The cap is on DISTINCT transitions, which is a different bound from
      // MAX_TRANSITIONS_PER_USER's cap on raw events: that one limits how
      // much history one account contributes, this limits how many separate
      // patterns it can influence — the thing that actually moves
      // predictions. It is also the L1 sensitivity the DP analysis in
      // behaviorModelPrivacy.ts depends on; that guarantee is undefinable
      // without a bound here.
      if (!seenOrder1.has(key1) && seenOrder1.size < MAX_CONTRIBUTED_TRANSITIONS_PER_USER) {
        seenOrder1.add(key1);
        recordTransition(transitionsOrder1, from, to);
        transitionsObserved += 1;
      }

      if (i >= 1) {
        const context = `${record.sequence[i - 1]!}=>${from}`;
        const key2 = `${context}=>${to}`;
        if (!seenOrder2.has(key2) && seenOrder2.size < MAX_CONTRIBUTED_TRANSITIONS_PER_USER) {
          seenOrder2.add(key2);
          recordTransition(transitionsOrder2, context, to);
        }
      }
    }
  }

  return { transitionsOrder1, transitionsOrder2, usersIncluded: records.length, transitionsObserved, builtAt: new Date() };
}

export interface Prediction {
  eventType: string;
  distinctUsers: number;
  // 2 = the two-event context had enough evidence; 1 = fell back to the
  // single-last-event table.
  contextDepth: 1 | 2;
}

function bestCandidate(candidates: Map<string, number> | undefined): { eventType: string; distinctUsers: number } | null {
  if (!candidates) return null;
  let best: { eventType: string; distinctUsers: number } | null = null;
  for (const [eventType, count] of candidates) {
    if (count < MIN_DISTINCT_USERS) continue;
    if (!best || count > best.distinctUsers) best = { eventType, distinctUsers: count };
  }
  return best;
}

/** Tries the 2nd-order (two-event-context) table first, falls back to
 *  1st-order. Returns null only when neither table clears
 *  MIN_DISTINCT_USERS — refusing rather than guessing from thin evidence. */
export function predictNext(model: BehaviorTransitionModel, previousEvent: string | null, lastEvent: string): Prediction | null {
  if (previousEvent) {
    const context = `${previousEvent}=>${lastEvent}`;
    const order2 = bestCandidate(model.transitionsOrder2.get(context));
    if (order2) return { ...order2, contextDepth: 2 };
  }
  const order1 = bestCandidate(model.transitionsOrder1.get(lastEvent));
  if (order1) return { ...order1, contextDepth: 1 };
  return null;
}

export interface RecentEvents {
  lastEvent: string | null;
  previousEvent: string | null;
}

/** previousEvent is null for an account with fewer than two qualifying
 *  events, in which case predictNext falls back to 1st-order. */
export async function getRecentEventTypes(userId: number): Promise<RecentEvents> {
  const rows = await db
    .select({ eventType: securityLogsTable.eventType })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.userId, userId), notInArray(securityLogsTable.eventType, META_EVENT_TYPES)))
    // id breaks the tie when two events share a timestamp: Postgres gives no
    // ordering guarantee between equal sort keys, so "the last two events"
    // could otherwise come back reversed and produce a prediction from a
    // context that never actually happened in that order. Timestamps collide
    // more often than they look like they would — two writes inside the same
    // millisecond is routine for actions the app itself chains together.
    .orderBy(desc(securityLogsTable.timestamp), desc(securityLogsTable.id))
    .limit(2);
  return { lastEvent: rows[0]?.eventType ?? null, previousEvent: rows[1]?.eventType ?? null };
}
