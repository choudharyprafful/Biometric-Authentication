// Makes account deletion complete in the database (docs/04 R-CONSENT-3). Until 2026-09-26 the
// passkeys and biometric_keys tables had no foreign key to users, so deleting an account left its
// passkeys and phone keys behind, and its signed-in sessions until they expired.
//
//   node scripts/ops/migrate-account-deletion.mjs              production (asks for the RDS master password)
//   node scripts/ops/migrate-account-deletion.mjs --rehearse   the local dev database
//
// Deletes the keys and sessions of accounts that no longer exist, then adds the two foreign keys
// with ON DELETE CASCADE (names match what drizzle-kit generates, so a later schema push leaves
// them alone). Idempotent. The API version that deletes keys and sessions itself does not depend on
// this having run, so it can go before or after the deploy.
import { withMasterConnection, step, ok, fail } from "./lib/rds.mjs";

const FOREIGN_KEYS = [
  { table: "passkeys", name: "passkeys_user_id_users_id_fk" },
  { table: "biometric_keys", name: "biometric_keys_user_id_users_id_fk" },
];

await withMasterConnection({ rehearse: process.argv.includes("--rehearse") }, async (client) => {
  step("Removing what deleted accounts left behind");
  await client.query("BEGIN");
  const keys = await client.query("DELETE FROM passkeys p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id)");
  const phoneKeys = await client.query("DELETE FROM biometric_keys b WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = b.user_id)");
  const sessions = await client.query(
    `DELETE FROM session s WHERE s.sess ->> 'userId' IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id::text = s.sess ->> 'userId')`,
  );
  ok(`${keys.rowCount} passkey(s), ${phoneKeys.rowCount} phone key(s) and ${sessions.rowCount} session(s) of deleted accounts removed`);

  step("Adding foreign keys");
  for (const { table, name } of FOREIGN_KEYS) {
    const exists = await client.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [name]);
    if (exists.rowCount) {
      ok(`${name} already present`);
      continue;
    }
    await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);
    ok(`${name} added (ON DELETE CASCADE)`);
  }
  await client.query("COMMIT");

  step("Checking");
  const fks = await client.query(
    `SELECT c.conname, c.confdeltype FROM pg_constraint c WHERE c.conname = ANY($1::text[])`,
    [FOREIGN_KEYS.map((f) => f.name)],
  );
  if (fks.rowCount !== 2 || fks.rows.some((r) => r.confdeltype !== "c")) fail("the two cascading foreign keys are not both in place");
  ok("both foreign keys cascade on account deletion");
});
