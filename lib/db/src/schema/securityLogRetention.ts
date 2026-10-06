import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per security log entry removed under the retention policy (12 months; AI challenge
 * records 2 years). It keeps the entry's place in the hash chain, its hashes and never its
 * content, so the chain still verifies once old entries are gone.
 *
 * Only the database function purge_aged_security_logs() writes here (created by the API at
 * startup where it has the rights, otherwise by scripts/ops/migrate-retention-and-breaches.mjs).
 * The app's own login can read these rows but not add them, so a stub can't be used to pass
 * off a deletion as retention.
 */
export const securityLogRetentionTable = pgTable("security_log_retention", {
  logId: integer("log_id").primaryKey(),
  // Null for entries from before the hash chain existed.
  prevHash: text("prev_hash"),
  hash: text("hash"),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
  // "standard" (12 months) or "ai-challenge" (2 years)
  retentionClass: text("retention_class").notNull(),
  purgedAt: timestamp("purged_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SecurityLogRetentionStub =
  typeof securityLogRetentionTable.$inferSelect;
