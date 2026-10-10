// Installs legal holds, and the government disclosure record's request type and categories (docs/04
// R-PRIV-7 and R-PRIV-8, docs/12 section 3). Run it BEFORE deploying the API version that uses them:
// the current version ignores the new tables and columns, so migrating first never breaks the live
// site.
//
//   node scripts/ops/migrate-legal-holds.mjs              production (asks for the RDS master password)
//   node scripts/ops/migrate-legal-holds.mjs --rehearse   the local dev database (port 5433, local superuser)
//   REHEARSE_DB=<name> node scripts/ops/migrate-legal-holds.mjs --rehearse   a throwaway local copy instead
//
// Idempotent: IF NOT EXISTS throughout. Never prints a password. Removes nothing.
import { withMasterConnection, step, ok, fail } from "./lib/rds.mjs";

const APP_ROLE = "secureai_app";

// The same tables and columns lib/db/src/schema/legalHolds.ts and dataBreaches.ts define, with
// Drizzle's constraint names, so a later drizzle push sees nothing to change.
const HOLD_SQL = [
  `ALTER TABLE government_disclosures ADD COLUMN IF NOT EXISTS request_type text`,
  `ALTER TABLE government_disclosures ADD COLUMN IF NOT EXISTS categories text[]`,
  `CREATE TABLE IF NOT EXISTS legal_holds (
    id serial PRIMARY KEY,
    subject_email text NOT NULL,
    subject_user_id integer,
    agency text NOT NULL,
    reference text,
    reason text NOT NULL,
    placed_by_email text NOT NULL,
    placed_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    released_by_email text,
    release_reason text
  )`,
  `CREATE TABLE IF NOT EXISTS legal_hold_items (
    id serial PRIMARY KEY,
    hold_id integer NOT NULL,
    kind text NOT NULL,
    source_id integer NOT NULL,
    reason text NOT NULL,
    data jsonb NOT NULL,
    data_sha256 text NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT legal_hold_items_hold_id_legal_holds_id_fk
      FOREIGN KEY (hold_id) REFERENCES legal_holds(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS legal_hold_items_one_copy
    ON legal_hold_items (hold_id, kind, source_id, data_sha256)`,
];

await withMasterConnection(
  { rehearse: process.argv.includes("--rehearse") },
  async (client) => {
    step("Legal holds and disclosure details");
    await client.query("BEGIN");
    for (const statement of HOLD_SQL) await client.query(statement);
    await client.query("COMMIT");
    ok(
      "legal_holds and legal_hold_items present; government_disclosures has request_type and categories",
    );

    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [APP_ROLE],
    );
    if (role.rowCount) {
      step(`Permissions for ${APP_ROLE}`);
      for (const statement of [
        `GRANT SELECT, INSERT, UPDATE, DELETE ON legal_holds, legal_hold_items TO ${APP_ROLE}`,
        `GRANT USAGE, SELECT ON SEQUENCE legal_holds_id_seq, legal_hold_items_id_seq TO ${APP_ROLE}`,
      ])
        await client.query(statement);
      const p = (
        await client.query(
          `SELECT
             has_table_privilege($1, 'legal_holds', 'INSERT')
               AND has_table_privilege($1, 'legal_holds', 'UPDATE') AS holds,
             has_table_privilege($1, 'legal_hold_items', 'INSERT')
               AND has_table_privilege($1, 'legal_hold_items', 'DELETE') AS copies,
             has_column_privilege($1, 'government_disclosures', 'categories', 'INSERT')
               AND has_column_privilege($1, 'government_disclosures', 'request_type', 'INSERT') AS disclosures,
             has_table_privilege($1, 'legal_holds', 'TRUNCATE')
               OR has_table_privilege($1, 'legal_hold_items', 'TRUNCATE') AS truncate`,
          [APP_ROLE],
        )
      ).rows[0];
      if (!p.holds || !p.copies || !p.disclosures || p.truncate)
        fail(`unexpected permissions for ${APP_ROLE}: ${JSON.stringify(p)}`);
      ok(
        `${APP_ROLE} can place and release holds, keep and delete copies, and record the new disclosure details; it cannot truncate either table`,
      );
    } else {
      ok(`no ${APP_ROLE} login in this database; nothing to grant`);
    }

    step("Checking");
    const c = (
      await client.query(
        `SELECT
           (SELECT count(*)::int FROM legal_holds WHERE released_at IS NULL) AS active,
           (SELECT count(*)::int FROM government_disclosures WHERE request_type IS NULL) AS older`,
      )
    ).rows[0];
    ok(
      `${c.active} active hold${c.active === 1 ? "" : "s"}; ${c.older} disclosure${c.older === 1 ? "" : "s"} recorded before request types existed (shown as "kind not recorded")`,
    );
  },
);
