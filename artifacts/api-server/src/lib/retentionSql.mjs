// The database side of the retention policy (privacy policy section 10; docs/04 R-LOG-5): security
// log entries are kept 12 months, AI challenge records 2 years. Shared by the API's startup check
// (lib/dbBootstrap.ts) and the production migration (scripts/ops/migrate-retention-and-breaches.mjs),
// so both install exactly the same thing. Plain JavaScript so the migration can import it directly.

/** Stored as the purge function's comment; a different comment means the installed version is out of date. */
export const RETENTION_SQL_VERSION =
  "secureai retention v1: security log entries 12 months, AI challenge records 2 years";

/** Kept 2 years: a challenge, its acknowledgement and its outcome (lib/aiGovernance.ts). */
export const AI_CHALLENGE_EVENT_TYPES = [
  "AI_DECISION_CHALLENGED",
  "AI_CHALLENGE_ACKNOWLEDGED",
  "AI_CHALLENGE_RESOLVED",
];

const CHALLENGE_TYPES = `ARRAY[${AI_CHALLENGE_EVENT_TYPES.map((t) => `'${t}'`).join(", ")}]`;
const IS_DUE = `((l.event_type = ANY (${CHALLENGE_TYPES}) AND l."timestamp" < now() - interval '2 years')
       OR (NOT l.event_type = ANY (${CHALLENGE_TYPES}) AND l."timestamp" < now() - interval '12 months'))`;

/** Also defined in lib/db/src/schema/securityLogRetention.ts, so drizzle push creates the same table. */
export const RETENTION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS security_log_retention (
  log_id integer PRIMARY KEY,
  prev_hash text,
  hash text,
  logged_at timestamptz NOT NULL,
  retention_class text NOT NULL,
  purged_at timestamptz NOT NULL DEFAULT now()
)`;

/**
 * The deletion audit trigger's function. A full copy of every deleted entry goes to
 * security_log_deletions, so a deletion can be investigated and undone, except entries removed
 * under the retention policy: their stub keeps their place in the chain, and keeping a full copy
 * would defeat the point of deleting them. Only purge_aged_security_logs() can write a stub.
 */
export const DELETION_TRIGGER_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION log_security_log_deletion() RETURNS trigger AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM security_log_retention WHERE log_id = OLD.id) THEN
    RETURN OLD;
  END IF;
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
$fn$ LANGUAGE plpgsql`;

/**
 * Removes the entries that are due, leaving a stub (hashes only) for each, and full copies of
 * deleted entries older than 12 months. Security definer: the app may run it but not change it,
 * and the periods are fixed here rather than passed in, so the app can't shorten them.
 */
export const PURGE_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION purge_aged_security_logs()
RETURNS TABLE (purged_entries integer, purged_deletion_copies integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  entries integer;
  copies integer;
BEGIN
  INSERT INTO security_log_retention (log_id, prev_hash, hash, logged_at, retention_class)
  SELECT l.id, l.prev_hash, l.hash, l."timestamp",
         CASE WHEN l.event_type = ANY (${CHALLENGE_TYPES}) THEN 'ai-challenge' ELSE 'standard' END
  FROM security_logs l
  WHERE ${IS_DUE}
  ON CONFLICT (log_id) DO NOTHING;

  DELETE FROM security_logs l
  WHERE ${IS_DUE}
    AND EXISTS (SELECT 1 FROM security_log_retention r WHERE r.log_id = l.id);
  GET DIAGNOSTICS entries = ROW_COUNT;

  DELETE FROM security_log_deletions WHERE deleted_at < now() - interval '12 months';
  GET DIAGNOSTICS copies = ROW_COUNT;

  RETURN QUERY SELECT entries, copies;
END;
$fn$`;

/** Everything above, in order: the table must exist before the trigger function can refer to it. */
export const RETENTION_SQL = [
  RETENTION_TABLE_SQL,
  DELETION_TRIGGER_FUNCTION_SQL,
  PURGE_FUNCTION_SQL,
  `COMMENT ON FUNCTION purge_aged_security_logs() IS '${RETENTION_SQL_VERSION}'`,
  `REVOKE ALL ON FUNCTION purge_aged_security_logs() FROM PUBLIC`,
];

/** The app's login may run the purge and read stubs, never write them. */
export function retentionGrantsFor(role) {
  return [
    `GRANT EXECUTE ON FUNCTION purge_aged_security_logs() TO ${role}`,
    `GRANT SELECT ON security_log_retention TO ${role}`,
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON security_log_retention FROM ${role}`,
  ];
}
