// DAST: an authenticated OWASP ZAP active scan of the API running locally, driven by the OpenAPI
// spec, once as a normal user and once as an admin (docs/04, pre-deployment testing).
//
//   ZAP_HOME=/path/to/ZAP_2.17.0 node scripts/security/dast/zap-local.mjs
//
// Needs: the API on http://localhost:8080 (a local build, never production: an active scan sends
// attack payloads and creates and deletes records), the local Postgres superuser (to make the
// admin scan account an admin), Java 17+, and the ZAP cross-platform release unpacked at ZAP_HOME.
//
// What it does:
//   1. creates two scan accounts with face sign-in set up (MFA complete), one made admin, plus an
//      upload and a payment the user owns;
//   2. writes a scan-only copy of the spec whose {id} path parameters point at those records, so
//      requests reach the handlers instead of 404ing on an empty ID;
//   3. runs a ZAP automation plan per account: session cookie and CSRF token injected by the
//      replacer, the spec imported, then a medium-strength active scan;
//   4. prints every alert, deletes the scan accounts, and exits 1 on any Medium or High alert.
//
// Endpoints that would end the scan's own session (logout, removing its face sign-in, MFA reset)
// and the audit-log repair/restore maintenance endpoints are excluded. Rate limits stay on, so
// payloads against rate-limited routes (sign-in, registration, payments, uploads) mostly get 429:
// those handlers are exercised by scripts/src/security/adversarial-probes.ts instead.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const require = createRequire(path.join(REPO, "lib/db/package.json"));
const { Client: Pg } = require("pg");
const YAML = createRequire(path.join(REPO, "scripts/package.json"))("yaml");

const API = "http://localhost:8080";
const ZAP_HOME = process.env.ZAP_HOME;
const PG_URL =
  process.env.LOCAL_PG_SUPERUSER_URL ??
  "postgres://postgres:postgres@localhost:5433/secureai";
const MAX_MINUTES = Number(process.env.ZAP_MAX_MINUTES ?? 10);
if (!ZAP_HOME) throw new Error("Set ZAP_HOME to the unpacked ZAP release");
const zapJar = fs
  .readdirSync(ZAP_HOME)
  .find((f) => /^zap-[\d.]+\.jar$/.test(f));
if (!zapJar) throw new Error(`No zap-<version>.jar in ${ZAP_HOME}`);
if (!(await fetch(`${API}/api/healthz`).catch(() => null))?.ok)
  throw new Error(`The API is not answering on ${API}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "secureai-zap-"));
const run = Date.now().toString(36);

function client() {
  const jar = new Map();
  return {
    jar,
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    async req(method, p, body) {
      const headers = {};
      if (method !== "GET" && !jar.has("csrf_token"))
        await this.req("GET", "/api/healthz");
      if (jar.size) headers.cookie = this.cookie();
      if (method !== "GET") headers["x-csrf-token"] = jar.get("csrf_token");
      if (body) headers["content-type"] = "application/json";
      const res = await fetch(API + p, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const sc of res.headers.getSetCookie()) {
        const [kv] = sc.split(";");
        const i = kv.indexOf("=");
        jar.set(kv.slice(0, i), kv.slice(i + 1));
      }
      return { status: res.status, json: await res.json().catch(() => null) };
    },
  };
}
// A synthetic face descriptor (128 numbers): dummy data, never a real face.
const descriptor = (seed) => {
  let x = seed;
  return Array.from({ length: 128 }, () => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return ((x % 100000) / 100000 - 0.5) * 0.4;
  });
};
async function account(label, seed) {
  const c = client();
  const email = `qa-zap-${label}-${run}@example.com`;
  const reg = await c.req("POST", "/api/auth/register", {
    email,
    name: `ZAP ${label}`,
    password: `Zap-${run}-Passw0rd!`,
    dataConsent: true,
    dateOfBirth: "1990-01-01",
  });
  if (reg.status !== 201)
    throw new Error(`register ${label}: HTTP ${reg.status}`);
  const face = await c.req(
    "POST",
    `/api/users/${reg.json.user.id}/enroll-face`,
    { descriptor: descriptor(seed), consent: true },
  );
  if (face.status !== 200)
    throw new Error(`face set-up ${label}: HTTP ${face.status}`);
  return { c, email, id: reg.json.user.id };
}

const pg = new Pg({ connectionString: PG_URL });
await pg.connect();
const accounts = [];
let failures = 0;
try {
  const user = await account("user", 5151);
  const admin = await account("admin", 6161);
  accounts.push(user, admin);
  await pg.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
  const upload = await user.c.req("POST", "/api/uploads", {
    fileName: "zap.txt",
    mimeType: "text/plain",
    dataBase64: Buffer.from("zap scan file").toString("base64"),
    contentSource: "own_work",
  });
  const payment = await user.c.req("POST", "/api/payments", {
    amount: 5,
    currency: "AUD",
    description: "zap scan",
    cardLast4: "4242",
    cardBrand: "visa",
  });
  const ids = {
    upload: upload.json?.id,
    payment: payment.json?.id ?? payment.json?.payment?.id,
  };

  const spec = YAML.parse(
    fs.readFileSync(path.join(REPO, "lib/api-spec/openapi.yaml"), "utf8"),
  );
  const exampleFor = (p) =>
    p.startsWith("/uploads/")
      ? ids.upload
      : p.startsWith("/payments/")
        ? ids.payment
        : p.startsWith("/ai/systems/")
          ? "face-recognition"
          : user.id;
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const param of [
      ...(item.parameters ?? []),
      ...Object.values(item).flatMap((op) => op?.parameters ?? []),
    ]) {
      if (param.in === "path") param.example = exampleFor(p);
    }
  }
  const specFile = path.join(work, "openapi-scan.yaml").replaceAll("\\", "/");
  fs.writeFileSync(specFile, YAML.stringify(spec));

  const plan = (label, acct) => ({
    env: {
      contexts: [
        {
          name: `secureai-${label}`,
          urls: [`${API}/api`],
          includePaths: [`${API}/api.*`],
          excludePaths: [
            `${API}/api/auth/logout.*`,
            `${API}/api/users/${acct.id}/face`,
            `${API}/api/users/${acct.id}/reset-mfa`,
            `${API}/api/security/logs/repair`,
            `${API}/api/security/logs/restore`,
          ],
        },
      ],
      parameters: { failOnError: true, progressToStdout: true },
    },
    jobs: [
      {
        type: "replacer",
        parameters: { deleteAllRules: true },
        rules: [
          {
            description: `session (${label})`,
            matchType: "req_header",
            matchString: "Cookie",
            matchRegex: false,
            replacementString: acct.c.cookie(),
          },
          {
            description: "CSRF token",
            matchType: "req_header",
            matchString: "X-CSRF-Token",
            matchRegex: false,
            replacementString: acct.c.jar.get("csrf_token"),
          },
        ],
      },
      {
        type: "openapi",
        parameters: {
          apiFile: specFile,
          targetUrl: `${API}/api`,
          context: `secureai-${label}`,
        },
      },
      { type: "passiveScan-wait", parameters: { maxDuration: 5 } },
      {
        type: "activeScan",
        parameters: {
          context: `secureai-${label}`,
          maxScanDurationInMins: MAX_MINUTES,
          threadPerHost: 4,
        },
        policyDefinition: {
          defaultStrength: "medium",
          defaultThreshold: "medium",
        },
      },
      { type: "passiveScan-wait", parameters: { maxDuration: 5 } },
      {
        type: "report",
        parameters: {
          template: "traditional-json",
          reportDir: work.replaceAll("\\", "/"),
          reportFile: `zap-${label}`,
        },
      },
      {
        type: "report",
        parameters: {
          template: "traditional-html",
          reportDir: work.replaceAll("\\", "/"),
          reportFile: `zap-${label}`,
        },
      },
    ],
  });

  for (const [label, acct] of [
    ["user", user],
    ["admin", admin],
  ]) {
    const planFile = path.join(work, `plan-${label}.yaml`);
    fs.writeFileSync(planFile, YAML.stringify(plan(label, acct)));
    console.log(`\n▸ ZAP active scan as ${label} (up to ${MAX_MINUTES} min)`);
    const zap = spawnSync(
      "java",
      [
        "-Xmx2g",
        "-jar",
        zapJar,
        "-cmd",
        "-port",
        "8099",
        "-dir",
        path.join(work, `home-${label}`),
        "-autorun",
        planFile,
      ],
      { cwd: ZAP_HOME, stdio: ["ignore", "ignore", "inherit"] },
    );
    if (zap.status !== 0) throw new Error(`ZAP exited with ${zap.status}`);
    const report = JSON.parse(
      fs.readFileSync(path.join(work, `zap-${label}.json`), "utf8"),
    );
    const alerts = report.site
      .filter((s) => s["@name"].startsWith(API))
      .flatMap((s) => s.alerts);
    for (const a of alerts.sort((x, y) => y.riskcode - x.riskcode)) {
      console.log(`  [${a.riskdesc}] ${a.name} (${a.count})`);
      if (Number(a.riskcode) >= 2) failures += 1;
    }
    if (!alerts.length) console.log("  no alerts");
  }
  console.log(`\nReports: ${work}`);
} finally {
  // The audit rows these accounts produced stay: the hash chain must not be edited.
  if (accounts.length)
    await pg.query("DELETE FROM users WHERE email = ANY($1)", [
      accounts.map((a) => a.email),
    ]);
  await pg.end();
}
console.log(
  failures
    ? `\n${failures} Medium/High alert type(s)\n`
    : "\nNo Medium or High alerts\n",
);
process.exit(failures ? 1 : 0);
