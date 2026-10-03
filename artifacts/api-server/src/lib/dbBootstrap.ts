import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  DELETION_TRIGGER_FUNCTION_SQL,
  RETENTION_SQL,
  RETENTION_SQL_VERSION,
  RETENTION_TABLE_SQL,
} from "./retentionSql.mjs";

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
    // Creating these needs DDL rights the app's least-privilege role doesn't
    // have, and even CREATE ... IF NOT EXISTS checks them, so skip when present.
    const existing = await db.execute(sql`
      SELECT 1 FROM pg_trigger WHERE tgname = 'security_logs_deletion_audit' AND NOT tgisinternal
    `);
    if (existing.rows.length > 0) {
      logger.info("Deletion audit trigger on security_logs present");
      return;
    }

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

    // The trigger function looks up retention stubs, so their table must exist first.
    await db.execute(sql.raw(RETENTION_TABLE_SQL));
    await db.execute(sql.raw(DELETION_TRIGGER_FUNCTION_SQL));

    // CREATE OR REPLACE, not DROP + CREATE: dropping a trigger requires
    // owning the table, which the app's role deliberately doesn't.
    await db.execute(sql`
      CREATE OR REPLACE TRIGGER security_logs_deletion_audit
      AFTER DELETE ON security_logs
      FOR EACH ROW EXECUTE FUNCTION log_security_log_deletion()
    `);

    logger.info("Deletion audit trigger on security_logs ensured");
  } catch (err) {
    logger.warn(
      { err },
      "Failed to ensure deletion audit trigger — deletions of security_logs rows won't be tracked",
    );
  }
}

/**
 * The retention purge (lib/retentionSql.mjs): installed here where this login has the rights (local
 * development as the database owner, CI); on the live site the app's restricted login can't, so
 * scripts/ops/migrate-retention-and-breaches.mjs installs it. Until then old security log entries
 * are kept, never deleted some other way.
 */
export async function ensureRetentionPurge(): Promise<void> {
  try {
    const installed = await db.execute<{ version: string | null }>(sql`
      SELECT obj_description(to_regprocedure('purge_aged_security_logs()'), 'pg_proc') AS version
    `);
    if (installed.rows[0]?.version === RETENTION_SQL_VERSION) {
      logger.info("Retention purge function present");
      return;
    }
    for (const statement of RETENTION_SQL) await db.execute(sql.raw(statement));
    logger.info("Retention purge function installed");
  } catch (err) {
    logger.warn(
      { err },
      "Retention purge function missing or out of date, and this login can't install it: run node scripts/ops/migrate-retention-and-breaches.mjs. Old security log entries are kept until then.",
    );
  }
}
