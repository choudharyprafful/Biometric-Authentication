// Installs email verification at sign-up (docs/04 R-PAY-5): users.email_verified and
// users.email_verified_at, and the email_verification_tokens table. Run it BEFORE deploying the API
// version that uses them: the current version ignores the new column and table, so migrating first
// never breaks the live site.
//
//   node scripts/ops/migrate-email-verification.mjs              production (asks for the RDS master password)
//   node scripts/ops/migrate-email-verification.mjs --rehearse   the local dev database (port 5433, local superuser)
//   REHEARSE_DB=<name> node scripts/ops/migrate-email-verification.mjs --rehearse   a throwaway local copy instead
//
// Idempotent: IF NOT EXISTS throughout. Never prints a password. Removes nothing. Every existing
// account counts as verified (the column's default), so nobody loses uploads or payments they
// already had; only accounts created by the new API version start unverified.
import { withMasterConnection, step, ok, fail } from "./lib/rds.mjs";

const APP_ROLE = "secureai_app";

// The same column and table lib/db/src/schema/users.ts and emailVerificationTokens.ts define, with
// Drizzle's constraint names, so a later drizzle push sees nothing to change.
const VERIFICATION_SQL = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz`,
  `CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id serial PRIMARY KEY,
    user_id integer NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_verification_tokens_token_hash_unique UNIQUE (token_hash),
    CONSTRAINT email_verification_tokens_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
];

await withMasterConnection(
  { rehearse: process.argv.includes("--rehearse") },
  async (client) => {
    step("Email verification");
    await client.query("BEGIN");
    for (const statement of VERIFICATION_SQL) await client.query(statement);
    await client.query("COMMIT");
    ok(
      "users has email_verified and email_verified_at; email_verification_tokens present",
    );

    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [APP_ROLE],
    );
    if (role.rowCount) {
      step(`Permissions for ${APP_ROLE}`);
      for (const statement of [
        `GRANT SELECT, INSERT, UPDATE, DELETE ON email_verification_tokens TO ${APP_ROLE}`,
        `GRANT USAGE, SELECT ON SEQUENCE email_verification_tokens_id_seq TO ${APP_ROLE}`,
      ])
        await client.query(statement);
      const p = (
        await client.query(
          `SELECT
             has_table_privilege($1, 'email_verification_tokens', 'INSERT')
               AND has_table_privilege($1, 'email_verification_tokens', 'UPDATE')
               AND has_table_privilege($1, 'email_verification_tokens', 'DELETE') AS tokens,
             has_column_privilege($1, 'users', 'email_verified', 'SELECT, INSERT, UPDATE')
               AND has_column_privilege($1, 'users', 'email_verified_at', 'SELECT, UPDATE') AS columns,
             has_table_privilege($1, 'email_verification_tokens', 'TRUNCATE') AS truncate`,
          [APP_ROLE],
        )
      ).rows[0];
      if (!p.tokens || !p.columns || p.truncate)
        fail(`unexpected permissions for ${APP_ROLE}: ${JSON.stringify(p)}`);
      ok(
        `${APP_ROLE} can issue, use and purge confirmation links and mark an address confirmed; it cannot truncate the table`,
      );
    } else {
      ok(`no ${APP_ROLE} login in this database; nothing to grant`);
    }

    step("Checking");
    const c = (
      await client.query(
        `SELECT count(*)::int AS accounts,
                count(*) FILTER (WHERE NOT email_verified)::int AS unverified
           FROM users`,
      )
    ).rows[0];
    ok(
      `${c.accounts} account${c.accounts === 1 ? "" : "s"}, ${c.unverified} waiting for confirmation (existing accounts count as confirmed)`,
    );
  },
);
