import { lt, or, isNotNull, sql } from "drizzle-orm";
import {
  db,
  passwordResetTokensTable,
  parentConsentTokensTable,
  paymentsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { keepRecordsDueForPurge } from "./legalHolds";

// Used/expired tokens have no further purpose once the audit log has
// captured the event, so purge them unconditionally — this isn't a policy
// call. Security logs and payments follow the retention periods below; uploads
// are kept until their owner deletes them or the account.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly

export async function purgeExpiredResetTokens(): Promise<number> {
  const deleted = await db
    .delete(passwordResetTokensTable)
    .where(
      or(
        isNotNull(passwordResetTokensTable.usedAt),
        lt(passwordResetTokensTable.expiresAt, new Date()),
      ),
    )
    .returning({ id: passwordResetTokensTable.id });
  return deleted.length;
}

// A used/expired parent-consent token is a spent bearer credential, not
// forensic evidence — the event is already captured in security_logs.
export async function purgeExpiredParentConsentTokens(): Promise<number> {
  const deleted = await db
    .delete(parentConsentTokensTable)
    .where(
      or(
        isNotNull(parentConsentTokensTable.usedAt),
        lt(parentConsentTokensTable.expiresAt, new Date()),
      ),
    )
    .returning({ id: parentConsentTokensTable.id });
  return deleted.length;
}

/**
 * How long records are kept after they stop being needed day to day (privacy policy section 10),
 * set at the client's request on 2026-10-02: payment records 7 years, security log entries
 * 12 months, AI challenge records 2 years. Fixed here rather than configurable, so the policy
 * text and what the app does can't drift apart.
 */
export const RETENTION = {
  paymentRecordsYears: 7,
  securityLogMonths: 12,
  aiChallengeRecordYears: 2,
} as const;

// The security-log periods are applied inside the database (lib/retentionSql.mjs), so the app
// can trigger the purge but not change what it removes.
export async function purgeAgedSecurityLogs(): Promise<{
  entries: number;
  deletionCopies: number;
}> {
  const result = await db.execute<{
    purged_entries: number;
    purged_deletion_copies: number;
  }>(sql`SELECT * FROM purge_aged_security_logs()`);
  const row = result.rows[0];
  return {
    entries: Number(row?.purged_entries ?? 0),
    deletionCopies: Number(row?.purged_deletion_copies ?? 0),
  };
}

export async function purgeAgedPayments(): Promise<number> {
  const deleted = await db
    .delete(paymentsTable)
    .where(
      lt(
        paymentsTable.createdAt,
        sql`now() - make_interval(years => ${RETENTION.paymentRecordsYears})`,
      ),
    )
    .returning({ id: paymentsTable.id });
  return deleted.length;
}

async function runRetentionPass(): Promise<void> {
  const resetCount = await purgeExpiredResetTokens();
  if (resetCount > 0)
    logger.info(
      { count: resetCount },
      "Retention: purged expired/used password reset tokens",
    );

  const parentConsentCount = await purgeExpiredParentConsentTokens();
  if (parentConsentCount > 0)
    logger.info(
      { count: parentConsentCount },
      "Retention: purged expired/used parent consent tokens",
    );

  // Records of anyone under a legal hold are copied before anything of theirs is purged
  // (lib/legalHolds.ts). If the copy fails, nothing is purged this hour: a hold must not lose a record.
  let held: number;
  try {
    held = await keepRecordsDueForPurge(RETENTION);
  } catch (err) {
    logger.warn(
      { err },
      "Retention: could not copy records under legal hold, so payment and security records are not purged this hour",
    );
    return;
  }
  if (held > 0)
    logger.info(
      { count: held },
      "Retention: copied records under legal hold before the purge",
    );

  const payments = await purgeAgedPayments();
  if (payments > 0)
    logger.info(
      { count: payments, years: RETENTION.paymentRecordsYears },
      "Retention: deleted payment records past their retention period",
    );

  try {
    const logs = await purgeAgedSecurityLogs();
    if (logs.entries > 0 || logs.deletionCopies > 0)
      logger.info(
        { ...logs, ...RETENTION },
        "Retention: removed security log entries past their retention period",
      );
  } catch (err) {
    // Missing until scripts/ops/migrate-retention-and-breaches.mjs has run (see lib/dbBootstrap.ts).
    // Never fall back to deleting entries directly: that would break the hash chain.
    logger.warn(
      { err },
      "Retention: security log purge unavailable (purge_aged_security_logs() not installed); old entries are being kept",
    );
  }
}

// Runs once immediately, then hourly. unref() so it never blocks shutdown.
export function startRetentionJob(): void {
  logger.info(
    RETENTION,
    "Retention: job starting (payment records, security log entries, AI challenge records)",
  );

  runRetentionPass().catch((err) =>
    logger.warn({ err }, "Retention: initial purge pass failed"),
  );

  setInterval(() => {
    runRetentionPass().catch((err) =>
      logger.warn({ err }, "Retention: scheduled purge pass failed"),
    );
  }, CLEANUP_INTERVAL_MS).unref();
}
