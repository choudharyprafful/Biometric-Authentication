// Runs a migration against the production database as the RDS master user, or against the local dev
// database with --rehearse. Production: asks for the master password (never printed), checks the
// server certificate against AWS's RDS CA, opens the database firewall for this machine's IP only,
// and removes that rule again at the end whatever happens.
import net from "node:net";
import readline from "node:readline";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Client } = require("pg");

const RDS_INSTANCE = "secureai2";
const DB = "secureai";

export const step = (msg) => console.log(`\n▸ ${msg}`);
export const ok = (msg) => console.log(`  ✓ ${msg}`);
export const fail = (msg) => { throw new Error(msg); };
const aws = (args) => execSync(`aws ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
    rl._writeToOutput = () => rl.output.write("*");
  });
}

// A new firewall rule takes a few seconds to apply, and Windows retries a dropped connection only
// after 3 s and then 6 s, which can use up a connect timeout before the TLS login even starts.
async function waitForTcp(host, port, limitMs) {
  const started = Date.now();
  while (Date.now() - started < limitMs) {
    const up = await new Promise((resolve) => {
      const socket = net.connect({ host, port, timeout: 3000 }, () => { socket.destroy(); resolve(true); });
      socket.on("timeout", () => { socket.destroy(); resolve(false); });
      socket.on("error", () => resolve(false));
    });
    if (up) return Date.now() - started;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/** Connects as the master user (or the local superuser with rehearse), runs fn(client), cleans up. */
export async function withMasterConnection({ rehearse }, fn) {
  let client = null;
  let openedIp = null;
  let sg = null;
  try {
    let host = "localhost";
    let port = 5433;
    let ssl = false;
    let user = "postgres";
    let password = "postgres";
    if (!rehearse) {
      step("Finding the database");
      [host, sg] = aws(`rds describe-db-instances --db-instance-identifier ${RDS_INSTANCE} --query "DBInstances[0].[Endpoint.Address,VpcSecurityGroups[0].VpcSecurityGroupId]" --output text`).split(/\s+/);
      port = 5432;
      user = "secureaiadmin";
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
        aws(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 5432 --cidr ${ip}/32`);
        openedIp = ip;
        ok(`allowed ${ip}/32 on port 5432 (removed again at the end)`);
      } catch (e) {
        if (/InvalidPermission\.Duplicate/.test(String(e.stderr ?? e))) ok(`${ip}/32 was already allowed; leaving that rule as it was`);
        else fail(`could not open the firewall: ${String(e.stderr ?? e).trim()}`);
      }
      const waited = await waitForTcp(host, port, 60000);
      if (waited === null) fail("the database did not accept a connection within 60 seconds of opening the firewall");
      ok(`database reachable (${(waited / 1000).toFixed(1)} s after opening the firewall)`);
      password = await askHidden("  Paste the CURRENT RDS master password (Secrets Manager, input hidden), then Enter: ");
      if (!password) fail("no password entered");
    }

    step(`Connecting as ${user}${rehearse ? " (local rehearsal)" : ""}`);
    client = new Client({ host, port, database: DB, user, password, ssl, connectionTimeoutMillis: 30000 });
    await client.connect();
    ok("connected");
    await fn(client);
    console.log("\nDone.");
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(`\n✗ ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
    if (openedIp) {
      try {
        aws(`ec2 revoke-security-group-ingress --group-id ${sg} --protocol tcp --port 5432 --cidr ${openedIp}/32`);
        console.log(`  ✓ firewall rule for ${openedIp}/32 removed`);
      } catch {
        console.error(`  ! could not remove the firewall rule for ${openedIp}/32; remove it in the EC2 console (security group ${sg})`);
      }
    }
  }
}
