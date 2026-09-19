import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

// Run at every app startup rather than via `drizzle-kit push`, because a
// trigger can't be expressed in Drizzle's schema DSL. Idempotent (CREATE
// ... IF NOT EXISTS / CREATE OR REPLACE), safe to run on every boot.
//
// The trigger fires at the Postgres engine level on ANY delete from
// security_logs — including a raw DELETE run from psql/TablePlus/pgAdmin
// with the master credentials, completely outside this app. That's the
// point: it lets "who deleted this log row" be answered even for
// deletions the application itself never saw.
export async function ensureDeletionAuditTrigger(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS security_log_deletions (
        id SERIAL PRIMARY KEY,
        deleted_log_id INTEGER NOT NULL,
        row_snapshot JSONB NOT NULL,
        deleted_by_db_role TEXT NOT NULL,
        deleted_by_app_actor TEXT,
        deleted_by_client_addr TEXT,
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE OR REPLACE FUNCTION log_security_log_deletion() RETURNS trigger AS $fn$
      BEGIN
        INSERT INTO security_log_deletions
          (deleted_log_id, row_snapshot, deleted_by_db_role, deleted_by_app_actor, deleted_by_client_addr)
        VALUES (
          OLD.id,
          to_jsonb(OLD.*),
          current_user,
          current_setting('app.actor_email', true),
          inet_client_addr()::text
        );
        RETURN OLD;
      END;
      $fn$ LANGUAGE plpgsql
    `);

    // CREATE OR REPLACE, not DROP + CREATE: dropping a trigger requires
    // owning the table, which the app's role deliberately doesn't.
    await db.execute(sql`
      CREATE OR REPLACE TRIGGER security_logs_deletion_audit
      AFTER DELETE ON security_logs
      FOR EACH ROW EXECUTE FUNCTION log_security_log_deletion()
    `);

    logger.info("Deletion audit trigger on security_logs ensured");
  } catch (err) {
    logger.warn({ err }, "Failed to ensure deletion audit trigger — deletions of security_logs rows won't be tracked");
  }
}
