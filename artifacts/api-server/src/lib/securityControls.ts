/**
 * The Security Center report (GET /security/controls, security analysts and administrators): every
 * backend control, whether it is working on this server right now, and live evidence from the
 * database and this server's settings. Built for showing the client what the backend does; nothing
 * here is a secret (no key material, passwords, addresses or tokens), only states, counts and the
 * limits the code applies.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyLogChain } from "./auditLog";
import {
  LOGIN_MAX_ATTEMPTS_PER_ACCOUNT,
  LOGIN_MAX_ATTEMPTS_PER_IP,
  LOGIN_RATE_WINDOW_MS,
  REGISTER_MAX_ATTEMPTS_PER_IP,
  RESET_REQUEST_MAX_PER_ACCOUNT,
  RESET_REQUEST_MAX_PER_IP,
} from "./authLimits";
import {
  breachLookupEnabled,
  COMMON_PASSWORD_COUNT,
} from "./breachedPasswords";
import { currentKeyId, hasIndependentKey } from "./fileEncryption";
import { countNotOnCurrentKey } from "./keyRotation";
import { clamdCommand, clamdTarget } from "./clamdClient";
import { computeActiveAlerts } from "./securityAlerting";
import { alertRecipients } from "./alertEmail";
import { isEmailConfigured } from "./mailer";
import { devAuthLinksEnabled } from "./devLinks";
import { aiSystemStates } from "./aiGovernance";
import { AI_SYSTEMS } from "./aiSystems";
import { MIN_DISTINCT_USERS } from "./behaviorModel";
import {
  MAX_CONTRIBUTED_TRANSITIONS_PER_USER,
  readEpsilonFromEnv,
} from "./behaviorModelPrivacy";
import { ABSOLUTE_SESSION_MAX_MS, IDLE_TIMEOUT_MS } from "./sessionPolicy";
import { MAX_SIGNED_IN_DEVICES } from "./sessionLimit";
import { RETENTION } from "./retention";
import { ALLOWED_ORIGINS } from "./allowedOrigins";

export type ControlStatus = "on" | "partial" | "off";

export interface SecurityControl {
  id: string;
  name: string;
  status: ControlStatus;
  summary: string;
  evidence: { label: string; value: string }[];
  where: string | null;
  whereLabel: string | null;
}

export interface SecurityControlSection {
  id: string;
  title: string;
  controls: SecurityControl[];
}

const n = (value: unknown) => Number(value ?? 0).toLocaleString("en-AU");
const minutes = (ms: number) => `${Math.round(ms / 60000)} minutes`;
const accounts = (value: unknown) =>
  `${n(value)} account${Number(value) === 1 ? "" : "s"}`;

/** Security events counted over the last 7 days, by type. */
const EVENT_TYPES = [
  "RATE_LIMIT_HIT",
  "LOGIN_FAILED",
  "LOGIN_RISK_FLAGGED",
  "AI_DECISION_CHALLENGED",
  "SESSION_LIMIT_ENFORCED",
  "EMAIL_VERIFIED",
  "UPLOAD_SCAN_REJECTED",
  "DATA_EXPORTED",
  "UNAUTHORIZED_ACCESS",
  "PAYMENT_WEBHOOK_REJECTED",
] as const;

async function counts() {
  const [accounts, roles, events, privacy] = await Promise.all([
    db.execute<Record<string, number>>(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE u.face_enrolled)::int AS face,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id))::int AS passkey,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM biometric_keys b WHERE b.user_id = u.id))::int AS phone_key,
        count(*) FILTER (WHERE NOT u.face_enrolled
          AND NOT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM biometric_keys b WHERE b.user_id = u.id))::int AS no_second_factor,
        count(*) FILTER (WHERE NOT u.email_verified)::int AS unconfirmed,
        count(*) FILTER (WHERE u.training_consent_given)::int AS training_consent,
        count(*) FILTER (WHERE u.content_personalization_consent_given)::int AS content_consent,
        count(*) FILTER (WHERE u.payment_hold)::int AS payment_hold
      FROM users u`),
    db.execute<{ role: string; n: number }>(
      sql`SELECT role, count(*)::int AS n FROM users GROUP BY role ORDER BY role`,
    ),
    db.execute<{ event_type: string; n: number }>(sql`
      SELECT event_type, count(*)::int AS n FROM security_logs
      WHERE timestamp > now() - interval '7 days'
        AND event_type IN (${sql.join(
          EVENT_TYPES.map((t) => sql`${t}`),
          sql`, `,
        )})
      GROUP BY event_type`),
    db.execute<Record<string, number>>(sql`
      SELECT
        (SELECT count(*)::int FROM data_breaches) AS breaches,
        (SELECT count(*)::int FROM legal_holds WHERE released_at IS NULL) AS active_holds,
        (SELECT count(*)::int FROM government_disclosures) AS disclosures,
        (SELECT count(*)::int FROM bystander_reports WHERE status IN ('open', 'paused')) AS open_bystander_reports,
        (SELECT count(*)::int FROM security_log_retention) AS retention_stubs`),
  ]);
  const byType = new Map(events.rows.map((r) => [r.event_type, r.n]));
  return {
    accounts: accounts.rows[0] ?? {},
    roles: roles.rows,
    event: (type: (typeof EVENT_TYPES)[number]) => byType.get(type) ?? 0,
    privacy: privacy.rows[0] ?? {},
  };
}

async function scannerState(): Promise<{
  status: ControlStatus;
  engine: string;
}> {
  const target = clamdTarget();
  if (!target)
    return {
      status: "partial",
      engine:
        "Built-in signature checks only (ClamAV is not configured on this server)",
    };
  const version = await clamdCommand("VERSION", target.host, target.port, 2000);
  return version
    ? {
        status: "on",
        engine: `ClamAV (${version.trim()}) and signature checks`,
      }
    : {
        status: "off",
        engine: "ClamAV configured but not answering: uploads are refused",
      };
}

export async function buildSecurityControlsReport(
  responseHeaders: Record<string, string | null>,
): Promise<{ generatedAt: string; sections: SecurityControlSection[] }> {
  const [c, chain, alerts, scanner, notOnKey, aiStates] = await Promise.all([
    counts(),
    verifyLogChain(),
    computeActiveAlerts(),
    scannerState(),
    countNotOnCurrentKey(),
    aiSystemStates(),
  ]);
  const a = c.accounts;
  const p = c.privacy;
  const emailMode = isEmailConfigured()
    ? "Sent by email"
    : devAuthLinksEnabled()
      ? "Shown on screen (local development only)"
      : "No email account configured: new accounts can't confirm";
  const notOnKeyTotal = Object.values(notOnKey).reduce((s, v) => s + v, 0);
  const epsilon = readEpsilonFromEnv();
  const loginRiskOn = aiStates.get("login-risk")?.enabled ?? true;

  const signIn: SecurityControl[] = [
    {
      id: "password-check",
      name: "Breached and common passwords refused",
      status: breachLookupEnabled() ? "on" : "partial",
      summary:
        "New passwords at sign-up and reset are checked against the most common passwords and Have I Been Pwned's breach list (only 5 characters of a hash leave the server), and refused if they contain the email's name or \"SecureAI\". NIST SP 800-63B.",
      evidence: [
        { label: "Minimum length", value: "8 characters" },
        {
          label: "Common passwords list",
          value: `${n(COMMON_PASSWORD_COUNT)} entries`,
        },
        {
          label: "Breach lookup",
          value: breachLookupEnabled()
            ? "Have I Been Pwned range API (k-anonymity)"
            : "Off (BREACHED_PASSWORD_API=off)",
        },
      ],
      where: null,
      whereLabel: 'Try "Password123!" on the sign-up page',
    },
    {
      id: "mfa",
      name: "Two-step sign-in",
      status: "on",
      summary:
        "After the password, every account needs a second factor: a passkey or phone key that signs a challenge from the server, or a face check. Protected pages and APIs refuse an account without one.",
      evidence: [
        { label: "Accounts with a passkey", value: n(a["passkey"]) },
        { label: "Accounts with a phone key", value: n(a["phone_key"]) },
        { label: "Accounts with face sign-in", value: n(a["face"]) },
        {
          label: "Accounts still to set one up",
          value: n(a["no_second_factor"]),
        },
      ],
      where: "/enroll",
      whereLabel: "Security Settings",
    },
    {
      id: "throttling",
      name: "Password guessing throttled",
      status: "on",
      summary:
        "Sign-in, sign-up and reset requests are counted per account and per network address, and refused (429) past the limit. The address comes only from the server's trusted proxies, so it can't be forged.",
      evidence: [
        {
          label: "Failed sign-ins",
          value: `${LOGIN_MAX_ATTEMPTS_PER_ACCOUNT} per account, ${LOGIN_MAX_ATTEMPTS_PER_IP} per address, per ${minutes(LOGIN_RATE_WINDOW_MS)}`,
        },
        {
          label: "Sign-ups",
          value: `${REGISTER_MAX_ATTEMPTS_PER_IP} per address per hour`,
        },
        {
          label: "Reset emails",
          value: `${RESET_REQUEST_MAX_PER_ACCOUNT} per account, ${RESET_REQUEST_MAX_PER_IP} per address, per hour`,
        },
        {
          label: "Requests refused, last 7 days",
          value: n(c.event("RATE_LIMIT_HIT")),
        },
        {
          label: "Failed sign-ins, last 7 days",
          value: n(c.event("LOGIN_FAILED")),
        },
      ],
      where: "/security-logs?eventType=RATE_LIMIT_HIT",
      whereLabel: "Audit Logs: requests refused",
    },
    {
      id: "login-risk",
      name: "Unusual sign-ins flagged",
      status: loginRiskOn ? "on" : "off",
      summary:
        "Each correct password is compared with that account's own sign-in history: a new network, a new device or an unusual time is flagged, and the person is warned and can challenge it.",
      evidence: [
        { label: "Check", value: loginRiskOn ? "On" : "Switched off by staff" },
        {
          label: "Sign-ins flagged, last 7 days",
          value: n(c.event("LOGIN_RISK_FLAGGED")),
        },
        {
          label: "AI decisions challenged, last 7 days",
          value: n(c.event("AI_DECISION_CHALLENGED")),
        },
      ],
      where: "/ai-oversight",
      whereLabel: "AI Oversight",
    },
    {
      id: "sessions",
      name: "Sessions expire and are limited",
      status: "on",
      summary:
        "Sessions are stored on the server, renewed on every sign-in, and end after inactivity or a fixed time, whichever comes first. Signing in on one device too many signs out the oldest.",
      evidence: [
        { label: "Idle timeout", value: minutes(IDLE_TIMEOUT_MS) },
        {
          label: "Longest session",
          value: `${Math.round(ABSOLUTE_SESSION_MAX_MS / 3600000)} hours`,
        },
        {
          label: "Devices at once",
          value: `${MAX_SIGNED_IN_DEVICES.free} (Team plan ${MAX_SIGNED_IN_DEVICES.team})`,
        },
        {
          label: "Devices signed out by the limit, last 7 days",
          value: n(c.event("SESSION_LIMIT_ENFORCED")),
        },
      ],
      where: "/enroll",
      whereLabel: "Security Settings: sign out of all devices",
    },
    {
      id: "email-confirmation",
      name: "Email confirmed before uploads and payments",
      status: isEmailConfigured() || devAuthLinksEnabled() ? "on" : "partial",
      summary:
        "A new account gets a single-use, 24-hour link; until it is opened, uploads and payments are refused. Signing in, two-step set-up and privacy rights never wait for it.",
      evidence: [
        { label: "Confirmation link", value: emailMode },
        { label: "Accounts waiting to confirm", value: n(a["unconfirmed"]) },
        {
          label: "Addresses confirmed, last 7 days",
          value: n(c.event("EMAIL_VERIFIED")),
        },
      ],
      where: null,
      whereLabel: "Register a new account to see the banner",
    },
  ];

  const data: SecurityControl[] = [
    {
      id: "encryption",
      name: "Sensitive data encrypted at rest",
      status: hasIndependentKey() ? "on" : "partial",
      summary:
        "Face templates, uploaded files and payment tokens are encrypted with AES-256-GCM before they are stored. Each value records its key, so the key can be replaced while the site runs.",
      evidence: [
        { label: "Algorithm", value: "AES-256-GCM" },
        { label: "Key in use", value: currentKeyId() },
        {
          label: "Key source",
          value: hasIndependentKey()
            ? "Its own key, separate from every other secret"
            : "Derived from SESSION_SECRET (set FILE_ENCRYPTION_KEY)",
        },
        {
          label: "Values not yet on this key",
          value:
            notOnKeyTotal === 0
              ? "None"
              : Object.entries(notOnKey)
                  .map(([label, count]) => `${n(count)} ${label}`)
                  .join(", "),
        },
      ],
      where: "/data-protection",
      whereLabel: "Data Protection",
    },
    {
      id: "malware-scan",
      name: "Uploads scanned for malware",
      status: scanner.status,
      summary:
        "Every upload is scanned before it is stored, and its real type is read from its bytes, not the name. If a configured scanner doesn't answer, uploads are refused rather than stored unchecked.",
      evidence: [
        { label: "Scanner", value: scanner.engine },
        {
          label: "Files refused, last 7 days",
          value: n(c.event("UPLOAD_SCAN_REJECTED")),
        },
      ],
      where: "/security-logs?eventType=UPLOAD_SCAN_REJECTED",
      whereLabel: "Audit Logs: files refused",
    },
    {
      id: "metadata",
      name: "Location data removed from photos and videos",
      status: "on",
      summary:
        "GPS and other embedded metadata are removed before a file is encrypted, without touching the picture or video itself.",
      evidence: [
        { label: "Formats", value: "JPEG, PNG, GIF, WebP, MP4 and MOV" },
      ],
      where: "/uploads",
      whereLabel: "Data Vault",
    },
    {
      id: "retention",
      name: "Records deleted when no longer needed",
      status: "on",
      summary:
        "An hourly job removes expired links and old records. Removed log entries leave a hash-only stub, so the audit chain can still be proved.",
      evidence: [
        {
          label: "Security log entries",
          value: `${RETENTION.securityLogMonths} months`,
        },
        {
          label: "AI challenge records",
          value: `${RETENTION.aiChallengeRecordYears} years`,
        },
        {
          label: "Payment records",
          value: `${RETENTION.paymentRecordsYears} years`,
        },
        { label: "Log entries removed so far", value: n(p["retention_stubs"]) },
      ],
      where: "/privacy",
      whereLabel: "Privacy Policy",
    },
    {
      id: "access-control",
      name: "Role-based access",
      status: "on",
      summary:
        "Four roles, checked on the server for every request. A person can only reach their own records; staff pages refuse other roles.",
      evidence: c.roles.map((r) => ({ label: r.role, value: accounts(r.n) })),
      where: "/users",
      whereLabel: "Users",
    },
  ];

  const monitoring: SecurityControl[] = [
    {
      id: "audit-chain",
      name: "Tamper-evident audit log",
      status: chain.valid ? "on" : "off",
      summary:
        "Every security event is chained to the one before it with SHA-256, so editing, deleting or reordering an entry is detected. A database trigger also records any deletion.",
      evidence: [
        {
          label: "Chain check, just now",
          value: chain.valid
            ? "Intact"
            : `Broken at entry ${chain.brokenAtId}: ${chain.reason}`,
        },
        { label: "Entries checked", value: n(chain.rowsChecked) },
        {
          label: "Removed by retention (stubs checked)",
          value: n(chain.purgedByRetention),
        },
      ],
      where: "/security-logs",
      whereLabel: "Audit Logs: Verify chain",
    },
    {
      id: "alerts",
      name: "Suspicious activity alerts",
      status: "on",
      summary:
        "Every 2 minutes the server looks for spikes (failed sign-ins, face-check probing, upload floods, account sharing) and raises alerts on the dashboard, and by email or webhook when configured.",
      evidence: [
        {
          label: "Active alerts",
          value: `${n(alerts.length)} (${n(alerts.filter((x) => x.severity === "high").length)} high)`,
        },
        { label: "Alert email recipients", value: n(alertRecipients().length) },
        {
          label: "Webhook",
          value: process.env["SECURITY_ALERT_WEBHOOK_URL"]
            ? "Configured"
            : "Not configured",
        },
      ],
      where: "/dashboard",
      whereLabel: "Dashboard",
    },
    {
      id: "privacy-operations",
      name: "Privacy and legal requests tracked",
      status: "on",
      summary:
        "Data breaches, disclosures to government agencies, legal holds and reports from people shown in someone's upload each have a record, deadlines and an audit trail.",
      evidence: [
        { label: "Breach records", value: n(p["breaches"]) },
        { label: "Disclosures to agencies", value: n(p["disclosures"]) },
        { label: "Active legal holds", value: n(p["active_holds"]) },
        {
          label: "Open bystander reports",
          value: n(p["open_bystander_reports"]),
        },
        {
          label: "Data copies downloaded, last 7 days",
          value: n(c.event("DATA_EXPORTED")),
        },
      ],
      where: "/privacy-compliance",
      whereLabel: "Privacy Compliance",
    },
  ];

  const hardening: SecurityControl[] = [
    {
      id: "headers",
      name: "Browser security headers",
      status: "on",
      summary:
        "Every API response carries a strict Content-Security-Policy and refuses framing and type sniffing. These are the headers on this very response.",
      evidence: Object.entries(responseHeaders).map(([label, value]) => ({
        label,
        value: value ?? "Not set here (production only, over HTTPS)",
      })),
      where: null,
      whereLabel: null,
    },
    {
      id: "csrf-cors",
      name: "Cross-site request protection",
      status: "on",
      summary:
        "Every change needs a CSRF token that matches the session's cookie, and only listed origins may call the API. Cookies are HttpOnly and SameSite=Lax.",
      evidence: [
        {
          label: "Allowed origins",
          value: ALLOWED_ORIGINS.join(", ") || "None",
        },
        {
          label: "Refused cross-account or unauthorised requests, last 7 days",
          value: n(c.event("UNAUTHORIZED_ACCESS")),
        },
      ],
      where: null,
      whereLabel: null,
    },
    {
      id: "input-validation",
      name: "Every request validated",
      status: "on",
      summary:
        "Request bodies and parameters are checked against the OpenAPI schema (Zod) before a handler runs; database queries are parameterised; NUL characters are refused.",
      evidence: [
        {
          label: "Payment notifications refused, last 7 days",
          value: n(c.event("PAYMENT_WEBHOOK_REJECTED")),
        },
      ],
      where: null,
      whereLabel: null,
    },
  ];

  const ai: SecurityControl[] = [
    {
      id: "ai-systems",
      name: "AI systems under staff control",
      status: "on",
      summary:
        "Each AI system has an owner and an off switch; switching one off takes effect within seconds and is recorded.",
      evidence: AI_SYSTEMS.map((s) => ({
        label: s.name,
        value: (aiStates.get(s.id)?.enabled ?? true) ? "On" : "Switched off",
      })),
      where: "/ai-oversight",
      whereLabel: "AI Oversight",
    },
    {
      id: "ai-privacy",
      name: "The behaviour model protects individuals",
      status: "on",
      summary:
        "It learns only from accounts that opted in, caps each account's influence, and only shows a pattern several different accounts share, so no single person's activity can be read back out.",
      evidence: [
        { label: "Accounts that opted in", value: n(a["training_consent"]) },
        {
          label: "Accounts needed before a pattern is shown",
          value: String(MIN_DISTINCT_USERS),
        },
        {
          label: "Most one account can contribute",
          value: `${MAX_CONTRIBUTED_TRANSITIONS_PER_USER} transitions`,
        },
        {
          label: "Differential privacy",
          value: epsilon === null ? "Off" : `On (epsilon ${epsilon})`,
        },
        {
          label: "Content profiles allowed",
          value: accounts(a["content_consent"]),
        },
      ],
      where: "/ai-security",
      whereLabel: "AI Security",
    },
  ];

  const assurance: SecurityControl[] = [
    {
      id: "ci",
      name: "Attacked on every change",
      status: "on",
      summary:
        "Every proposed change runs these checks on GitHub and can't be merged until they pass. They run there, not on this server.",
      evidence: [
        { label: "Static analysis", value: "Semgrep (OWASP Top 10 rules)" },
        { label: "Dependencies", value: "pnpm audit" },
        {
          label: "Attack probes",
          value: "SQL injection, CSRF, access control, IDOR, XSS and more",
        },
        {
          label: "Dynamic scan",
          value: "OWASP ZAP, signed in as a user and an admin",
        },
        { label: "Load test", value: "Rate limits under concurrent requests" },
      ],
      where: null,
      whereLabel: null,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    sections: [
      { id: "sign-in", title: "Sign-in and accounts", controls: signIn },
      { id: "data", title: "Data protection", controls: data },
      { id: "monitoring", title: "Audit and monitoring", controls: monitoring },
      { id: "hardening", title: "Web and API hardening", controls: hardening },
      { id: "ai", title: "AI", controls: ai },
      { id: "assurance", title: "Assurance", controls: assurance },
    ],
  };
}
