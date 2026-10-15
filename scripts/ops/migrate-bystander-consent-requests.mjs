// Installs consent requests to people in a file who have their own account (Team 2's Bystander
// Consent Policy, section 4, first row; lib/db/src/schema/bystanderConsentRequests.ts). Run it BEFORE
// deploying the API version that uses it: the current version ignores the new table, so migrating
// first never breaks the live site. It needs the uploads table's bystander columns, which the
// bystander migration adds; run that one first if production doesn't have them yet.
//
//   node scripts/ops/migrate-bystander-consent-requests.mjs              production (asks for the RDS master password)
//   node scripts/ops/migrate-bystander-consent-requests.mjs --rehearse   the local dev database (port 5433, local superuser)
//   REHEARSE_DB=<name> node scripts/ops/migrate-bystander-consent-requests.mjs --rehearse   a throwaway local copy instead
//
// Idempotent: IF NOT EXISTS throughout. Never prints a password. Removes nothing.
import { withMasterConnection, step, ok, fail } from "./lib/rds.mjs";

const APP_ROLE = "secureai_app";

// The same table lib/db/src/schema/bystanderConsentRequests.ts defines, with Drizzle's constraint
// names, so a later drizzle push sees nothing to change.
const REQUEST_SQL = [
  `CREATE TABLE IF NOT EXISTS bystander_consent_requests (
    id serial PRIMARY KEY,
    upload_id integer NOT NULL,
    subject_email text NOT NULL,
    personalisation boolean,
    shared_training boolean,
    answered_by_user_id integer,
    answered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bystander_consent_requests_upload_id_uploads_id_fk
      FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE,
    CONSTRAINT bystander_consent_requests_answered_by_user_id_users_id_fk
      FOREIGN KEY (answered_by_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bystander_consent_requests_one_per_person
    ON bystander_consent_requests (upload_id, subject_email)`,
];

await withMasterConnection(
  { rehearse: process.argv.includes("--rehearse") },
  async (client) => {
    step("Uploads table is ready");
    const columns = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'uploads' AND column_name IN ('bystanders', 'paused_for_review_at')`,
    );
    if (columns.rows[0].n !== 2)
      fail(
        "uploads has no bystanders / paused_for_review_at columns yet: run the bystander migration first",
      );
    ok("uploads has the bystander columns");

    step("Consent requests to people in a file");
    await client.query("BEGIN");
    for (const statement of REQUEST_SQL) await client.query(statement);
    await client.query("COMMIT");
    ok("bystander_consent_requests present, one request per person per file");

    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [APP_ROLE],
    );
    if (role.rowCount) {
      step(`Permissions for ${APP_ROLE}`);
      for (const statement of [
        `GRANT SELECT, INSERT, UPDATE, DELETE ON bystander_consent_requests TO ${APP_ROLE}`,
        `GRANT USAGE, SELECT ON SEQUENCE bystander_consent_requests_id_seq TO ${APP_ROLE}`,
      ])
        await client.query(statement);
      const p = (
        await client.query(
          `SELECT
             has_table_privilege($1, 'bystander_consent_requests', 'INSERT')
               AND has_table_privilege($1, 'bystander_consent_requests', 'UPDATE')
               AND has_table_privilege($1, 'bystander_consent_requests', 'DELETE') AS requests,
             has_table_privilege($1, 'bystander_consent_requests', 'TRUNCATE') AS truncate`,
          [APP_ROLE],
        )
      ).rows[0];
      if (!p.requests || p.truncate)
        fail(`unexpected permissions for ${APP_ROLE}: ${JSON.stringify(p)}`);
      ok(
        `${APP_ROLE} can ask, record answers and remove requests; it cannot truncate the table`,
      );
    } else {
      ok(`no ${APP_ROLE} login in this database; nothing to grant`);
    }

    step("Checking");
    const c = (
      await client.query(
        `SELECT count(*)::int AS requests,
                count(*) FILTER (WHERE answered_at IS NULL)::int AS waiting
           FROM bystander_consent_requests`,
      )
    ).rows[0];
    ok(
      `${c.requests} request${c.requests === 1 ? "" : "s"}, ${c.waiting} waiting for an answer`,
    );
  },
);
