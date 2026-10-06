// Read-only check of the production database, connected exactly as the live API connects: its own
// login from Elastic Beanstalk's DATABASE_URL, over TLS verified against AWS's RDS CA. Nothing is
// ever printed from the connection string.
//
//   node scripts/ops/check-production-db.mjs
//
// Checks that the app's login is least-privilege (docs/04 R-AC-2): it is not a superuser and
// cannot create roles or databases, owns no table, and is refused CREATE TABLE, DROP of the audit
// table and ALTER of users. Those three statements run inside a transaction that is always rolled
// back, so nothing can change even if one were wrongly allowed. Also counts stored values that are
// not on the current encryption key (R-DP-3). Opens the database firewall for this machine's IP
// only, and removes that rule again at the end whatever happens.
import fs from "node:fs";
import net from "node:net";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
);
const { Client } = require("pg");

const ENV = "secureai-api-env2";
const APP = "secureai-api";
const RDS_INSTANCE = "secureai2";
const REGION = "us-east-1";

const aws = (args) =>
  execSync(`aws ${args}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
let failures = 0;
const check = (label, pass, detail = "") => {
  console.log(
    `  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`,
  );
  if (!pass) failures += 1;
};

async function waitForTcp(host, port, limitMs) {
  const started = Date.now();
  while (Date.now() - started < limitMs) {
    const up = await new Promise((resolve) => {
      const s = net.connect({ host, port, timeout: 3000 }, () => {
        s.destroy();
        resolve(true);
      });
      s.on("timeout", () => {
        s.destroy();
        resolve(false);
      });
      s.on("error", () => resolve(false));
    });
    if (up) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

const settings = JSON.parse(
  aws(
    `elasticbeanstalk describe-configuration-settings --application-name ${APP} --environment-name ${ENV} --region ${REGION} --output json --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environment']"`,
  ),
);
const env = (name) => settings.find((s) => s.OptionName === name)?.Value;
const url = new URL(env("DATABASE_URL"));
const currentKeyId = env("FILE_ENCRYPTION_KEY_ID") || "k1";
const [, sg] = aws(
  `rds describe-db-instances --db-instance-identifier ${RDS_INSTANCE} --region ${REGION} --query "DBInstances[0].[Endpoint.Address,VpcSecurityGroups[0].VpcSecurityGroupId]" --output text`,
).split(/\s+/);

let openedIp = null;
let client = null;
try {
  const ip = (
    await (await fetch("https://checkip.amazonaws.com")).text()
  ).trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip))
    throw new Error("could not detect this machine's IP");
  try {
    aws(
      `ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 5432 --cidr ${ip}/32 --region ${REGION}`,
    );
    openedIp = ip;
  } catch (e) {
    if (!/InvalidPermission\.Duplicate/.test(String(e.stderr ?? e))) throw e;
  }
  if (!(await waitForTcp(url.hostname, Number(url.port || 5432), 60000)))
    throw new Error(
      "the database did not accept a connection within 60 seconds",
    );

  client = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: {
      ca: fs.readFileSync(
        new URL(
          "../../artifacts/api-server/certs/rds-global-bundle.pem",
          import.meta.url,
        ),
        "utf8",
      ),
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: 30000,
  });
  await client.connect();

  console.log(
    `\nThe live API's database login (${url.username}), TLS verified against the RDS CA:`,
  );
  const role = (
    await client.query(
      "SELECT current_user AS who, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    )
  ).rows[0];
  check(
    "connected as the app's own login, not the master user",
    role.who === "secureai_app",
    role.who,
  );
  check(
    "not a superuser; cannot create roles or databases or bypass row security",
    !role.rolsuper &&
      !role.rolcreaterole &&
      !role.rolcreatedb &&
      !role.rolbypassrls,
  );
  const owned = (
    await client.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user",
    )
  ).rows[0].n;
  check("owns no table", owned === 0, `${owned} owned`);
  const canCreate = (
    await client.query(
      "SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS c",
    )
  ).rows[0].c;
  check("no CREATE on schema public", !canCreate);

  for (const [label, sql] of [
    ["CREATE TABLE is refused", "CREATE TABLE privilege_probe (x int)"],
    [
      "DROP of the audit-deletion table is refused",
      "DROP TABLE security_log_deletions",
    ],
    [
      "ALTER TABLE users is refused",
      "ALTER TABLE users ADD COLUMN privilege_probe int",
    ],
  ]) {
    await client.query("BEGIN");
    let refused = false;
    let message = "";
    try {
      await client.query(sql);
    } catch (e) {
      refused = true;
      message = e.message;
    } finally {
      await client.query("ROLLBACK");
    }
    check(label, refused, message);
  }
  const read = await client
    .query("SELECT count(*)::int AS n FROM users")
    .then(() => true)
    .catch(() => false);
  check("can still read the app's own tables", read);

  console.log(`\nEncryption key coverage (current key ${currentKeyId}):`);
  const prefix = `${currentKeyId}:%`;
  const counts = (
    await client.query(
      `SELECT
        (SELECT count(*) FROM users WHERE face_descriptor_iv IS NOT NULL)::int AS faces,
        (SELECT count(*) FROM users WHERE face_descriptor_iv IS NOT NULL AND face_descriptor_iv NOT LIKE $1)::int AS faces_old,
        (SELECT count(*) FROM uploads)::int AS uploads,
        (SELECT count(*) FROM uploads WHERE iv NOT LIKE $1)::int AS uploads_old,
        (SELECT count(*) FROM payments)::int AS payments,
        (SELECT count(*) FROM payments WHERE provider_token_iv NOT LIKE $1)::int AS payments_old`,
      [prefix],
    )
  ).rows[0];
  check(
    `every face template is on ${currentKeyId}`,
    counts.faces_old === 0,
    `${counts.faces} stored, ${counts.faces_old} on an older key`,
  );
  check(
    `every upload is on ${currentKeyId}`,
    counts.uploads_old === 0,
    `${counts.uploads} stored, ${counts.uploads_old} on an older key`,
  );
  check(
    `every payment token is on ${currentKeyId}`,
    counts.payments_old === 0,
    `${counts.payments} stored, ${counts.payments_old} on an older key`,
  );
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  failures += 1;
} finally {
  if (client) await client.end().catch(() => {});
  if (openedIp) {
    try {
      aws(
        `ec2 revoke-security-group-ingress --group-id ${sg} --protocol tcp --port 5432 --cidr ${openedIp}/32 --region ${REGION}`,
      );
      console.log(`\n  firewall rule for ${openedIp}/32 removed`);
    } catch {
      console.error(
        `\n  ! remove the firewall rule for ${openedIp}/32 in security group ${sg}`,
      );
    }
  }
}
console.log(
  failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n",
);
process.exit(failures ? 1 : 0);
