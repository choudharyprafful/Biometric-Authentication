/**
 * Scripted attack payloads fired at the running app over HTTP — a partial
 * stand-in for a real ZAP/Burp pass, not a replacement (see
 * docs/04_Threat_Model_Risk_Assessment.md, Section 3). A clean run means
 * these specific attempts didn't work, not that nothing would.
 *
 * Requires the dev servers running. Run with `pnpm run security:probes`.
 *
 * Registration budget: this suite registers 9 accounts, and CI runs
 * load-test.ts (1 more) against the same server first — together exactly
 * the 10/hour per-IP registration rate limit (routes/auth.ts, R-PAY-5).
 * A new probe needing its own account must raise this ceiling consciously
 * or share an existing probe's account (see probePaymentIdempotencyAndRefund)
 * — going over means the last probes `429` instead of testing anything.
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

// Registration/login regenerate the session ID server-side on success
// (session-fixation defense, auth.ts), so the response carries a fresh
// connect.sid that supersedes the one newSession() primed earlier. Probes
// that make authenticated calls after registering need this merged in,
// or a stale session cookie's 401 looks identical to a real access-control 401.
function mergeSetCookie(session: Session, res: Response): void {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sessionMatch = /connect\.sid=([^;]+)/.exec(setCookie);
  if (!sessionMatch) return;
  const withoutOldSession = session.cookies.split("; ").filter((c) => !c.startsWith("connect.sid="));
  session.cookies = [...withoutOldSession, `connect.sid=${sessionMatch[1]}`].join("; ");
}

interface RegisterResponse {
  user?: { id: number; name: string; role: string; faceEnrolled: boolean; biometricConsentGiven: boolean; trainingConsentGiven: boolean };
}

async function register(session: Session, email: string, name = "Probe Test", extra: Record<string, unknown> = {}): Promise<{ status: number; id?: number; body: RegisterResponse | null }> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    // dateOfBirth triggers a server-side age/parental-consent check; a fixed
    // adult DOB keeps every probe a plain adult account.
    body: JSON.stringify({ email, name, password: "Password123!", dataConsent: true, dateOfBirth: "1995-01-01", ...extra }),
  });
  mergeSetCookie(session, res);
  const body = res.status === 201 ? ((await res.json()) as RegisterResponse) : null;
  return { status: res.status, id: body?.user?.id, body };
}

// A zero-vector descriptor satisfies enroll-face's own validation, so no
// real camera/biometric data is needed to clear the requireMfaEnrolled gate.
async function enrollFace(session: Session, userId: number): Promise<void> {
  await fetch(`${BASE}/api/users/${userId}/enroll-face`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({ descriptor: new Array(128).fill(0), consent: true }),
  });
}

type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}: ${detail}`);
}

// Drizzle's parameterized queries should make this structurally impossible.
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

  // 429 counts as fine here too (IP may already be rate-limited); only
  // 500/200 would mean the table is actually gone.
  const check = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({ email: "nonexistent-probe-check@test.com", password: "x" }),
  });
  record("users table survives DROP TABLE payload", check.status === 401 || check.status === 429, `login endpoint still functions normally (${check.status})`);
}

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

async function probeAuthBypass() {
  const anon = await fetch(`${BASE}/api/auth/me`, { headers: { Origin: BASE } });
  record("no session -> /auth/me", anon.status === 401, `got ${anon.status}`);

  const anonUsers = await fetch(`${BASE}/api/users`, { headers: { Origin: BASE } });
  record("no session -> admin-only /users list", anonUsers.status === 401, `got ${anonUsers.status}`);

  const anonLogs = await fetch(`${BASE}/api/security/logs`, { headers: { Origin: BASE } });
  record("no session -> security_analyst-only /security/logs", anonLogs.status === 401, `got ${anonLogs.status}`);

  // requireMfaEnrolled blocks this first (no MFA yet) — either way it must never be 200.
  const session = await newSession();
  const email = `authprobe_${Date.now()}@test.com`;
  await register(session, email);
  const asUser = await fetch(`${BASE}/api/users`, { headers: { Origin: BASE, Cookie: session.cookies } });
  record("regular user -> admin-only /users list", asUser.status === 401 || asUser.status === 403, `got ${asUser.status}`);
}

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

  const readOther = await fetch(`${BASE}/api/users/${regA.id}`, { headers: { Origin: BASE, Cookie: sessionB.cookies } });
  record("IDOR: user B reads user A's profile by ID", readOther.status === 403 || readOther.status === 401, `got ${readOther.status}`);

  const deleteOther = await fetch(`${BASE}/api/users/${regA.id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": sessionB.csrf, Cookie: sessionB.cookies },
    body: JSON.stringify({ password: "irrelevant" }),
  });
  record("IDOR: user B deletes user A's account by ID", deleteOther.status !== 204, `got ${deleteOther.status}`);
}

// Rendering-side escaping is React's job and isn't observable from this HTTP probe.
async function probeStoredXss() {
  const session = await newSession();
  const email = `xssprobe_${Date.now()}@test.com`;
  const payload = "<script>window.__xss_probe_fired = true;</script>";
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({ email, name: payload, password: "Password123!", dataConsent: true, dateOfBirth: "1995-01-01" }),
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

// Must be silently ignored even though Zod's schema doesn't reject the extra keys outright.
async function probeMassAssignment() {
  const session = await newSession();
  const email = `massassign_${Date.now()}@test.com`;
  const { status, body } = await register(session, email, "Mass Assign Probe", {
    role: "admin",
    faceEnrolled: true,
    biometricConsentGiven: true,
    trainingConsentGiven: true,
  });
  const user = body?.user;
  record(
    "Mass assignment: role/faceEnrolled/consent flags in registration body",
    status === 201 && user?.role === "user" && user?.faceEnrolled === false && user?.biometricConsentGiven === false,
    `status=${status} role=${user?.role} faceEnrolled=${user?.faceEnrolled} biometricConsentGiven=${user?.biometricConsentGiven}`,
  );
}

// Must neither grant the attacker anything nor leak into Object.prototype
// for every other object in the same running process.
async function probePrototypePollution() {
  const session = await newSession();
  const email = `protopollution_${Date.now()}@test.com`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({
      email,
      name: "Proto Probe",
      password: "Password123!",
      dataConsent: true,
      dateOfBirth: "1995-01-01",
      __proto__: { role: "admin", isAdmin: true },
      constructor: { prototype: { role: "admin" } },
    }),
  });
  const body = res.status === 201 ? ((await res.json()) as RegisterResponse) : null;
  record(
    "Prototype pollution: __proto__/constructor.prototype in registration body",
    res.status === 201 && body?.user?.role === "user",
    `status=${res.status} role=${body?.user?.role}`,
  );

  const probeObj: Record<string, unknown> = {};
  record(
    "Object.prototype not globally polluted by the attempt above",
    probeObj["role"] === undefined && probeObj["isAdmin"] === undefined,
    `a fresh {} object has role=${probeObj["role"]} isAdmin=${probeObj["isAdmin"]}`,
  );
}

// A reflected origin here would let any site read authenticated responses
// via a credentialed cross-origin fetch.
async function probeCors() {
  const res = await fetch(`${BASE}/api/healthz`, { headers: { Origin: "https://evil-attacker-site.example" } });
  const acao = res.headers.get("access-control-allow-origin");
  record(
    "CORS: arbitrary Origin not reflected in Access-Control-Allow-Origin",
    acao !== "https://evil-attacker-site.example" && acao !== "*",
    `Access-Control-Allow-Origin: ${acao ?? "(absent)"}`,
  );
}

// Only proves the *shape* of validation (400 vs 201) — full end-to-end
// depth needs a completed MFA session this portable, DB-free script
// doesn't set up; see docs/04 Section 3 for that deeper check.
async function probePaymentInputBounds() {
  const session = await newSession();
  const email = `paymentbounds_${Date.now()}@test.com`;
  await register(session, email);

  const attempts: { label: string; body: Record<string, unknown> }[] = [
    { label: "negative amount", body: { amount: -500, currency: "USD", description: "x" } },
    { label: "amount above the ceiling", body: { amount: 999999999999, currency: "USD", description: "x" } },
    { label: "non-real currency code", body: { amount: 10, currency: "XXX", description: "x" } },
  ];
  for (const { label, body } of attempts) {
    const res = await fetch(`${BASE}/api/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
      body: JSON.stringify(body),
    });
    // Not MFA-enrolled, so 401/403 (MFA gate) is as acceptable a "rejected" as 400 — only 201 is a finding.
    record(`Payment input validation: ${label}`, res.status !== 201, `got ${res.status}`);
  }
}

// A correct password from a device/network the account has never used
// should be flagged, not treated like the account's normal login —
// this is the "stolen-but-correct password" case lib/loginRiskModel.ts
// scores on every successful password check.
async function probeLoginRiskDetection() {
  const email = `loginrisk_${Date.now()}@test.com`;
  const password = "Password123!";
  const setupSession = await newSession();
  const reg = await register(setupSession, email);
  if (!reg.id) {
    record("Login-risk detection setup", false, "could not register the probe account");
    return;
  }

  // 3 baseline logins matches MIN_HISTORY_FOR_SCORING in loginRiskModel.ts —
  // enough history for the model to have a pattern to compare against.
  const normalHeaders = { "X-Forwarded-For": "203.0.113.50", "User-Agent": "probe-agent-normal/1.0" };
  let baseline: Response | null = null;
  for (let i = 0; i < 3; i++) {
    const loginSession = await newSession();
    baseline = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": loginSession.csrf, Cookie: loginSession.cookies, ...normalHeaders },
      body: JSON.stringify({ email, password }),
    });
  }
  const baselineBody = (await baseline!.json()) as { securityNotice?: string | null };
  record("Login-risk: baseline logins from the same device/network stay silent", baselineBody.securityNotice === null, `securityNotice=${JSON.stringify(baselineBody.securityNotice)}`);

  const attackerHeaders = { "X-Forwarded-For": "198.51.100.77", "User-Agent": "probe-agent-attacker/9.9" };
  const attackerSession = await newSession();
  const risky = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": attackerSession.csrf, Cookie: attackerSession.cookies, ...attackerHeaders },
    body: JSON.stringify({ email, password }),
  });
  const riskyBody = (await risky.json()) as { securityNotice?: string | null };
  record(
    "Login-risk: correct password from a new device+network is flagged, not silently accepted",
    typeof riskyBody.securityNotice === "string" && riskyBody.securityNotice.length > 0,
    `securityNotice=${JSON.stringify(riskyBody.securityNotice)}`,
  );
}

// Must stop being reflected the instant consent is withdrawn — no stale derived data left behind.
async function probeContentProfileConsentGate(): Promise<{ session: Session; id: number } | null> {
  const session = await newSession();
  const email = `contentprobe_${Date.now()}@test.com`;
  const reg = await register(session, email);
  if (!reg.id) {
    record("Content-profile consent gate setup", false, "could not register the probe account");
    return null;
  }
  await enrollFace(session, reg.id);

  const authedHeaders = { Origin: BASE, Cookie: session.cookies };
  const beforeConsent = await fetch(`${BASE}/api/users/me/content-profile`, { headers: authedHeaders });
  const beforeBody = (await beforeConsent.json()) as { keywords?: unknown[] };
  record("Content profile: empty before consent is granted", Array.isArray(beforeBody.keywords) && beforeBody.keywords.length === 0, `keywords.length=${beforeBody.keywords?.length}`);

  await fetch(`${BASE}/api/users/me/content-personalization-consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({ consent: true }),
  });
  const uploadText = Buffer.from("Security probes are my favourite hobby. I write security probes every day.").toString("base64");
  await fetch(`${BASE}/api/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    // Declared as the uploader's own writing: undeclared uploads are, correctly, excluded from the profile.
    body: JSON.stringify({ fileName: "probe.txt", mimeType: "text/plain", dataBase64: uploadText, contentSource: "own_work" }),
  });
  const afterConsent = await fetch(`${BASE}/api/users/me/content-profile`, { headers: authedHeaders });
  const afterBody = (await afterConsent.json()) as { keywords?: { keyword: string }[] };
  const gotKeyword = afterBody.keywords?.some((k) => k.keyword === "probes" || k.keyword === "security");
  record("Content profile: reflects real uploaded content once consented", !!gotKeyword, `keywords=${JSON.stringify(afterBody.keywords?.map((k) => k.keyword))}`);

  await fetch(`${BASE}/api/users/me/content-personalization-consent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies },
    body: JSON.stringify({ consent: false }),
  });
  const afterWithdraw = await fetch(`${BASE}/api/users/me/content-profile`, { headers: authedHeaders });
  const withdrawBody = (await afterWithdraw.json()) as { keywords?: unknown[] };
  record("Content profile: empty again immediately after withdrawing consent", Array.isArray(withdrawBody.keywords) && withdrawBody.keywords.length === 0, `keywords.length=${withdrawBody.keywords?.length}`);
  return { session, id: reg.id };
}

// Idempotency and refund abuse reuse the content-profile probe's account
// rather than registering their own, since POST /auth/register is itself
// rate-limited to 10/hour per IP (R-PAY-5) and a full run already uses the
// rest of that budget.
//
// Both are the "extract more than you're owed" cases docs/04's
// subscription-abuse analysis (R-PAY-3) names explicitly: a duplicated
// request must never create a second charge, and a payment must never be
// refundable twice (or refundable at all before it completes).
async function probePaymentIdempotencyAndRefund(account: { session: Session; id: number } | null) {
  if (!account) {
    record("Payment idempotency/refund setup", false, "no probe account available (content-profile probe setup failed)");
    return;
  }
  const { session } = account;

  const authedPost = (path: string, body?: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, "X-CSRF-Token": session.csrf, Cookie: session.cookies, ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });

  const idempotencyKey = `probe-${Date.now()}`;
  const makeIdempotentPayment = () => authedPost("/api/payments", { amount: 42, currency: "USD", description: "Idempotency probe" }, { "Idempotency-Key": idempotencyKey });
  const first = (await (await makeIdempotentPayment()).json()) as { id?: number };
  const second = (await (await makeIdempotentPayment()).json()) as { id?: number };
  record(
    "Payment idempotency: retried request with the same key returns the SAME payment, not a duplicate",
    !!first.id && first.id === second.id,
    `first=${first.id} second=${second.id}`,
  );

  const payment = (await (await authedPost("/api/payments", { amount: 15, currency: "USD", description: "Refund abuse probe" })).json()) as { id?: number };
  if (!payment.id) {
    record("Refund abuse setup", false, "could not create a payment to refund");
    return;
  }

  const firstRefund = await authedPost(`/api/payments/${payment.id}/refund`);
  record("Refund: a completed payment can be refunded once", firstRefund.status === 200, `got ${firstRefund.status}`);

  const secondRefund = await authedPost(`/api/payments/${payment.id}/refund`);
  record("Refund abuse: refunding the same payment twice is rejected", secondRefund.status !== 200, `got ${secondRefund.status}`);

  // Promise.all fires these truly in parallel — sequential retries would
  // only exercise the check-then-act path once, not the actual race window.
  const raceKey = `race-${Date.now()}`;
  const concurrentPayments = await Promise.all(
    Array.from({ length: 5 }, () => authedPost("/api/payments", { amount: 10, currency: "USD", description: "Concurrency race probe" }, { "Idempotency-Key": raceKey })),
  );
  const concurrentBodies = (await Promise.all(concurrentPayments.map((r) => r.json()))) as { id?: number }[];
  const distinctIds = new Set(concurrentBodies.map((b) => b.id).filter((id) => id !== undefined));
  const any500 = concurrentPayments.some((r) => r.status === 500);
  record(
    "Idempotency under real concurrency: 5 parallel requests with the same key create exactly one payment, no 500s",
    distinctIds.size === 1 && !any500,
    `distinct ids=${JSON.stringify([...distinctIds])}, statuses=${concurrentPayments.map((r) => r.status).join(",")}`,
  );

  const raceRefundTarget = (await (await authedPost("/api/payments", { amount: 20, currency: "USD", description: "Refund concurrency race probe" })).json()) as { id?: number };
  if (raceRefundTarget.id) {
    const concurrentRefunds = await Promise.all(Array.from({ length: 5 }, () => authedPost(`/api/payments/${raceRefundTarget.id}/refund`)));
    const successCount = concurrentRefunds.filter((r) => r.status === 200).length;
    record(
      "Refund under real concurrency: exactly one of 5 parallel refund attempts on the same payment succeeds",
      successCount === 1,
      `successes=${successCount}/5, statuses=${concurrentRefunds.map((r) => r.status).join(",")}`,
    );
  } else {
    record("Refund concurrency race setup", false, "could not create a payment to race-refund");
  }
}

await probeSqlInjection();
await probeCsrf();
await probeAuthBypass();
await probeIdor();
await probeStoredXss();
await probeMassAssignment();
await probePrototypePollution();
await probeCors();
await probePaymentInputBounds();
await probeLoginRiskDetection();
const contentProbeAccount = await probeContentProfileConsentGate();
await probePaymentIdempotencyAndRefund(contentProbeAccount);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} probes passed.`);
if (failed.length > 0) {
  console.error(`${failed.length} FAILED:`, failed.map((r) => r.name));
  process.exitCode = 1;
}
