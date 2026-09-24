// One-time: give the live API its own least-privilege database login so AWS's weekly
// rotation of the RDS master password can never lock it out again.
//
//   node scripts/ops/provision-app-db-role.mjs              full run (also how to rotate the app password later)
//   node scripts/ops/provision-app-db-role.mjs --no-switch  create + verify the role, leave Elastic Beanstalk untouched
//   node scripts/ops/provision-app-db-role.mjs --grants-only re-apply grants to the existing role; password and live site unchanged
//   node scripts/ops/provision-app-db-role.mjs --rehearse   dry run against the local dev database (port 5433, local superuser)
//
// Asks for the CURRENT RDS master password (Secrets Manager -> rds!db-caf1a191-... -> Retrieve secret value).
// Never prints a password. Aborts before touching Elastic Beanstalk if any check fails.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../lib/db/package.json", import.meta.url));
const { Client } = require("pg");

// --rehearse runs every SQL step and check against the LOCAL dev database with a throwaway role,
// touching no firewall and no Elastic Beanstalk, then removes the throwaway role.
const REHEARSE = process.argv.includes("--rehearse");
const RDS_INSTANCE = "secureai2";
const PORT = REHEARSE ? 5433 : 5432;
const DB = "secureai";
const MASTER = REHEARSE ? "postgres" : "secureaiadmin";
const APP_ROLE = REHEARSE ? "secureai_app_rehearsal" : "secureai_app";
// Stands in for RDS's master: CREATEROLE but not superuser, so role statements fail locally exactly as they would on RDS.
const REHEARSAL_ADMIN = "rds_like_admin_rehearsal";
const EB_ENV = "secureai-api-env2";
// --grants-only re-applies grants to an existing role without touching its password or the live site.
const GRANTS_ONLY = process.argv.includes("--grants-only");
const SWITCH = !REHEARSE && !GRANTS_ONLY && !process.argv.includes("--no-switch");

const step = (msg) => console.log(`\n▸ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { throw new Error(msg); };

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
    rl._writeToOutput = () => rl.output.write("*");
  });
}

function aws(args) {
  return execSync(`aws ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Looked up at run time rather than committed, so the database endpoint and firewall ID stay out of the repo.
const [HOST, SG] = REHEARSE
  ? ["localhost", null]
  : aws(`rds describe-db-instances --db-instance-identifier ${RDS_INSTANCE} --query "DBInstances[0].[Endpoint.Address,VpcSecurityGroups[0].VpcSecurityGroupId]" --output text`).split(/\s+/);

let rdsCa = null;
async function rdsCaBundle() {
  if (!rdsCa) {
    const res = await fetch("https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem");
    if (!res.ok) fail(`could not download the AWS RDS certificate bundle (HTTP ${res.status})`);
    rdsCa = await res.text();
    if (!rdsCa.includes("BEGIN CERTIFICATE")) fail("the AWS RDS certificate bundle download did not contain certificates");
  }
  return rdsCa;
}

// The server certificate is checked against AWS's RDS CA bundle, so passwords are only ever sent to the real database.
async function connect(user, password) {
  const ssl = REHEARSE ? false : { ca: await rdsCaBundle(), rejectUnauthorized: true };
  const c = new Client({ host: HOST, port: PORT, database: DB, user, password, ssl, connectionTimeoutMillis: 10000 });
  await c.connect();
  return c;
}

async function waitForReady() {
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const status = aws(`elasticbeanstalk describe-environments --environment-names ${EB_ENV} --query "Environments[0].Status" --output text`);
    if (status === "Ready") return;
  }
  fail("environment did not return to Ready within 6 minutes — check the Elastic Beanstalk console");
}

async function liveDatabaseCheck() {
  const base = "https://d2zb1uxt99m5ks.cloudfront.net";
  const first = await fetch(`${base}/api/healthz`);
  const csrf = first.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("csrf_token="));
  if (!csrf) return first.status;
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: csrf, "x-csrf-token": csrf.slice("csrf_token=".length) },
    body: JSON.stringify({ email: `nobody-${crypto.randomBytes(4).toString("hex")}@example.invalid`, password: "x" }),
  });
  return res.status;
}

let openedIp = null;
let master = null;
let app = null;

try {
  if (REHEARSE) console.log("REHEARSAL against the local dev database — no firewall, no Elastic Beanstalk, throwaway role");
  step("Opening the database firewall for this machine only");
  const ip = REHEARSE ? "skipped" : (await (await fetch("https://checkip.amazonaws.com")).text()).trim();
  if (REHEARSE) ok("rehearsal: firewall untouched");
  else {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) fail(`could not detect this machine's public IP (got "${ip}")`);
    try {
      aws(`ec2 authorize-security-group-ingress --group-id ${SG} --protocol tcp --port 5432 --cidr ${ip}/32`);
      openedIp = ip;
      ok(`allowed ${ip}/32 on port 5432 (removed again at the end)`);
    } catch (e) {
      if (/InvalidPermission\.Duplicate/.test(String(e.stderr ?? e))) ok(`${ip}/32 was already allowed — leaving that rule as it was`);
      else fail(`could not open the firewall: ${String(e.stderr ?? e).trim()}`);
    }
  }

  step("Connecting as the RDS master user");
  const masterPassword = await askHidden("  Paste the CURRENT master password (input hidden), then Enter: ");
  if (!masterPassword) fail("no password entered");
  master = await connect(MASTER, masterPassword);
  ok(`connected (${(await master.query("SHOW server_version")).rows[0].server_version})`);

  step(`Creating / updating the ${APP_ROLE} login`);
  const appPassword = crypto.randomBytes(24).toString("base64url");
  const existed = (await master.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [APP_ROLE])).rows.length > 0;
  if (GRANTS_ONLY && !existed) fail(`--grants-only needs ${APP_ROLE} to exist already — run without it first`);
  let roleAction = `${APP_ROLE} does not exist yet — creating it`;
  if (GRANTS_ONLY) roleAction = `${APP_ROLE} exists — re-applying grants only (password unchanged)`;
  else if (existed) roleAction = `${APP_ROLE} already exists — setting a new password and re-applying grants`;
  ok(roleAction);
  if (REHEARSE) {
    await master.query(`DROP ROLE IF EXISTS ${REHEARSAL_ADMIN}`);
    await master.query(`CREATE ROLE ${REHEARSAL_ADMIN} NOLOGIN CREATEROLE`);
  }
  await master.query("BEGIN");
  // The RDS master is not a true superuser, and on Postgres 16+ only a superuser may even name the
  // SUPERUSER/REPLICATION attributes — so the role keeps its defaults (all off), checked below.
  if (!GRANTS_ONLY) {
    if (REHEARSE) await master.query(`SET LOCAL ROLE ${REHEARSAL_ADMIN}`);
    if (!existed) await master.query(`CREATE ROLE ${APP_ROLE} LOGIN`);
    await master.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD ${master.escapeLiteral(appPassword)}`);
    if (REHEARSE) await master.query(`RESET ROLE`);
  }
  await master.query(`GRANT CONNECT ON DATABASE ${DB} TO ${APP_ROLE}`);
  await master.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await master.query(`REVOKE CREATE ON SCHEMA public FROM ${APP_ROLE}`);
  await master.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  await master.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
  // Restoring deleted audit rows re-syncs this one sequence with setval(), which needs UPDATE on it (and only it).
  const auditSeq = (await master.query(`SELECT pg_get_serial_sequence('security_logs', 'id') AS s`)).rows[0].s;
  if (!auditSeq) fail("could not find the security_logs id sequence");
  await master.query(`GRANT UPDATE ON SEQUENCE ${auditSeq} TO ${APP_ROLE}`);
  // Tables the master user creates later (future migrations) get the same four grants automatically.
  await master.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${MASTER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`);
  await master.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${MASTER} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`);
  // Needed by the next deploy; additive and safe to run on the current version.
  await master.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS content_source text NOT NULL DEFAULT 'unspecified'`);
  await master.query("COMMIT");
  const attrs = (await master.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1`, [APP_ROLE])).rows[0];
  const elevated = Object.entries(attrs).filter(([, v]) => v).map(([k]) => k);
  if (elevated.length) fail(`${APP_ROLE} has elevated attributes (${elevated.join(", ")}) — remove them in the RDS console/psql first`);
  const memberOf = (await master.query(
    `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = $1`,
    [APP_ROLE],
  )).rows.map((r) => r.rolname);
  if (memberOf.length) fail(`${APP_ROLE} is a member of ${memberOf.join(", ")} and would inherit its rights — remove that membership first`);
  const owned = (await master.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1`, [APP_ROLE])).rows.map((r) => r.tablename);
  if (owned.length) fail(`${APP_ROLE} owns tables (${owned.join(", ")}) — ownership lets it drop them; reassign to ${MASTER} first`);
  ok("role ready: no elevated attributes, member of nothing, owns nothing, no CREATE, future tables covered");
  ok("uploads.content_source column present");

  step(GRANTS_ONLY ? "Checking the grants" : "Checking the new login works — and can do nothing more");
  const tables = (await master.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows.map((r) => r.tablename);
  for (const t of tables) {
    const r = await master.query(`SELECT has_table_privilege($1, $2, 'SELECT') s, has_table_privilege($1, $2, 'INSERT') i, has_table_privilege($1, $2, 'UPDATE') u, has_table_privilege($1, $2, 'DELETE') d`, [APP_ROLE, `public."${t}"`]);
    const p = r.rows[0];
    if (!(p.s && p.i && p.u && p.d)) fail(`missing privileges on ${t}`);
  }
  ok(`read/write confirmed on all ${tables.length} tables`);
  if (!(await master.query(`SELECT has_sequence_privilege($1, $2, 'UPDATE') u`, [APP_ROLE, auditSeq])).rows[0].u) fail(`missing UPDATE on ${auditSeq}`);
  ok(`audit-log restore can re-sync its sequence (UPDATE on ${auditSeq} only)`);

  if (!GRANTS_ONLY) {
    app = await connect(APP_ROLE, appPassword);
    const users = (await app.query("SELECT count(*)::int n FROM users")).rows[0].n;
    ok(`app login can read data (${users} users)`);
    if (REHEARSE) {
      // setval is not rolled back by a transaction, so it is only exercised against the local rehearsal database.
      await app.query(`SELECT setval('${auditSeq}', last_value, is_called) FROM ${auditSeq}`);
      ok("setval() as the app login works (rehearsal only)");
    }
    await app.query("BEGIN");
    try {
      await app.query("CREATE TABLE lp_probe (id int)");
      await app.query("ROLLBACK");
      fail(`${APP_ROLE} was able to CREATE TABLE — not least-privilege, stopping`);
    } catch (e) {
      await app.query("ROLLBACK").catch(() => {});
      if (!/permission denied/i.test(e.message)) throw e;
      ok("CREATE TABLE correctly refused");
    }
    // Inside a transaction that is always rolled back, so even an unexpected success changes nothing.
    await app.query("BEGIN");
    try {
      await app.query("DROP TABLE security_log_deletions");
      await app.query("ROLLBACK");
      fail(`${APP_ROLE} was able to DROP an audit table (rolled back) — not least-privilege, stopping`);
    } catch (e) {
      await app.query("ROLLBACK").catch(() => {});
      if (!/must be owner|permission denied/i.test(e.message)) throw e;
      ok("DROP TABLE on the audit table correctly refused");
    }
  }

  if (GRANTS_ONLY) {
    step("--grants-only: password and live site unchanged.");
  } else if (!SWITCH) {
    step("--no-switch: Elastic Beanstalk left unchanged. Re-run without it to switch the live site.");
  } else {
    step("Pointing the live site at the new login");
    const url = `postgresql://${APP_ROLE}:${appPassword}@${HOST}:5432/${DB}?sslmode=no-verify`;
    const file = path.join(os.tmpdir(), `eb-dburl-${crypto.randomBytes(6).toString("hex")}.json`);
    fs.writeFileSync(file, JSON.stringify([{ Namespace: "aws:elasticbeanstalk:application:environment", OptionName: "DATABASE_URL", Value: url }]), { mode: 0o600 });
    try {
      aws(`elasticbeanstalk update-environment --environment-name ${EB_ENV} --option-settings file://${file}`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    ok("DATABASE_URL updated (settings file deleted). Waiting for the environment to restart…");
    await waitForReady();

    // A login attempt for an address that can't exist forces a real database query:
    // 401 means the database answered, 500 means the new login isn't working.
    const liveStatus = await liveDatabaseCheck();
    if (liveStatus === 401) {
      ok("live site is querying the database with the new login (login check answered 401 as expected)");
      console.log("\n  The live site now uses its own login. AWS can keep rotating the master password weekly without affecting it.");
      console.log("  Tell Claude \"done\" so it can verify from the outside.");
    } else {
      console.error(`\n  ! live check answered ${liveStatus} instead of 401 — rolling the live site back to the previous connection`);
      const rollbackUrl = `postgresql://${MASTER}:${encodeURIComponent(masterPassword)}@${HOST}:5432/${DB}?sslmode=no-verify`;
      const rbFile = path.join(os.tmpdir(), `eb-dburl-${crypto.randomBytes(6).toString("hex")}.json`);
      fs.writeFileSync(rbFile, JSON.stringify([{ Namespace: "aws:elasticbeanstalk:application:environment", OptionName: "DATABASE_URL", Value: rollbackUrl }]), { mode: 0o600 });
      try {
        aws(`elasticbeanstalk update-environment --environment-name ${EB_ENV} --option-settings file://${rbFile}`);
      } finally {
        fs.rmSync(rbFile, { force: true });
      }
      await waitForReady();
      fail(`switch rolled back (live check after rollback: ${await liveDatabaseCheck()}). Nothing else changed on the live site`);
    }
  }
} catch (e) {
  if (master) await master.query("ROLLBACK").catch(() => {});
  console.error(`\n✗ Stopped: ${e.message}${e.detail ? `\n  Postgres detail: ${e.detail}` : ""}`);
  console.error("  Nothing in the database was changed by the failed step, and the live site was NOT switched unless a step above says so.");
  process.exitCode = 1;
} finally {
  if (app) await app.end().catch(() => {});
  if (REHEARSE && master) {
    for (const q of [
      `RESET ROLE`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MASTER} IN SCHEMA public REVOKE ALL ON TABLES FROM ${APP_ROLE}`,
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MASTER} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${APP_ROLE}`,
      `DROP OWNED BY ${APP_ROLE}`,
      `DROP ROLE IF EXISTS ${APP_ROLE}`,
      `DROP ROLE IF EXISTS ${REHEARSAL_ADMIN}`,
    ]) await master.query(q).catch((e) => console.error(`  ! rehearsal cleanup: ${e.message}`));
    const left = (await master.query(`SELECT count(*)::int n FROM pg_roles WHERE rolname IN ($1, $2)`, [APP_ROLE, REHEARSAL_ADMIN])).rows[0].n;
    console.log(left === 0 ? `\n  ✓ rehearsal roles removed` : `\n  ! ${left} rehearsal role(s) still exist`);
  }
  if (master) await master.end().catch(() => {});
  if (openedIp) {
    try {
      aws(`ec2 revoke-security-group-ingress --group-id ${SG} --protocol tcp --port 5432 --cidr ${openedIp}/32`);
      console.log(`\n  ✓ firewall rule for ${openedIp}/32 removed`);
    } catch {
      console.error(`\n  ! could not remove the firewall rule for ${openedIp}/32 — remove it in the EC2 console (security group ${SG})`);
    }
  }
}
