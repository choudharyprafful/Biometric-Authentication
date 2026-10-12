// Installs Team 2's Bystander Consent Policy on the database (docs/08 section 5h): the four upload
// columns that record who else a file shows (and pause it during a review), and the
// bystander_reports table for reports from people who appear in someone else's upload. Run it
// BEFORE deploying the API version that uses them: the current version ignores the new columns and
// table, so migrating first never breaks the live site.
//
//   node scripts/ops/migrate-bystander-reports.mjs              production (asks for the RDS master password)
//   node scripts/ops/migrate-bystander-reports.mjs --rehearse   the local dev database (port 5433, local superuser)
//   REHEARSE_DB=<name> node scripts/ops/migrate-bystander-reports.mjs --rehearse   a throwaway local copy instead
//
// Idempotent: IF NOT EXISTS throughout. Never prints a password. Removes nothing. Existing uploads
// keep bystanders NULL ("never asked"), which lib/dataProvenance.ts already treats that way.
import { withMasterConnection, step, ok, fail } from "./lib/rds.mjs";

const APP_ROLE = "secureai_app";

// The same columns and table lib/db/src/schema/uploads.ts and bystanderReports.ts define. Their
// "enums" are TypeScript-only in Drizzle (text columns, no CHECK), and upload_id is a copy, not a
// foreign key, so the record outlives the file; a later drizzle push sees nothing to change.
const BYSTANDER_SQL = [
  `ALTER TABLE uploads ADD COLUMN IF NOT EXISTS bystanders text[]`,
  `ALTER TABLE uploads ADD COLUMN IF NOT EXISTS bystander_statement text`,
  `ALTER TABLE uploads ADD COLUMN IF NOT EXISTS bystanders_declared_at timestamptz`,
  `ALTER TABLE uploads ADD COLUMN IF NOT EXISTS paused_for_review_at timestamptz`,
  `CREATE TABLE IF NOT EXISTS bystander_reports (
    id serial PRIMARY KEY,
    reporter_email text NOT NULL,
    reporter_name text,
    relationship text NOT NULL,
    request text NOT NULL,
    content_description text NOT NULL,
    uploader_hint text,
    status text NOT NULL DEFAULT 'open',
    upload_id integer,
    uploader_email text,
    staff_note text,
    received_at timestamptz NOT NULL DEFAULT now(),
    paused_at timestamptz,
    resolved_at timestamptz,
    handled_by_email text
  )`,
];

await withMasterConnection(
  { rehearse: process.argv.includes("--rehearse") },
  async (client) => {
    step("Bystander declarations and reports");
    await client.query("BEGIN");
    for (const statement of BYSTANDER_SQL) await client.query(statement);
    await client.query("COMMIT");
    ok(
      "uploads has bystanders, bystander_statement, bystanders_declared_at and paused_for_review_at; bystander_reports present",
    );

    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [APP_ROLE],
    );
    if (role.rowCount) {
      step(`Permissions for ${APP_ROLE}`);
      for (const statement of [
        `GRANT SELECT, INSERT, UPDATE, DELETE ON bystander_reports TO ${APP_ROLE}`,
        `GRANT USAGE, SELECT ON SEQUENCE bystander_reports_id_seq TO ${APP_ROLE}`,
      ])
        await client.query(statement);
      const p = (
        await client.query(
          `SELECT
             has_table_privilege($1, 'bystander_reports', 'INSERT')
               AND has_table_privilege($1, 'bystander_reports', 'UPDATE') AS reports,
             has_column_privilege($1, 'uploads', 'bystanders', 'SELECT, INSERT, UPDATE')
               AND has_column_privilege($1, 'uploads', 'paused_for_review_at', 'SELECT, UPDATE') AS uploads,
             has_table_privilege($1, 'bystander_reports', 'TRUNCATE') AS truncate`,
          [APP_ROLE],
        )
      ).rows[0];
      if (!p.reports || !p.uploads || p.truncate)
        fail(`unexpected permissions for ${APP_ROLE}: ${JSON.stringify(p)}`);
      ok(
        `${APP_ROLE} can record declarations and pauses on uploads and handle reports; it cannot truncate the table`,
      );
    } else {
      ok(`no ${APP_ROLE} login in this database; nothing to grant`);
    }

    step("Checking");
    const c = (
      await client.query(
        `SELECT
           (SELECT count(*)::int FROM uploads) AS uploads,
           (SELECT count(*)::int FROM uploads WHERE bystanders IS NULL) AS never_asked,
           (SELECT count(*)::int FROM bystander_reports) AS reports`,
      )
    ).rows[0];
    ok(
      `${c.uploads} upload${c.uploads === 1 ? "" : "s"} (${c.never_asked} never asked about other people); ${c.reports} bystander report${c.reports === 1 ? "" : "s"}`,
    );
  },
);
