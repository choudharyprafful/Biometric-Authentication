// Adds the columns the subscription-abuse controls need (docs/04 R-PAY-3, R-PAY-4, R-PAY-6, R-PAY-9).
// Run it BEFORE deploying the API version that uses them: that version selects these columns, and
// the version before it ignores them, so migrating first never breaks the live site.
//
//   node scripts/ops/migrate-subscription-abuse.mjs              production (asks for the RDS master password)
//   node scripts/ops/migrate-subscription-abuse.mjs --rehearse   the local dev database (port 5433, local superuser)
//
// Idempotent: every change is ADD COLUMN IF NOT EXISTS or only touches rows still missing a value.
// Never prints a password. The app's own login (secureai_app) needs no new grant: table-level
// privileges cover new columns.
import readline from "node:readline";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { Client } = require("pg");

const REHEARSE = process.argv.includes("--rehearse");
const RDS_INSTANCE = "secureai2";
const DB = "secureai";
const MASTER = REHEARSE ? "postgres" : "secureaiadmin";
const APP_ROLE = "secureai_app";

// Server-set descriptions of subscription payments made before payments recorded their plan
// (artifacts/api-server/src/lib/plans.ts). Only the subscribe route writes these.
const PLAN_DESCRIPTIONS = {
  plus: "SecureAI Plus — monthly subscription",
  pro: "SecureAI Pro — monthly subscription",
  team: "SecureAI Team — monthly subscription",
};

const step = (msg) => console.log(`\n▸ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { throw new Error(msg); };
const aws = (args) => execSync(`aws ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
    rl._writeToOutput = () => rl.output.write("*");
  });
}

let client = null;
let openedIp = null;
let SG = null;
try {
  let host = "localhost";
  let port = 5433;
  let ssl = false;
  let password = "postgres";

  if (!REHEARSE) {
    step("Finding the database");
    [host, SG] = aws(`rds describe-db-instances --db-instance-identifier ${RDS_INSTANCE} --query "DBInstances[0].[Endpoint.Address,VpcSecurityGroups[0].VpcSecurityGroupId]" --output text`).split(/\s+/);
    port = 5432;
    const res = await fetch("https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem");
    const ca = await res.text();
    if (!res.ok || !ca.includes("BEGIN CERTIFICATE")) fail("could not download the AWS RDS certificate bundle");
    // The server certificate is checked against AWS's RDS CA, so the password only goes to the real database.
    ssl = { ca, rejectUnauthorized: true };
    ok(`RDS instance ${RDS_INSTANCE}`);

    step("Opening the database firewall for this machine only");
    const ip = (await (await fetch("https://checkip.amazonaws.com")).text()).trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) fail(`could not detect this machine's public IP (got "${ip}")`);
    try {
      aws(`ec2 authorize-security-group-ingress --group-id ${SG} --protocol tcp --port 5432 --cidr ${ip}/32`);
      openedIp = ip;
      ok(`allowed ${ip}/32 on port 5432 (removed again at the end)`);
    } catch (e) {
      if (/InvalidPermission\.Duplicate/.test(String(e.stderr ?? e))) ok(`${ip}/32 was already allowed; leaving that rule as it was`);
      else fail(`could not open the firewall: ${String(e.stderr ?? e).trim()}`);
    }
    password = await askHidden("  Paste the CURRENT RDS master password (Secrets Manager, input hidden), then Enter: ");
    if (!password) fail("no password entered");
  }

  step(`Connecting as ${MASTER}${REHEARSE ? " (local rehearsal)" : ""}`);
  client = new Client({ host, port, database: DB, user: MASTER, password, ssl, connectionTimeoutMillis: 10000 });
  await client.connect();
  ok("connected");

  step("Adding columns");
  await client.query("BEGIN");
  await client.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_id text");
  await client.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at timestamptz");
  await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_hold boolean NOT NULL DEFAULT false");
  let backfilled = 0;
  for (const [planId, description] of Object.entries(PLAN_DESCRIPTIONS)) {
    const r = await client.query("UPDATE payments SET plan_id = $1 WHERE plan_id IS NULL AND description = $2", [planId, description]);
    backfilled += r.rowCount;
  }
  await client.query("COMMIT");
  ok("payments.plan_id, payments.refunded_at, users.payment_hold present");
  ok(`${backfilled} earlier subscription payment(s) linked to their plan`);

  step("Checking");
  const cols = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE (table_name, column_name) IN (('payments','plan_id'), ('payments','refunded_at'), ('users','payment_hold'))`,
  );
  if (cols.rowCount !== 3) fail(`expected 3 new columns, found ${cols.rowCount}`);
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
  if (role.rowCount) {
    const priv = await client.query(
      `SELECT has_column_privilege($1, 'payments', 'plan_id', 'SELECT, INSERT, UPDATE')
          AND has_column_privilege($1, 'payments', 'refunded_at', 'SELECT, INSERT, UPDATE')
          AND has_column_privilege($1, 'users', 'payment_hold', 'SELECT, UPDATE') AS ok`,
      [APP_ROLE],
    );
    if (!priv.rows[0].ok) fail(`${APP_ROLE} cannot read and write the new columns`);
    ok(`${APP_ROLE} can read and write the new columns`);
  } else ok(`no ${APP_ROLE} role here; skipped the privilege check`);
  // Reported, not changed: accounts on a paid plan with no standing subscription payment. Before
  // this release a refund left the plan in place; the API corrects an account the next time one of
  // its subscription payments changes. Review these by hand.
  const unbacked = await client.query(
    `SELECT count(*)::int AS n FROM users u
     WHERE u.subscription_plan <> 'free'
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.plan_id IS NOT NULL AND p.status = 'completed')`,
  );
  ok(`${unbacked.rows[0].n} account(s) on a paid plan with no standing subscription payment (reported only; review by hand)`);
  console.log("\nDone.");
} catch (e) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  console.error(`\n✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
  if (openedIp) {
    try {
      aws(`ec2 revoke-security-group-ingress --group-id ${SG} --protocol tcp --port 5432 --cidr ${openedIp}/32`);
      console.log(`  ✓ firewall rule for ${openedIp}/32 removed`);
    } catch {
      console.error(`  ! could not remove the firewall rule for ${openedIp}/32; remove it in the EC2 console (security group ${SG})`);
    }
  }
}
