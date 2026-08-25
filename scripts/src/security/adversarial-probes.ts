/**
 * Scripted attack payloads fired at the running app over HTTP — a partial
 * stand-in for a real ZAP/Burp pass, not a replacement (see
 * docs/04_Threat_Model_Risk_Assessment.md, Section 3). A clean run means
 * these specific attempts didn't work, not that nothing would.
 *
 * Requires the dev servers running. Run with `pnpm run security:probes`.
 */

export {};

const BASE = process.env["PROBES_BASE_URL"] ?? "http://localhost:5173";

interface Session {
  csrf: string;
  cookies: string;
}

async function newSession(): Promise<Session> {
  const res = await fetch(`${BASE}/api/auth/me`, { headers: { Origin: BASE } });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const csrfMatch = /csrf_token=([^;]+)/.exec(setCookie);
  const sessionMatch = /connect\.sid=([^;]+)/.exec(setCookie);
  if (!csrfMatch) throw new Error("No csrf_token cookie — is the dev server running?");
  return {
    csrf: csrfMatch[1]!,
    cookies: [`csrf_token=${csrfMatch[1]}`, sessionMatch && `connect.sid=${sessionMatch[1]}`].filter(Boolean).join("; "),
  };
}

interface RegisterResponse {
  user?: { id: number; name: string };
}

async function register(session: Session, email: string, name = "Probe Test"): Promise<{ status: number; id?: number }> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({ email, name, password: "Password123!", dataConsent: true }),
  });
  const body = res.status === 201 ? ((await res.json()) as RegisterResponse) : null;
  return { status: res.status, id: body?.user?.id };
}

type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}: ${detail}`);
}

// SQL injection — Drizzle's parameterized queries should make this a
// non-issue structurally; verify against the login email field.
async function probeSqlInjection() {
  const session = await newSession();
  const payloads = [
    "' OR '1'='1",
    "' OR '1'='1' --",
    "admin@prafful.com' --",
    "'; DROP TABLE users; --",
  ];
  for (const payload of payloads) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
      body: JSON.stringify({ email: payload, password: "anything" }),
    });
    const bypassed = res.status === 200;
    record(
      `SQLi login bypass: ${JSON.stringify(payload)}`,
      !bypassed,
      bypassed ? "AUTHENTICATION BYPASSED — this is a critical finding" : `correctly rejected (${res.status})`,
    );
  }

  // Confirm the users table still exists after the DROP TABLE attempt.
  // 429 counts as fine too (IP may already be rate-limited); only 500/200
  // would mean the table is actually gone.
  const check = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({ email: "nonexistent-probe-check@test.com", password: "x" }),
  });
  record("users table survives DROP TABLE payload", check.status === 401 || check.status === 429, `login endpoint still functions normally (${check.status})`);
}

// CSRF — every state-changing request needs a matching X-CSRF-Token header.
async function probeCsrf() {
  const session = await newSession();
  const email = `csrfprobe_${Date.now()}@test.com`;

  const noToken = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Cookie: session.cookies },
    body: JSON.stringify({ email, name: "CSRF Probe", password: "Password123!", dataConsent: true }),
  });
  record("CSRF: request with no X-CSRF-Token header", noToken.status === 403, `got ${noToken.status}`);

  const wrongToken = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": "not-the-real-token", Cookie: session.cookies },
    body: JSON.stringify({ email, name: "CSRF Probe", password: "Password123!", dataConsent: true }),
  });
  record("CSRF: request with mismatched X-CSRF-Token", wrongToken.status === 403, `got ${wrongToken.status}`);
}

// Auth bypass — protected routes without a session, or below the required role.
async function probeAuthBypass() {
  const anon = await fetch(`${BASE}/api/auth/me`, { headers: { Origin: BASE } });
  record("no session -> /auth/me", anon.status === 401, `got ${anon.status}`);

  const anonUsers = await fetch(`${BASE}/api/users`, { headers: { Origin: BASE } });
  record("no session -> admin-only /users list", anonUsers.status === 401, `got ${anonUsers.status}`);

  const anonLogs = await fetch(`${BASE}/api/security/logs`, { headers: { Origin: BASE } });
  record("no session -> security_analyst-only /security/logs", anonLogs.status === 401, `got ${anonLogs.status}`);

  // A fresh regular user hitting an admin-only route. requireMfaEnrolled
  // blocks this first (no MFA yet) — either way it must never be 200.
  const session = await newSession();
  const email = `authprobe_${Date.now()}@test.com`;
  await register(session, email);
  const asUser = await fetch(`${BASE}/api/users`, { headers: { Origin: BASE, Cookie: session.cookies } });
  record("regular user -> admin-only /users list", asUser.status === 401 || asUser.status === 403, `got ${asUser.status}`);
}

// IDOR — user A reaching user B's resources by guessing/incrementing an ID.
async function probeIdor() {
  const sessionA = await newSession();
  const emailA = `idorA_${Date.now()}@test.com`;
  const regA = await register(sessionA, emailA);
  if (!regA.id) {
    record("IDOR setup", false, "could not register user A");
    return;
  }

  const sessionB = await newSession();
  const emailB = `idorB_${Date.now()}@test.com`;
  const regB = await register(sessionB, emailB);
  if (!regB.id) {
    record("IDOR setup", false, "could not register user B");
    return;
  }

  // B tries to read A's user record directly by ID.
  const readOther = await fetch(`${BASE}/api/users/${regA.id}`, { headers: { Origin: BASE, Cookie: sessionB.cookies } });
  record("IDOR: user B reads user A's profile by ID", readOther.status === 403 || readOther.status === 401, `got ${readOther.status}`);

  // B tries to delete A's account by ID — must never be 204.
  const deleteOther = await fetch(`${BASE}/api/users/${regA.id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": sessionB.csrf, Cookie: sessionB.cookies },
    body: JSON.stringify({ password: "irrelevant" }),
  });
  record("IDOR: user B deletes user A's account by ID", deleteOther.status !== 204, `got ${deleteOther.status}`);
}

// Stored XSS — API should store the payload as inert text. Rendering-side
// escaping is React's job and isn't observable from this HTTP probe.
async function probeStoredXss() {
  const session = await newSession();
  const email = `xssprobe_${Date.now()}@test.com`;
  const payload = "<script>window.__xss_probe_fired = true;</script>";
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({ email, name: payload, password: "Password123!", dataConsent: true }),
  });
  const body = res.status === 201 ? ((await res.json()) as RegisterResponse) : null;
  const storedVerbatim = body?.user?.name === payload;
  record(
    "Stored XSS: <script> payload in name field",
    res.status === 201 && storedVerbatim,
    storedVerbatim
      ? "stored as inert text, not stripped or transformed"
      : `unexpected: status ${res.status}, stored value ${JSON.stringify(body?.user?.name)}`,
  );
}

await probeSqlInjection();
await probeCsrf();
await probeAuthBypass();
await probeIdor();
await probeStoredXss();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} probes passed.`);
if (failed.length > 0) {
  console.error(`${failed.length} FAILED:`, failed.map((r) => r.name));
  process.exitCode = 1;
}
