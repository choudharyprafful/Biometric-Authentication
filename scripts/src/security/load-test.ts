/**
 * Concurrency test against a running dev server: floods the login endpoint
 * with simultaneous wrong-password attempts and checks the rate limiter
 * actually held (see lib/rateLimit.ts, routes/auth.ts). Also re-verifies
 * the audit-log hash chain afterward, since the same flood exercises the
 * write queue's serialization under load.
 *
 * Requires DATABASE_URL and the dev servers running. Run with
 * `pnpm run security:load-test`.
 */
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

const BASE = process.env["LOAD_TEST_BASE_URL"] ?? "http://localhost:5173";
const CONCURRENCY = 30;
const EXPECTED_LIMIT = 5;

if (!process.env["DATABASE_URL"]) {
  console.error("DATABASE_URL must be set (same connection string the API server uses).");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

interface CsrfSession {
  csrf: string;
  cookies: string;
}

async function getCsrfSession(): Promise<CsrfSession> {
  const res = await fetch(`${BASE}/api/auth/me`, { headers: { Origin: BASE } });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const csrfMatch = /csrf_token=([^;]+)/.exec(setCookie);
  const sessionMatch = /connect\.sid=([^;]+)/.exec(setCookie);
  if (!csrfMatch) throw new Error("Did not receive a csrf_token cookie — is the dev server running?");
  return {
    csrf: csrfMatch[1]!,
    cookies: [`csrf_token=${csrfMatch[1]}`, sessionMatch && `connect.sid=${sessionMatch[1]}`].filter(Boolean).join("; "),
  };
}

async function testRateLimiterUnderConcurrency(): Promise<boolean> {
  const email = `loadtest_${Date.now()}@test.com`;
  const reg = await getCsrfSession();

  const regRes = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": reg.csrf, Cookie: reg.cookies },
    body: JSON.stringify({ email, name: "Load Test", password: "Password123!", dataConsent: true }),
  });
  if (regRes.status !== 201) {
    console.error(`Setup failed: register returned ${regRes.status}`);
    return false;
  }

  const flood = await getCsrfSession();
  console.log(`Firing ${CONCURRENCY} concurrent wrong-password login attempts against one account (limit: ${EXPECTED_LIMIT}/15min)...`);
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": flood.csrf, Cookie: flood.cookies },
        body: JSON.stringify({ email, password: "WrongPassword!" }),
      }).then((r) => r.status),
    ),
  );
  const elapsed = Date.now() - start;

  const counts = results.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  console.log(`Completed in ${elapsed}ms. Status counts:`, counts);

  // Clean up the throwaway account this test created.
  await pool.query("DELETE FROM users WHERE email = $1", [email]);

  const allowedThrough = counts[401] ?? 0;
  const held = allowedThrough <= EXPECTED_LIMIT;
  console.log(
    held
      ? `PASS: rate limiter held under concurrency (${allowedThrough} <= ${EXPECTED_LIMIT})`
      : `FAIL: race condition — ${allowedThrough} requests got through, expected at most ${EXPECTED_LIMIT}`,
  );
  return held;
}

// Duplicates lib/auditLog.ts's verify algorithm directly against the DB
// rather than importing it, so this doesn't trust the app's own code.
interface LogRow {
  id: number;
  event_type: string;
  details: string;
  user_id: number | null;
  user_email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: Date;
  hash: string | null;
  prev_hash: string | null;
}

function serialize(row: LogRow): string {
  return [row.event_type, row.details, row.user_id ?? "", row.user_email ?? "", row.ip_address ?? "", row.user_agent ?? "", row.timestamp.toISOString()].join("|");
}
function computeHash(prevHash: string, row: LogRow): string {
  return crypto.createHash("sha256").update(`${prevHash}|${serialize(row)}`).digest("hex");
}

async function verifyHashChain(): Promise<{ valid: boolean; brokenAtId: number | null; reason: string | null; rowsChecked: number; totalRows: number }> {
  const { rows } = await pool.query<LogRow>(
    "SELECT id, event_type, details, user_id, user_email, ip_address, user_agent, timestamp, hash, prev_hash FROM security_logs ORDER BY id ASC",
  );

  let expectedPrevHash = "GENESIS";
  let rowsChecked = 0;
  let chainStarted = false;

  for (const row of rows) {
    if (row.hash === null || row.prev_hash === null) {
      if (chainStarted) return { valid: false, brokenAtId: row.id, reason: "Unchained row found after the chain had already started", rowsChecked, totalRows: rows.length };
      continue;
    }
    chainStarted = true;

    if (row.prev_hash !== expectedPrevHash) {
      return { valid: false, brokenAtId: row.id, reason: "prevHash does not match the preceding row's hash", rowsChecked, totalRows: rows.length };
    }
    const recomputed = computeHash(row.prev_hash, row);
    if (recomputed !== row.hash) {
      return { valid: false, brokenAtId: row.id, reason: "Stored hash does not match recomputed hash", rowsChecked, totalRows: rows.length };
    }
    expectedPrevHash = row.hash;
    rowsChecked++;
  }
  return { valid: true, brokenAtId: null, reason: null, rowsChecked, totalRows: rows.length };
}

const rateLimitOk = await testRateLimiterUnderConcurrency();

console.log("\nRe-verifying the audit-log hash chain after the flood...");
const chainResult = await verifyHashChain();
console.log(chainResult);

await pool.end();

if (!rateLimitOk || !chainResult.valid) {
  console.error("\nLoad test FAILED.");
  process.exitCode = 1;
} else {
  console.log("\nLoad test passed: rate limiter held, hash chain intact.");
}
