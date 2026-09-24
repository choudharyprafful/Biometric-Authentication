import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

// Populated exclusively by a Postgres AFTER DELETE trigger on security_logs
// (see api-server/src/lib/dbBootstrap.ts) — never written to directly by
// application code. That's the point: the trigger fires at the database
// engine level regardless of *how* the row was deleted, including a raw
// DELETE issued from psql/TablePlus/pgAdmin with the master credentials,
// completely bypassing the Express app. rowSnapshot is the full pre-delete
// row (id, hash, prevHash included), captured independently of the hash
// chain itself — this is what makes genuine restoration possible without
// fabricating content (see restoreLogChain in auditLog.ts).
export const securityLogDeletionsTable = pgTable("security_log_deletions", {
  id: serial("id").primaryKey(),
  deletedLogId: integer("deleted_log_id").notNull(),
  rowSnapshot: jsonb("row_snapshot").notNull(),
  // The connecting Postgres role. Not very distinguishing on its own here
  // since the app and any human with the master password currently share
  // one role (secureaiadmin) — deletedByAppActor below is the real signal.
  deletedByDbRole: text("deleted_by_db_role").notNull(),
  // Set via `SELECT set_config('app.actor_email', ..., true)` immediately
  // before an app-initiated delete (see repairLogChain). NULL means no app
  // code set it before the delete happened — i.e. a raw, out-of-band
  // deletion. Note this is a convenience signal, not a security boundary:
  // anyone with the master password could also set this session variable
  // themselves before running a raw DELETE. A real boundary would require
  // a separate, lower-privileged database role for the app itself.
  deletedByAppActor: text("deleted_by_app_actor"),
  deletedByClientAddr: text("deleted_by_client_addr"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SecurityLogDeletion = typeof securityLogDeletionsTable.$inferSelect;
