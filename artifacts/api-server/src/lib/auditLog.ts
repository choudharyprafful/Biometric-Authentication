import crypto from "node:crypto";
import { asc, desc, gte, sql, count as sqlCount } from "drizzle-orm";
import { db, securityLogsTable } from "@workspace/db";

export type AuditEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGIN_FACE_SUCCESS"
  | "LOGIN_FACE_FAILED"
  | "LOGIN_PASSKEY_SUCCESS"
  | "LOGIN_PASSKEY_FAILED"
  | "PASSKEY_ENROLLED"
  | "PASSKEY_REMOVED"
  | "DEVICE_LINK_CODE_CREATED"
  | "DEVICE_LINK_REDEEMED"
  | "LOGOUT"
  | "LOGOUT_ALL"
  | "REGISTER"
  | "FACE_ENROLLED"
  | "FACE_REMOVED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_FACE_FAILED"
  | "PASSWORD_RESET_PASSKEY_FAILED"
  | "PASSWORD_RESET_COMPLETED"
  | "USER_DELETED"
  | "USER_UPDATED"
  | "MFA_RESET_BY_STAFF"
  | "PAYMENT_CREATED"
  | "PAYMENT_FAILED"
  | "SUBSCRIPTION_CHANGED"
  | "PAYMENT_WEBHOOK_RECEIVED"
  | "PAYMENT_WEBHOOK_REJECTED"
  | "UPLOAD_CREATED"
  | "UPLOAD_DOWNLOADED"
  | "UPLOAD_DELETED"
  | "UPLOAD_SCAN_REJECTED"
  | "UPLOAD_SCAN_UNAVAILABLE"
  | "UNAUTHORIZED_ACCESS"
  | "RATE_LIMIT_HIT"
  | "AUDIT_LOG_CHAIN_REPAIRED"
  | "AUDIT_LOG_CHAIN_RESTORED"
  | "MINOR_REGISTRATION_PENDING_CONSENT"
  | "PARENT_CONSENT_GRANTED"
  | "TRAINING_CONSENT_GIVEN"
  | "TRAINING_CONSENT_WITHDRAWN"
  | "BEHAVIOR_MODEL_QUERIED"
  | "SECURITY_ALERT_NOTIFIED"
  | "LOGIN_RISK_FLAGGED"
  | "CONTENT_PERSONALIZATION_CONSENT_GIVEN"
  | "CONTENT_PERSONALIZATION_CONSENT_WITHDRAWN"
  | "CONTENT_PROFILE_QUERIED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_IDEMPOTENT_REPLAY"
  | "TRAINING_SOURCE_REJECTED"
  | "AI_SYSTEM_TOGGLED"
  | "AI_DECISION_CHALLENGED"
  | "AI_CHALLENGE_RESOLVED"
  | "PAYMENT_DISPUTED"
  | "PAYMENT_DISPUTE_WON"
  | "PAYMENT_CHARGED_BACK"
  | "PAYMENT_HOLD_PLACED"
  | "PAYMENT_HOLD_CLEARED"
  | "PAYMENT_WEBHOOK_IGNORED"
  | "SESSION_LIMIT_ENFORCED"
  | "PRIVACY_POLICY_ACKNOWLEDGED"
  | "DATA_EXPORTED";

// Fixed anchor for the first row, so "no previous hash" is a checkable
// value instead of null.
const GENESIS_HASH = "GENESIS";

interface LogContent {
  eventType: string;
  details: string;
  userId: number | null;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
}

// Delimiter-based so it's deterministic (no JSON key-order issues). The
// timestamp is set here in app code, not via defaultNow(), so it's part
// of the hashed content and can't be backdated after the fact.
function serialize(content: LogContent): string {
  return [content.eventType, content.details, content.userId ?? "", content.userEmail ?? "", content.ipAddress ?? "", content.userAgent ?? "", content.timestamp].join("|");
}

function computeHash(prevHash: string, content: LogContent): string {
  return crypto.createHash("sha256").update(`${prevHash}|${serialize(content)}`).digest("hex");
}

// Serializes writes so two concurrent logEvent calls can't both read the
// same prevHash and fork the chain. doLogEvent swallows its own errors,
// so this promise chain never ends up permanently rejected.
let writeQueue: Promise<unknown> = Promise.resolve();

interface LogEventParams {
  eventType: AuditEventType;
  details: string;
  userId?: number | null;
  userEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function logEvent(params: LogEventParams): Promise<void> {
  const next = writeQueue.then(() => doLogEvent(params));
  writeQueue = next;
  return next;
}

/** Same chained write as logEvent, for events that ARE the record (an AI challenge, a model switched
 *  off): resolves to the new row's id and rejects if the write failed, so the caller never reports
 *  success for something that was not stored. */
export function recordEvent(params: LogEventParams): Promise<number> {
  const next = writeQueue.then(() => insertEvent(params));
  writeQueue = next.catch(() => {});
  return next;
}

async function doLogEvent(params: LogEventParams): Promise<void> {
  try {
    await insertEvent(params);
  } catch {
    // Never let audit logging crash the main flow
  }
}

async function insertEvent(params: LogEventParams): Promise<number> {
  const [lastRow] = await db.select({ hash: securityLogsTable.hash }).from(securityLogsTable).orderBy(desc(securityLogsTable.id)).limit(1);
  const prevHash = lastRow?.hash ?? GENESIS_HASH;

  const content: LogContent = {
    eventType: params.eventType,
    details: params.details,
    userId: params.userId ?? null,
    userEmail: params.userEmail ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    timestamp: new Date().toISOString(),
  };
  const hash = computeHash(prevHash, content);

  const [inserted] = await db.insert(securityLogsTable).values({
    eventType: content.eventType,
    details: content.details,
    userId: content.userId,
    userEmail: content.userEmail,
    ipAddress: content.ipAddress,
    userAgent: content.userAgent,
    timestamp: new Date(content.timestamp),
    prevHash,
    hash,
  }).returning({ id: securityLogsTable.id });
  return inserted!.id;
}

export interface ChainVerificationResult {
  valid: boolean;
  rowsChecked: number;
  brokenAtId: number | null;
  reason: string | null;
}

// Catches edits, deletions, inserts, and reordering. Rows from before the
// chain existed (hash/prevHash null) are skipped.
export async function verifyLogChain(): Promise<ChainVerificationResult> {
  const rows = await db.select().from(securityLogsTable).orderBy(asc(securityLogsTable.id));

  let expectedPrevHash = GENESIS_HASH;
  let rowsChecked = 0;
  let chainStarted = false;

  for (const row of rows) {
    if (row.hash === null || row.prevHash === null) {
      if (chainStarted) {
        return { valid: false, rowsChecked, brokenAtId: row.id, reason: "Unchained row found after the chain had already started" };
      }
      continue; // pre-feature legacy row — not part of the chain
    }
    chainStarted = true;

    if (row.prevHash !== expectedPrevHash) {
      return { valid: false, rowsChecked, brokenAtId: row.id, reason: "prevHash does not match the preceding row's hash — a row was deleted, inserted, or reordered" };
    }

    const content: LogContent = {
      eventType: row.eventType,
      details: row.details,
      userId: row.userId,
      userEmail: row.userEmail,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      timestamp: row.timestamp.toISOString(),
    };
    const recomputed = computeHash(row.prevHash, content);
    if (recomputed !== row.hash) {
      return { valid: false, rowsChecked, brokenAtId: row.id, reason: "Stored hash does not match recomputed hash — row content was edited" };
    }

    expectedPrevHash = row.hash;
    rowsChecked += 1;
  }

  return { valid: true, rowsChecked, brokenAtId: null, reason: null };
}

export interface ChainRepairResult {
  repaired: boolean;
  removedCount: number;
  removedFromId: number | null;
  verification: ChainVerificationResult;
}

// A hash chain can prove tampering happened but can't undo it — there's no
// way to reconstruct a deleted row's original content from its hash alone.
// This is the fallback for what restoreLogChain() can't fix (edited-in-place
// rows, or deletions with no snapshot): quarantine the untrustworthy tail —
// keep the verified-good prefix, discard everything from the first broken
// row onward — and record the repair itself as a new, honest chain entry.
export async function repairLogChain(actor: { userId: number | null; userEmail: string | null; ipAddress: string | null; userAgent: string | null }): Promise<ChainRepairResult> {
  const before = await verifyLogChain();
  if (before.valid || before.brokenAtId === null) {
    return { repaired: false, removedCount: 0, removedFromId: null, verification: before };
  }

  const brokenAtId = before.brokenAtId;
  const [{ value: removedCount }] = await db.select({ value: sqlCount() }).from(securityLogsTable).where(gte(securityLogsTable.id, brokenAtId));

  // Tags this delete as app-initiated for the deletion-audit trigger.
  // set_config's third arg (true = "is_local") scopes it to this
  // transaction only, without string-interpolating the actor email into
  // raw SQL.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.actor_email', ${actor.userEmail ?? "unknown"}, true)`);
    await tx.delete(securityLogsTable).where(gte(securityLogsTable.id, brokenAtId));
  });

  await logEvent({
    eventType: "AUDIT_LOG_CHAIN_REPAIRED",
    details: `Hash chain was broken at log #${brokenAtId} (${before.reason}). Removed ${removedCount} untrustworthy row(s) (id >= ${brokenAtId}) rather than fabricate their content; the verified prefix up to log #${brokenAtId - 1} is preserved unchanged.`,
    userId: actor.userId,
    userEmail: actor.userEmail,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  const after = await verifyLogChain();
  return { repaired: true, removedCount, removedFromId: brokenAtId, verification: after };
}

export interface ChainRestoreResult {
  restored: boolean;
  restoredCount: number;
  restoredIds: number[];
  // Still-missing ids after restoring everything a snapshot exists for —
  // deleted before this audit trigger existed, most likely. Only
  // populated when the chain is still broken after restoring.
  unrecoverableIds: number[];
  verification: ChainVerificationResult;
}

// Row shape as captured by to_jsonb(OLD.*) in the deletion trigger — keys
// match the security_logs table's actual (snake_case) column names.
interface SecurityLogSnapshotRow {
  id: number;
  event_type: string;
  details: string;
  user_id: number | null;
  user_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: string;
  prev_hash: string | null;
  hash: string | null;
}

interface SecurityLogDeletionSnapshotRow extends Record<string, unknown> {
  deleted_log_id: number;
  row_snapshot: unknown;
  deleted_by_app_actor: string | null;
  deleted_by_db_role: string;
  deleted_by_client_addr: string | null;
  // Raw db.execute() passthrough doesn't apply drizzle's typed-query Date
  // parsing, so this can arrive as either — normalize with `new Date(...)`.
  deleted_at: Date | string;
}

// Whatever's still missing after a restore attempt is guaranteed to have
// no snapshot. Walks backward from the new break point to find exactly
// which id(s) those are, for a clearer message than just "still broken".
async function findUnrecoverableIds(afterBrokenAtId: number): Promise<number[]> {
  const unrecoverableIds: number[] = [];
  let probe = afterBrokenAtId - 1;
  while (probe > 0) {
    const [stillExists] = await db.select({ id: securityLogsTable.id }).from(securityLogsTable).where(sql`${securityLogsTable.id} = ${probe}`).limit(1);
    if (stillExists) break;
    unrecoverableIds.unshift(probe);
    probe -= 1;
  }
  return unrecoverableIds;
}

// Complements repairLogChain(): re-inserts the untrustworthy tail using
// independent pre-delete snapshots rather than fabricating content from
// the hash. Only fixes rows that are actually MISSING (deleted) — a row
// still present but edited in place has no delete event and therefore no
// snapshot; that case is left for repairLogChain to quarantine.
export async function restoreLogChain(actor: { userId: number | null; userEmail: string | null; ipAddress: string | null; userAgent: string | null }): Promise<ChainRestoreResult> {
  const before = await verifyLogChain();
  if (before.valid || before.brokenAtId === null) {
    return { restored: false, restoredCount: 0, restoredIds: [], unrecoverableIds: [], verification: before };
  }

  const brokenAtId = before.brokenAtId;

  // verifyLogChain's brokenAtId is the SURVIVING row right after a gap —
  // not the id of the deleted row itself, which is earlier. So this asks
  // directly, position-independent: "which ids have a deletion snapshot
  // but are no longer in security_logs at all?" — covers every gap,
  // including multiple non-contiguous ones, in one pass.
  const recoverable = await db.execute<SecurityLogDeletionSnapshotRow>(sql`
    SELECT DISTINCT ON (d.deleted_log_id)
      d.deleted_log_id, d.row_snapshot, d.deleted_by_app_actor, d.deleted_by_db_role, d.deleted_by_client_addr, d.deleted_at
    FROM security_log_deletions d
    WHERE NOT EXISTS (SELECT 1 FROM security_logs s WHERE s.id = d.deleted_log_id)
    ORDER BY d.deleted_log_id, d.deleted_at DESC
  `);

  if (recoverable.rows.length === 0) {
    // Either the break wasn't caused by a deletion (edited in place), or
    // it predates this audit trigger and so has no snapshot.
    return { restored: false, restoredCount: 0, restoredIds: [], unrecoverableIds: [], verification: before };
  }

  const restoredIds: number[] = [];
  const attributions: string[] = [];

  for (const snapshot of recoverable.rows) {
    const row = snapshot.row_snapshot as unknown as SecurityLogSnapshotRow;
    const id = snapshot.deleted_log_id;

    await db.execute(sql`
      INSERT INTO security_logs (id, event_type, details, user_id, user_email, ip_address, user_agent, "timestamp", prev_hash, hash)
      OVERRIDING SYSTEM VALUE
      VALUES (${row.id}, ${row.event_type}, ${row.details}, ${row.user_id}, ${row.user_email}, ${row.ip_address}, ${row.user_agent}, ${row.timestamp}, ${row.prev_hash}, ${row.hash})
      ON CONFLICT (id) DO NOTHING
    `);

    restoredIds.push(id);
    const who = snapshot.deleted_by_app_actor ? snapshot.deleted_by_app_actor : `db role "${snapshot.deleted_by_db_role}"`;
    const from = snapshot.deleted_by_client_addr ? ` from ${snapshot.deleted_by_client_addr}` : "";
    attributions.push(`#${id} (deleted ${new Date(snapshot.deleted_at).toISOString()} by ${who}${from})`);
  }

  if (restoredIds.length > 0) {
    // OVERRIDING SYSTEM VALUE inserts don't advance the id sequence — without
    // this, the next normal logEvent() insert could try to reuse an id we
    // just restored.
    await db.execute(sql`SELECT setval(pg_get_serial_sequence('security_logs', 'id'), (SELECT MAX(id) FROM security_logs))`);
  }

  const after = await verifyLogChain();
  const unrecoverableIds = !after.valid && after.brokenAtId !== null ? await findUnrecoverableIds(after.brokenAtId) : [];

  const unrecoverableNote = unrecoverableIds.length > 0
    ? ` ${unrecoverableIds.length} row(s) had no deletion snapshot available (id ${unrecoverableIds.join(", ")}) and remain missing — likely deleted before this audit trigger existed.`
    : "";

  await logEvent({
    eventType: "AUDIT_LOG_CHAIN_RESTORED",
    details: `Hash chain was broken at log #${brokenAtId} (${before.reason}). Restored ${restoredIds.length} row(s) from independent pre-deletion snapshots captured by the database trigger: ${attributions.join("; ") || "none"}.${unrecoverableNote}`,
    userId: actor.userId,
    userEmail: actor.userEmail,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return { restored: restoredIds.length > 0, restoredCount: restoredIds.length, restoredIds, unrecoverableIds, verification: after };
}

export interface DeletionAuditEntry {
  id: number;
  deletedLogId: number;
  eventType: string | null;
  details: string | null;
  deletedByAppActor: string | null;
  deletedByDbRole: string;
  deletedByClientAddr: string | null;
  deletedAt: string;
  // Whether a row now sits at this id again — either restored via
  // restoreLogChain(), or (much less likely) a coincidental new row that
  // happened to land on the same id after the sequence advanced past it.
  currentlyRestored: boolean;
}

interface DeletionAuditRow extends Record<string, unknown> {
  id: number;
  deleted_log_id: number;
  event_type: string | null;
  details: string | null;
  deleted_by_app_actor: string | null;
  deleted_by_db_role: string;
  deleted_by_client_addr: string | null;
  deleted_at: Date | string;
  currently_restored: boolean;
}

// Forensic view of every security_logs deletion the database trigger has
// captured, regardless of whether it happened through the app or a raw SQL
// client with the database credentials.
export async function listDeletionAudit(): Promise<DeletionAuditEntry[]> {
  const result = await db.execute<DeletionAuditRow>(sql`
    SELECT
      d.id, d.deleted_log_id,
      d.row_snapshot->>'event_type' AS event_type,
      d.row_snapshot->>'details' AS details,
      d.deleted_by_app_actor, d.deleted_by_db_role, d.deleted_by_client_addr, d.deleted_at,
      EXISTS(SELECT 1 FROM security_logs s WHERE s.id = d.deleted_log_id) AS currently_restored
    FROM security_log_deletions d
    ORDER BY d.deleted_at DESC
    LIMIT 200
  `);

  return result.rows.map((row) => ({
    id: row.id,
    deletedLogId: row.deleted_log_id,
    eventType: row.event_type,
    details: row.details,
    deletedByAppActor: row.deleted_by_app_actor,
    deletedByDbRole: row.deleted_by_db_role,
    deletedByClientAddr: row.deleted_by_client_addr,
    deletedAt: new Date(row.deleted_at).toISOString(),
    currentlyRestored: row.currently_restored,
  }));
}
