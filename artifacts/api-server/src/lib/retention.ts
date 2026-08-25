import { lt, or, isNotNull } from "drizzle-orm";
import { db, passwordResetTokensTable } from "@workspace/db";
import { logger } from "./logger";

// Used/expired reset tokens have no further purpose once the audit log has
// captured the event, so purge them. Other tables (audit logs, payments,
// uploads) are kept — see docs/05_Consent_and_Deletion_Design.md.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly

export async function purgeExpiredResetTokens(): Promise<number> {
  const deleted = await db
    .delete(passwordResetTokensTable)
    .where(or(isNotNull(passwordResetTokensTable.usedAt), lt(passwordResetTokensTable.expiresAt, new Date())))
    .returning({ id: passwordResetTokensTable.id });
  return deleted.length;
}

// Runs once immediately, then hourly. unref() so it never blocks shutdown.
export function startRetentionJob(): void {
  purgeExpiredResetTokens()
    .then((count) => {
      if (count > 0) logger.info({ count }, "Retention: purged expired/used password reset tokens");
    })
    .catch((err) => logger.warn({ err }, "Retention: initial purge failed"));

  setInterval(() => {
    purgeExpiredResetTokens().catch((err) => logger.warn({ err }, "Retention: scheduled purge failed"));
  }, CLEANUP_INTERVAL_MS).unref();
}
