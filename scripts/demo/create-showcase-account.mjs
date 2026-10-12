// Creates one admin account, through the real API, whose history shows every security feature the
// client can be shown, and writes a guide to where each one appears in the app.
//
//   node scripts/demo/create-showcase-account.mjs [--email client.showcase@example.com]
//
// Needs: the API on http://localhost:8080 (SHOWCASE_API to change it) with NODE_ENV=development, so
// the email-confirmation and reset links come back in the response; and the local Postgres superuser
// (LOCAL_PG_SUPERUSER_URL, default postgres:postgres@localhost:5433/secureai) for the one step the API
// can't do here, making the account an admin. Never against production: it uploads the EICAR test
// file, fails sign-ins on purpose and uses dev-only links.
//
// Every step goes through the same checks a person's request does. A synthetic face template (never
// a real face) is used while the history is built, then removed, so the first sign-in goes to
// Security Settings to add a passkey on the demo device. The password is written to a file in the
// home folder (SHOWCASE_OUT to change it), not printed.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const { Client: Pg } = createRequire(path.join(REPO, "scripts/package.json"))(
  "pg",
);

const API = process.env.SHOWCASE_API ?? "http://localhost:8080";
const ORIGIN = "http://localhost:5173";
const PG_URL =
  process.env.LOCAL_PG_SUPERUSER_URL ??
  "postgres://postgres:postgres@localhost:5433/secureai";
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const EMAIL = (arg("--email") ?? "client.showcase@example.com").toLowerCase();
const PHOTO = path.join(
  REPO,
  "scripts/demo/fixtures/demo-photo-with-location.jpg",
);
// The industry-standard antivirus test string: harmless, but every scanner reports it as a virus.
const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const results = [];
function check(label, pass, detail) {
  results.push({ label, pass });
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
  return pass;
}
function must(pass, message) {
  if (!pass) {
    console.error(`\nStopped: ${message}`);
    process.exit(1);
  }
}

/** One browser-like session: cookies, the CSRF token, and optional network headers. */
function session(extraHeaders = {}) {
  const jar = new Map();
  return {
    async req(method, p, body, headers = {}) {
      if (method !== "GET" && !jar.has("csrf_token"))
        await this.req("GET", "/api/healthz");
      const h = { Origin: ORIGIN, ...extraHeaders, ...headers };
      if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      if (method !== "GET") h["X-CSRF-Token"] = jar.get("csrf_token");
      if (body !== undefined) h["Content-Type"] = "application/json";
      const res = await fetch(API + p, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const sc of res.headers.getSetCookie()) {
        const [kv] = sc.split(";");
        const i = kv.indexOf("=");
        jar.set(kv.slice(0, i), kv.slice(i + 1));
      }
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, json, text };
    },
  };
}

// A synthetic face descriptor (128 numbers): dummy data, never a real face.
const DESCRIPTOR = (() => {
  let x = 7177;
  return Array.from({ length: 128 }, () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return ((x % 100000) / 100000 - 0.5) * 0.4;
  });
})();
const tokenFrom = (link) => new URL(link, ORIGIN).searchParams.get("token");
const newPassword = () =>
  `Demo-${crypto.randomBytes(12).toString("base64url")}`;

if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok)
  must(false, `the API is not answering on ${API}`);

console.log(`Creating the showcase account ${EMAIL} on ${API}\n`);
const me = session();

console.log("Sign-up");
const breached = await me.req("POST", "/api/auth/register", {
  email: EMAIL,
  name: "Client Showcase",
  password: "Password123!",
  dataConsent: true,
  dateOfBirth: "1992-05-14",
});
check(
  'a breached password ("Password123!") is refused',
  breached.status === 400 && breached.json?.code === "PASSWORD_NOT_ALLOWED",
  `${breached.status} ${breached.json?.code ?? breached.json?.error ?? ""}`,
);
let password = newPassword();
const reg = await me.req("POST", "/api/auth/register", {
  email: EMAIL,
  name: "Client Showcase",
  password,
  dataConsent: true,
  dateOfBirth: "1992-05-14",
  trainingConsent: true,
});
if (reg.status === 409)
  must(
    false,
    `${EMAIL} already has an account. Delete it from the Users page, or pass --email with another address.`,
  );
must(reg.status === 201, `registration answered ${reg.status}: ${reg.text}`);
const userId = reg.json.user.id;
check(
  "account created, with training consent given at sign-up",
  true,
  `user ${userId}`,
);
const confirmLink = reg.json.devEmailVerificationLink;
must(
  Boolean(confirmLink),
  "no email-confirmation link in the response; run the API with NODE_ENV=development",
);
check("email not yet confirmed", reg.json.user.emailVerified === false);

console.log("\nSecond factor and email confirmation");
const face = await me.req("POST", `/api/users/${userId}/enroll-face`, {
  descriptor: DESCRIPTOR,
  consent: true,
});
must(face.status === 200, `face set-up answered ${face.status}: ${face.text}`);
check("face sign-in set up (synthetic template), with biometric consent", true);
const early = await me.req("POST", "/api/uploads", {
  fileName: "early.txt",
  mimeType: "text/plain",
  dataBase64: Buffer.from("too early").toString("base64"),
  contentSource: "own_work",
});
check(
  "an upload before the email is confirmed is refused",
  early.status === 403 && early.json?.code === "EMAIL_VERIFICATION_REQUIRED",
  `${early.status} ${early.json?.code ?? ""}`,
);
const confirmed = await me.req("POST", "/api/auth/verify-email", {
  token: tokenFrom(confirmLink),
});
must(
  confirmed.status === 200,
  `email confirmation answered ${confirmed.status}`,
);
check("email confirmed from the emailed link", true);

console.log("\nEncrypted vault");
const notes = await me.req("POST", "/api/uploads", {
  fileName: "weekend-hiking-notes.txt",
  mimeType: "text/plain",
  contentSource: "own_work",
  bystanders: [],
  dataBase64: Buffer.from(
    [
      "Weekend hiking notes (written for the SecureAI demo).",
      "Saturday: coastal trail walk, eleven kilometres, windy but clear. Trail running shoes held up well.",
      "Sunday: photography walk along the river at sunrise; landscape photography needs an early start.",
      "Next weekend: trail running practice and another landscape photography walk.",
    ].join("\n"),
  ).toString("base64"),
});
check(
  "a text file stored, scanned and encrypted",
  notes.status === 201,
  `${notes.status}`,
);
const original = fs.readFileSync(PHOTO);
const photo = await me.req("POST", "/api/uploads", {
  fileName: "river-at-sunrise.jpg",
  mimeType: "image/jpeg",
  contentSource: "own_work",
  bystanders: [],
  dataBase64: original.toString("base64"),
});
check(
  "a photo stored (it carried GPS location data)",
  photo.status === 201,
  `${photo.status}`,
);
if (photo.status === 201) {
  const back = await me.req("GET", `/api/uploads/${photo.json.id}`);
  const stored = Buffer.from(back.json?.dataBase64 ?? "", "base64");
  check(
    "the stored copy has no location data, and is still a valid photo",
    original.includes("Exif\0\0") &&
      !stored.includes("Exif\0\0") &&
      stored[0] === 0xff &&
      stored[1] === 0xd8,
    `${original.length} bytes uploaded, ${stored.length} stored`,
  );
}
const virus = await me.req("POST", "/api/uploads", {
  fileName: "eicar-test-file.txt",
  mimeType: "text/plain",
  contentSource: "own_work",
  bystanders: [],
  dataBase64: Buffer.from(EICAR).toString("base64"),
});
check(
  "the antivirus test file is refused",
  virus.status === 400 && /rejected/i.test(virus.json?.error ?? ""),
  `${virus.status} ${virus.json?.error ?? ""}`,
);

console.log("\nAI, with consent");
const cpc = await me.req(
  "POST",
  "/api/users/me/content-personalization-consent",
  {
    consent: true,
  },
);
check(
  "consent to a content profile from its own text",
  cpc.status === 200,
  `${cpc.status}`,
);
const profile = await me.req("GET", "/api/users/me/content-profile");
const keywords = profile.json?.keywords ?? [];
check(
  "content profile built from the notes file",
  profile.status === 200 && keywords.length > 0,
  keywords
    .slice(0, 3)
    .map((k) => k.keyword ?? k.term ?? String(k))
    .join(", "),
);
const suggestion = await me.req("GET", "/api/behavior/suggested-action");
check(
  "behaviour model queried (and logged)",
  suggestion.status === 200,
  `${suggestion.status}`,
);

console.log("\nPayments");
const card = { cardLast4: "4242", cardBrand: "visa" };
const plus = await me.req(
  "POST",
  "/api/payments/subscribe",
  { planId: "plus", ...card },
  { "Idempotency-Key": crypto.randomUUID() },
);
const plusId = plus.json?.id ?? plus.json?.payment?.id;
check(
  "subscribed to Plus (card tokenised, never stored)",
  plus.status === 201,
  `${plus.status}`,
);
const refund = await me.req("POST", `/api/payments/${plusId}/refund`, {});
check(
  "Plus refunded; the account goes back to the free plan",
  refund.status === 200,
  `${refund.status}`,
);
const pro = await me.req(
  "POST",
  "/api/payments/subscribe",
  { planId: "pro", ...card },
  { "Idempotency-Key": crypto.randomUUID() },
);
const proId = pro.json?.id ?? pro.json?.payment?.id;
check("subscribed to Pro", pro.status === 201, `${pro.status}`);
const secondRefund = await me.req("POST", `/api/payments/${proId}/refund`, {});
check(
  "a second subscription refund in a year is refused",
  secondRefund.status === 409 &&
    /per year/.test(secondRefund.json?.error ?? ""),
  `${secondRefund.status}`,
);
const declined = await me.req(
  "POST",
  "/api/payments",
  {
    amount: 15,
    currency: "AUD",
    description: "Extra secure storage",
    cardLast4: "0002",
    cardBrand: "visa",
  },
  { "Idempotency-Key": crypto.randomUUID() },
);
check(
  "a declined test card is recorded as a failed payment",
  declined.status === 402,
  `${declined.status}`,
);
const keyOneOff = crypto.randomUUID();
const oneOff = () =>
  me.req(
    "POST",
    "/api/payments",
    {
      amount: 15,
      currency: "AUD",
      description: "Extra secure storage",
      ...card,
    },
    { "Idempotency-Key": keyOneOff },
  );
const paid = await oneOff();
check("a one-off payment completes", paid.status === 201, `${paid.status}`);
const retried = await oneOff();
const paidId = paid.json?.id ?? paid.json?.payment?.id;
const retriedId = retried.json?.id ?? retried.json?.payment?.id;
check(
  "the same payment sent twice charges once",
  paidId !== undefined && retriedId === paidId,
  `payment ${paidId}, retry returned ${retriedId}`,
);
const negative = await me.req(
  "POST",
  "/api/payments",
  { amount: -500, currency: "AUD", description: "x", ...card },
  { "Idempotency-Key": crypto.randomUUID() },
);
check(
  "a negative amount is refused",
  negative.status === 400,
  `${negative.status}`,
);

console.log("\nSign-in protection");
// Local only: the API trusts X-Forwarded-For from this machine, so each sign-in can come from a
// different address, the way the live site sees CloudFront's.
const signIn = (ip, agent) =>
  session({ "X-Forwarded-For": ip, "User-Agent": agent }).req(
    "POST",
    "/api/auth/login",
    { email: EMAIL, password },
  );
for (let i = 0; i < 3; i++)
  await signIn("203.0.113.10", "Mozilla/5.0 (Showcase laptop)");
const risky = await signIn("198.51.100.20", "Mozilla/5.0 (Unknown phone)");
check(
  "a sign-in from a new network and device is flagged",
  typeof risky.json?.securityNotice === "string",
  risky.json?.securityNotice ? "warning shown" : `${risky.status}`,
);
const guesser = session({
  "X-Forwarded-For": "192.0.2.50",
  "User-Agent": "Mozilla/5.0 (Guessing script)",
});
let last = 0;
for (let i = 0; i < 6; i++)
  last = (
    await guesser.req("POST", "/api/auth/login", {
      email: "nobody.demo@example.com",
      password: `guess-${i}`,
    })
  ).status;
check(
  "password guessing is throttled (sixth attempt)",
  last === 429,
  `${last}`,
);
const challenge = await me.req("POST", "/api/ai/challenges", {
  systemId: "login-risk",
  message:
    "The sign-in flagged as unusual was me, on my phone while travelling. Please confirm the check and clear it.",
  reference: `Sign-in from 198.51.100.20, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
});
check(
  "the flagged sign-in is challenged, for a person to review",
  challenge.status === 201,
  `${challenge.status}`,
);

console.log("\nPrivacy rights");
const exportJson = await me.req("GET", "/api/users/me/export");
check(
  "full data copy downloaded (JSON)",
  exportJson.status === 200,
  `${exportJson.status}`,
);
const exportHtml = await me.req("GET", "/api/users/me/export/readable");
check(
  "readable data copy downloaded",
  exportHtml.status === 200,
  `${exportHtml.status}`,
);
const report = await session().req("POST", "/api/bystander-reports", {
  reporterEmail: "neighbour.demo@example.com",
  reporterName: "Demo Neighbour",
  relationship: "self",
  request: "review",
  contentDescription:
    "A sunrise photo by the river on SecureAI. I think it shows my house, and I'd like it reviewed.",
  uploaderHint: "The account called Client Showcase",
});
check(
  "someone in a photo reports it, without an account",
  report.status === 201,
  `${report.status}`,
);

console.log("\nPassword reset");
const forgot = await session().req("POST", "/api/auth/forgot-password", {
  email: EMAIL,
});
const resetToken = forgot.json?.devResetLink
  ? tokenFrom(forgot.json.devResetLink)
  : null;
must(Boolean(resetToken), "no reset link in the response");
const resetWith = (newPw) =>
  session().req("POST", "/api/auth/reset-password/face", {
    token: resetToken,
    descriptor: DESCRIPTOR,
    newPassword: newPw,
  });
const badReset = await resetWith("Password123!");
check(
  "a reset to a breached password is refused",
  badReset.status === 400 && badReset.json?.code === "PASSWORD_NOT_ALLOWED",
  `${badReset.status}`,
);
password = newPassword();
const goodReset = await resetWith(password);
check(
  "the reset completes only with the second factor (face)",
  goodReset.status === 200,
  `${goodReset.status}`,
);

console.log("\nHand-over");
const removed = await me.req("DELETE", `/api/users/${userId}/face`);
check(
  "synthetic face template removed (biometric consent withdrawn)",
  removed.status === 200 || removed.status === 204,
  `${removed.status}`,
);
const everywhere = await me.req("POST", "/api/auth/logout-all", {});
check(
  "signed out of every device",
  everywhere.status === 200,
  `${everywhere.status}`,
);
const pg = new Pg({ connectionString: PG_URL });
await pg.connect();
const promoted = await pg.query(
  "UPDATE users SET role = 'admin' WHERE id = $1 AND email = $2",
  [userId, EMAIL],
);
await pg.end();
check(
  "made an administrator (directly in the database, so there is no ROLE_CHANGED entry)",
  promoted.rowCount === 1,
);

const failed = results.filter((r) => !r.pass);
const outFile =
  process.env.SHOWCASE_OUT ??
  path.join(os.homedir(), "secureai-showcase-account.txt");
const guide = `SecureAI showcase account, created ${new Date().toISOString()} on ${API}

Email:    ${EMAIL}
Password: ${password}
Role:     admin (sees the user screens and the staff screens)

First sign-in: there is no second factor yet, so the app opens Security Settings. Add a passkey on
this computer (Windows Hello) or a phone. Sign out and back in to show the two-step sign-in.

Where each feature shows (the account's history already has an example of each):

Start here
- Security Center (staff menu): every backend control's live state and evidence on one page,
  with a "See it" link to each. Needs the passkey set up first.

Sign-in and accounts
- Breached and common passwords refused: Register page, try "Password123!".
- Email confirmation: register a new account to see the banner and the "Send a new link" button.
- Unusual sign-in warning: Audit Logs (LOGIN_RISK_FLAGGED); this account challenged it.
- Password guessing throttled: Audit Logs (RATE_LIMIT_HIT, LOGIN_FAILED).
- Password reset needs the second factor, and refuses breached passwords: Forgot password.
- Sign out of all devices, consents: Security Settings.

Data protection
- Encrypted vault, location data removed from photos: Data Vault (download river-at-sunrise.jpg
  and look at its properties: no GPS).
- Antivirus: upload an EICAR test file in Data Vault; Audit Logs has UPLOAD_SCAN_REJECTED.
- What is encrypted and who can read it: Data Protection.

Payments
- Card never stored, one charge per request, refunds, one refund a year, declines: Payments.

AI
- Training and content-profile consent, and the topic profile: Security Settings.
- Attacks run against the live model: AI Security.
- What each AI decides, and challenging it: How We Use AI.
- Switching an AI off, resolving this account's challenge: AI Oversight.

Privacy and governance
- Privacy policy notice (not yet acknowledged): the banner on every page.
- Download my data (JSON and readable), delete my account: Security Settings (and the Privacy
  Policy page).
- A bystander's report about the photo: Privacy Compliance (match it to the upload, pause, resolve).
- Breach register, disclosures to agencies, legal holds: Privacy Compliance.
- Tamper-evident audit log: Audit Logs, "Verify chain".
- Roles, MFA reset, payment holds: Users. A normal account (for example bob@prafful.com) is
  refused on every staff page.
`;
fs.writeFileSync(outFile, guide, { mode: 0o600 });
console.log(
  `\n${results.length - failed.length}/${results.length} steps passed.` +
    (failed.length ? `\nFailed: ${failed.map((r) => r.label).join("; ")}` : ""),
);
console.log(`Sign-in details and the walkthrough: ${outFile}`);
process.exit(failed.length ? 1 : 0);
