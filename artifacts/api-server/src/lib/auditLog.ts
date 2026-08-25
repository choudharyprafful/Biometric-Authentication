import crypto from "node:crypto";
import { asc, desc } from "drizzle-orm";
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
  | "UNAUTHORIZED_ACCESS"
  | "RATE_LIMIT_HIT";

// Fixed anchor for the first row in the chain, so "no previous hash" is a
// checkable value instead of null.
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
// timestamp is set here in app code, not via defaultNow(), so it's part of
// the hashed content and can't be backdated after the fact.
function serialize(content: LogContent): string {
  return [content.eventType, content.details, content.userId ?? "", content.userEmail ?? "", content.ipAddress ?? "", content.userAgent ?? "", content.timestamp].join("|");
}

function computeHash(prevHash: string, content: LogContent): string {
  return crypto.createHash("sha256").update(`${prevHash}|${serialize(content)}`).digest("hex");
}

// Serializes writes so two concurrent logEvent calls can't both read the
// same prevHash and fork the chain. doLogEvent swallows its own errors, so
// this promise chain never ends up permanently rejected.
let writeQueue: Promise<void> = Promise.resolve();

export function logEvent(params: {
  eventType: AuditEventType;
  details: string;
  userId?: number | null;
  userEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const next = writeQueue.then(() => doLogEvent(params));
  writeQueue = next;
  return next;
}

async function doLogEvent(params: {
  eventType: AuditEventType;
  details: string;
  userId?: number | null;
  userEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
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

    await db.insert(securityLogsTable).values({
      eventType: content.eventType,
      details: content.details,
      userId: content.userId,
      userEmail: content.userEmail,
      ipAddress: content.ipAddress,
      userAgent: content.userAgent,
      timestamp: new Date(content.timestamp),
      prevHash,
      hash,
    });
  } catch {
    // Never let audit logging crash the main flow
  }
}

export interface ChainVerificationResult {
  valid: boolean;
  rowsChecked: number;
  brokenAtId: number | null;
  reason: string | null;
}

// Recomputes each row's hash and checks it against the stored hash and
// prevHash link — catches edits, deletions, inserts, and reordering.
// Rows from before the chain existed (hash/prevHash null) are skipped.
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
