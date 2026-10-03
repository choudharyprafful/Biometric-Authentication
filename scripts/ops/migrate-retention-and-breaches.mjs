// Installs the database side of the client's requirements of 2026-10-02 (docs/04 R-LOG-5, R-PRIV-4):
// the retention purge for security log entries (12 months; AI challenge records 2 years) and the
// data breach register and government disclosure record. Run it BEFORE deploying the API version that uses them: the current version
// ignores the new tables and function, so migrating first never breaks the live site.
//
//   node scripts/ops/migrate-retention-and-breaches.mjs              production (asks for the RDS master password)
//   node scripts/ops/migrate-retention-and-breaches.mjs --rehearse   the local dev database (port 5433, local superuser)
//   REHEARSE_DB=<name> node scripts/ops/migrate-retention-and-breaches.mjs --rehearse   a throwaway local copy instead
//
// Idempotent: CREATE ... IF NOT EXISTS and CREATE OR REPLACE throughout. Never prints a password.
// Removes nothing itself: the API runs the purge hourly once it can.
import { withMasterConnection, step, ok, fail } from "./lib/rds.mjs";
import {
  AI_CHALLENGE_EVENT_TYPES,
  RETENTION_SQL,
  RETENTION_SQL_VERSION,
  retentionGrantsFor,
} from "../../artifacts/api-server/src/lib/retentionSql.mjs";

const APP_ROLE = "secureai_app";

// The same tables lib/db/src/schema/dataBreaches.ts defines, with Drizzle's constraint names, so a
// later drizzle push sees nothing to change.
const BREACH_SQL = [
  `CREATE TABLE IF NOT EXISTS data_breaches (
    id serial PRIMARY KEY,
    title text NOT NULL,
    description text NOT NULL,
    data_involved text NOT NULL,
    user_guidance text NOT NULL,
    discovered_at timestamptz NOT NULL,
    contained_at timestamptz,
    assessment text,
    assessment_note text,
    assessed_at timestamptz,
    users_notified_at timestamptz,
    regulator_notified_at timestamptz,
    regulator_reference text,
    recorded_by_email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS data_breach_notices (
    id serial PRIMARY KEY,
    breach_id integer NOT NULL
      CONSTRAINT data_breach_notices_breach_id_data_breaches_id_fk
      REFERENCES data_breaches(id) ON DELETE CASCADE,
    user_id integer NOT NULL
      CONSTRAINT data_breach_notices_user_id_users_id_fk
      REFERENCES users(id) ON DELETE CASCADE,
    email_sent boolean NOT NULL DEFAULT false,
    notified_at timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS data_breach_notices_breach_user
    ON data_breach_notices (breach_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS government_disclosures (
    id serial PRIMARY KEY,
    agency text NOT NULL,
    legal_basis text NOT NULL,
    reference text,
    subject_email text,
    information_disclosed text NOT NULL,
    disclosed_at timestamptz NOT NULL,
    person_told_at timestamptz,
    not_telling_reason text,
    recorded_by_email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
];

const CHALLENGE_TYPES = AI_CHALLENGE_EVENT_TYPES;

await withMasterConnection(
  { rehearse: process.argv.includes("--rehearse") },
  async (client) => {
    step("Data breach register");
    await client.query("BEGIN");
    for (const statement of BREACH_SQL) await client.query(statement);
    await client.query("COMMIT");
    ok("data_breaches, data_breach_notices and government_disclosures present");

    step("Retention purge for security log entries");
    await client.query("BEGIN");
    for (const statement of RETENTION_SQL) await client.query(statement);
    await client.query("COMMIT");
    ok(`purge_aged_security_logs() installed: ${RETENTION_SQL_VERSION}`);

    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [APP_ROLE],
    );
    if (role.rowCount) {
      step(`Permissions for ${APP_ROLE}`);
      for (const statement of [
        ...retentionGrantsFor(APP_ROLE),
        `GRANT SELECT, INSERT, UPDATE, DELETE ON data_breaches, data_breach_notices, government_disclosures TO ${APP_ROLE}`,
        `GRANT USAGE, SELECT ON SEQUENCE data_breaches_id_seq, data_breach_notices_id_seq, government_disclosures_id_seq TO ${APP_ROLE}`,
      ])
        await client.query(statement);
      const p = (
        await client.query(
          `SELECT
             has_table_privilege($1, 'security_log_retention', 'SELECT') AS stub_read,
             has_table_privilege($1, 'security_log_retention', 'INSERT')
               OR has_table_privilege($1, 'security_log_retention', 'UPDATE')
               OR has_table_privilege($1, 'security_log_retention', 'DELETE') AS stub_write,
             has_function_privilege($1, 'purge_aged_security_logs()', 'EXECUTE') AS purge,
             has_table_privilege($1, 'data_breaches', 'INSERT')
               AND has_table_privilege($1, 'data_breach_notices', 'UPDATE')
               AND has_table_privilege($1, 'government_disclosures', 'INSERT') AS breaches`,
          [APP_ROLE],
        )
      ).rows[0];
      if (!p.stub_read || p.stub_write || !p.purge || !p.breaches)
        fail(`unexpected permissions for ${APP_ROLE}: ${JSON.stringify(p)}`);
      ok(
        `${APP_ROLE} can run the purge and read retention stubs, cannot write them, and can use the breach register and disclosure record`,
      );
    } else {
      ok(`no ${APP_ROLE} login in this database; nothing to grant`);
    }

    step("Checking");
    const fn = (
      await client.query(
        `SELECT
           (SELECT prosecdef FROM pg_proc WHERE proname = 'purge_aged_security_logs') AS definer,
           (SELECT prosrc LIKE '%security_log_retention%' FROM pg_proc WHERE proname = 'log_security_log_deletion') AS trigger_uses_stubs,
           has_function_privilege('public', 'purge_aged_security_logs()', 'EXECUTE') AS public_can_run`,
      )
    ).rows[0];
    if (!fn.definer) fail("purge_aged_security_logs() is not security definer");
    if (!fn.trigger_uses_stubs)
      fail("the deletion audit trigger function was not updated");
    if (fn.public_can_run)
      fail("purge_aged_security_logs() is still executable by everyone");
    ok(
      "purge runs as the table owner, only the app may call it, and the deletion audit skips retention stubs",
    );

    const due = (
      await client.query(
        `SELECT count(*)::int AS n FROM security_logs
         WHERE (event_type = ANY ($1) AND "timestamp" < now() - interval '2 years')
            OR (NOT event_type = ANY ($1) AND "timestamp" < now() - interval '12 months')`,
        [CHALLENGE_TYPES],
      )
    ).rows[0].n;
    ok(
      `${due} security log entr${due === 1 ? "y is" : "ies are"} past the retention period now; the API removes them within an hour of starting`,
    );
  },
);
