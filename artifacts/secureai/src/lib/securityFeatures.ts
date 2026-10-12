// Every security feature in SecureAI, for the Security Center's "All features" tab. Where a live check
// on the server reports a feature, controlId names it (GET /security/controls), and the tab shows its
// status. Keep in step with docs/04 when a feature is added or removed.

export interface SecurityFeature {
  name: string;
  detail: string;
  /** The live control in the Security Center that reports this feature, if any. */
  controlId?: string;
  /** A page in the app where it can be seen. */
  where?: string;
  /** Where to look, when there's no page to link (or to describe the link). */
  whereLabel?: string;
}

export interface SecurityFeatureArea {
  id: string;
  title: string;
  features: SecurityFeature[];
}

const PHONE_APP = "Phone app (Android and iPhone)";
const SIGNED_OUT = "Sign-in page, signed out";

export const SECURITY_FEATURE_AREAS: SecurityFeatureArea[] = [
  {
    id: "sign-in",
    title: "Sign-in and accounts",
    features: [
      {
        name: "Hashed passwords",
        detail:
          "Passwords are stored only as bcrypt hashes (cost 12), never in plain text and never in logs.",
      },
      {
        name: "Breached and common passwords refused",
        detail:
          "At sign-up and reset, passwords from known breaches (Have I Been Pwned; only 5 characters of a hash are sent), the most common passwords and ones built from the email are refused (NIST SP 800-63B).",
        controlId: "password-check",
        whereLabel: 'Sign-up page, signed out: try "Password123!"',
      },
      {
        name: "Two-step sign-in for every account",
        detail:
          "A password alone never gives access: the server refuses protected pages and APIs until a second factor is set up and used.",
        controlId: "mfa",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Passkeys",
        detail:
          "WebAuthn/FIDO2 passkeys: the private key never leaves the device, and the server checks a signature over a fresh challenge.",
        controlId: "mfa",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Phone key",
        detail:
          "In the phone app, fingerprint or Face ID unlocks a hardware-backed key that signs the server's challenge.",
        controlId: "mfa",
        whereLabel: PHONE_APP,
      },
      {
        name: "Face check with liveness",
        detail:
          "Optional face sign-in with a blink check, stored as an encrypted template and only with separate biometric consent.",
        controlId: "mfa",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Device linking",
        detail:
          "A new phone is linked with a 10-minute, single-use code that only an already-verified session can create.",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Password reset needs the second factor",
        detail:
          "A reset link alone changes nothing: the face or passkey must be verified too. Links are single-use, last 30 minutes and are stored as hashes.",
        whereLabel: `${SIGNED_OUT}: "Forgot?"`,
      },
      {
        name: "Email confirmation",
        detail:
          "New accounts confirm their email from a single-use, 24-hour link before they can upload files or pay.",
        controlId: "email-confirmation",
        whereLabel: "Register a new account to see the banner",
      },
      {
        name: "Password-guessing limits",
        detail:
          "Failed sign-ins are capped per account and per network address, as are sign-ups and reset emails; past the limit the server refuses (429).",
        controlId: "throttling",
        where: "/security-logs?eventType=RATE_LIMIT_HIT",
        whereLabel: "Audit Logs: requests refused",
      },
      {
        name: "Forge-proof network address",
        detail:
          "Only CloudFront and the server itself may report a visitor's address, so the limits can't be dodged with a fake header.",
        controlId: "throttling",
      },
      {
        name: "No account guessing",
        detail:
          "A wrong email and a wrong password get the same answer in the same time, and reset requests answer the same whether or not the account exists.",
        whereLabel: SIGNED_OUT,
      },
      {
        name: "Unusual sign-in detection",
        detail:
          "A correct password from a new network, a new device, a quick network switch or an unusual time is flagged, and the person is warned.",
        controlId: "login-risk",
        where: "/security-logs?eventType=LOGIN_RISK_FLAGGED",
        whereLabel: "Audit Logs: flagged sign-ins",
      },
      {
        name: "Secure sessions",
        detail:
          "Sessions live on the server, in HttpOnly, Secure, SameSite cookies; they end after 30 idle minutes or 12 hours, with a new session ID at every sign-in.",
        controlId: "sessions",
      },
      {
        name: "Sign out of all devices",
        detail: "One button ends every session on every device.",
        controlId: "sessions",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Device limit per plan",
        detail:
          "Each plan allows a set number of devices at once; the oldest is signed out, and repeated hits raise an account-sharing alert.",
        controlId: "sessions",
      },
      {
        name: "Password check before deleting an account",
        detail: "Deleting your own account asks for your password again.",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Parental consent for under-18s",
        detail:
          "Accounts of people under 18 are paused until a parent or guardian confirms by email.",
        whereLabel: "Sign-up page, signed out",
      },
    ],
  },
  {
    id: "access",
    title: "Access control",
    features: [
      {
        name: "Four roles",
        detail:
          "User, administrator, security analyst and IT support, checked by the server on every request.",
        controlId: "access-control",
        where: "/users",
        whereLabel: "Users",
      },
      {
        name: "Owner-only records",
        detail:
          "Another account's files, payments or profile are refused even with a guessed ID (IDOR protection).",
        controlId: "access-control",
      },
      {
        name: "Least-privilege database login",
        detail:
          "The app's database login can read and write its own tables but can't create, drop or alter them.",
      },
      {
        name: "Network lockdown",
        detail:
          "On the live site the database accepts only the API server, and the API server accepts only CloudFront.",
      },
      {
        name: "Staff actions logged",
        detail:
          "Role changes, sign-in resets and payment holds are staff-only and logged with the old value, the new value and who acted.",
        where: "/security-logs?eventType=ROLE_CHANGED",
        whereLabel: "Audit Logs: role changes",
      },
    ],
  },
  {
    id: "data",
    title: "Data protection",
    features: [
      {
        name: "Encryption at rest",
        detail:
          "Face templates, uploaded files and payment tokens are encrypted with AES-256-GCM before they are stored.",
        controlId: "encryption",
        where: "/data-protection",
        whereLabel: "Data Protection",
      },
      {
        name: "Key rotation",
        detail:
          "Encryption has its own key, which can be replaced while the site runs; older records are re-encrypted in the background.",
        controlId: "encryption",
      },
      {
        name: "Encryption in transit",
        detail:
          "HTTPS with HSTS for every visit, and a certificate-checked TLS connection from the API to its database.",
        controlId: "headers",
      },
      {
        name: "Malware scanning",
        detail:
          "Every upload is scanned (ClamAV and built-in signatures) before it is stored; if the scanner is down, uploads are refused, not stored unchecked.",
        controlId: "malware-scan",
        where: "/uploads",
        whereLabel: "Data Vault",
      },
      {
        name: "Real file type",
        detail:
          "A file's type is read from its bytes, not its name, so a disguised file can't slip through.",
        controlId: "malware-scan",
      },
      {
        name: "Location data removed",
        detail:
          "GPS and other metadata are stripped from photos and videos before storage, without touching the picture.",
        controlId: "metadata",
        where: "/uploads",
        whereLabel: "Data Vault",
      },
      {
        name: "Safe file storage",
        detail:
          "Uploads are size- and type-limited and kept encrypted in the database, never as files that could run on the server.",
        where: "/uploads",
        whereLabel: "Data Vault",
      },
      {
        name: "Upload-flood alert",
        detail:
          "An account uploading at the edge of the limit raises an alert for staff.",
        controlId: "alerts",
      },
    ],
  },
  {
    id: "hardening",
    title: "Web and API hardening",
    features: [
      {
        name: "CSRF protection",
        detail:
          "Every change carries a token that must match the session's cookie, checked in constant time.",
        controlId: "csrf-cors",
      },
      {
        name: "CORS allowlist",
        detail: "Only the app's own origins may call the API from a browser.",
        controlId: "csrf-cors",
      },
      {
        name: "Security headers",
        detail:
          "A strict Content-Security-Policy, no framing, no type sniffing, a strict referrer policy and HSTS, on the API and the web pages.",
        controlId: "headers",
      },
      {
        name: "Request validation",
        detail:
          "Every request is checked against the API's schema before it runs; bad input gets a clear 400, and NUL characters are refused.",
        controlId: "input-validation",
      },
      {
        name: "SQL injection prevented",
        detail:
          "All database access uses parameterised queries; no query is built from text.",
        controlId: "input-validation",
      },
      {
        name: "Mass assignment blocked",
        detail:
          "A role or flag sent by a client is ignored, and prototype-pollution payloads have no effect.",
        controlId: "input-validation",
      },
      {
        name: "Per-feature rate limits",
        detail:
          "Uploads, payments, AI queries, AI challenges and staff tools each have their own limit.",
        controlId: "throttling",
      },
    ],
  },
  {
    id: "payments",
    title: "Payments",
    features: [
      {
        name: "No card numbers stored",
        detail:
          "Card details are tokenised; the app keeps only the last 4 digits and the brand.",
        where: "/payments",
        whereLabel: "Payments",
      },
      {
        name: "Server-side prices",
        detail:
          "Prices come only from the server's catalogue; a client can't set its own price.",
        where: "/payments",
        whereLabel: "Payments",
      },
      {
        name: "Card form checks",
        detail:
          "The card form runs the Luhn checksum and each network's number-length and security-code rules.",
        where: "/payments",
        whereLabel: "Payments",
      },
      {
        name: "Realistic declines",
        detail:
          "Test cards give real outcomes: insufficient funds, lost or stolen card, expired card, wrong security code.",
        where: "/payments",
        whereLabel: "Payments",
      },
      {
        name: "No double charges",
        detail:
          "Each payment carries an idempotency key, so a retry returns the same payment; another account's key is refused and alerted.",
        where: "/payments",
        whereLabel: "Payments",
      },
      {
        name: "Refund rules",
        detail:
          "Refunds within 14 days of a completed payment, one subscription refund a year, never twice even under load; the plan reverts after a refund.",
        where: "/payments",
        whereLabel: "Payments",
      },
      {
        name: "Signed payment notifications",
        detail:
          "Notifications from the payment provider need an HMAC-SHA256 signature less than 5 minutes old.",
        controlId: "input-validation",
      },
      {
        name: "Chargeback protection",
        detail:
          "During a dispute the plan is paused; after a lost one, new purchases wait for staff review.",
        where: "/users",
        whereLabel: "Users",
      },
    ],
  },
  {
    id: "monitoring",
    title: "Audit and monitoring",
    features: [
      {
        name: "Audit log",
        detail:
          "78 kinds of security event are recorded: sign-ins, role changes, payments, uploads, AI use and privacy actions.",
        controlId: "audit-chain",
        where: "/security-logs",
        whereLabel: "Audit Logs",
      },
      {
        name: "Tamper-evident chain",
        detail:
          "Each entry is chained to the previous one with SHA-256, and a database trigger records any deletion; one click verifies the whole chain.",
        controlId: "audit-chain",
        where: "/security-logs",
        whereLabel: "Audit Logs: Verify chain",
      },
      {
        name: "Retention",
        detail:
          "Logs are kept 12 months, AI challenge records 2 years and payments 7 years; spent links are purged hourly, and removed log entries leave hash stubs.",
        controlId: "retention",
      },
      {
        name: "No personal data in log messages",
        detail: "Log messages name accounts by number, not email address.",
        where: "/security-logs",
        whereLabel: "Audit Logs",
      },
      {
        name: "Automatic alerts",
        detail:
          "Every 2 minutes the server looks for sign-in failure spikes, face-check probing, upload floods, account sharing, scanner outages and overdue AI challenges.",
        controlId: "alerts",
        where: "/dashboard",
        whereLabel: "Dashboard",
      },
      {
        name: "Security Center",
        detail: "This page: every backend control's live state, for staff.",
      },
    ],
  },
  {
    id: "privacy",
    title: "Privacy and compliance",
    features: [
      {
        name: "Separate consents",
        detail:
          "Data, biometric, AI-training and content-profile consents are separate and can be withdrawn at any time; withdrawal is never blocked.",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Training-data source rules",
        detail:
          "Only the sources Team 2's acceptability matrix allows can feed a model, enforced in code.",
        where: "/ai-security",
        whereLabel: "AI Security",
      },
      {
        name: "Download my data",
        detail: "A full copy as JSON, and a readable copy anyone can open.",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Correct my details",
        detail: "People can update their own details.",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Delete my account",
        detail:
          "Deleting an account removes its files, passkeys, phone keys and sessions.",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "Versioned privacy policy",
        detail: "Each person's acknowledgement of each version is recorded.",
        where: "/privacy",
        whereLabel: "Privacy Policy",
      },
      {
        name: "Data breach register",
        detail:
          "Breaches are recorded with assessment deadlines, notices to the people affected and the regulator notification.",
        controlId: "privacy-operations",
        where: "/privacy-compliance",
        whereLabel: "Privacy Compliance",
      },
      {
        name: "Government requests and legal holds",
        detail:
          "Each disclosure to an agency is recorded (APP 6), and legal holds keep copies safe from deletion.",
        controlId: "privacy-operations",
        where: "/privacy-compliance",
        whereLabel: "Privacy Compliance",
      },
      {
        name: "Bystander protection",
        detail:
          "Uploaders say who else a file shows; anyone can report a file showing them; staff pause and review it.",
        controlId: "privacy-operations",
        where: "/report-content",
        whereLabel: "Report Content",
      },
    ],
  },
  {
    id: "ai",
    title: "AI and ML security",
    features: [
      {
        name: "Consent-based training",
        detail:
          "The behaviour model learns only from accounts that opted in, and only from event types, never file content.",
        controlId: "ai-privacy",
        where: "/ai-security",
        whereLabel: "AI Security",
      },
      {
        name: "Anti-poisoning cap",
        detail:
          "One account can contribute at most 50 events and 12 transitions, so it can't steer the model.",
        controlId: "ai-privacy",
      },
      {
        name: "Anti-memorisation",
        detail:
          "A pattern is shown only when 3 or more different accounts share it.",
        controlId: "ai-privacy",
      },
      {
        name: "Differential privacy",
        detail:
          "A Laplace-noise mechanism is built and measured; it is off by default because it is unusable at this size.",
        controlId: "ai-privacy",
      },
      {
        name: "Model-extraction protection",
        detail: "AI queries are rate-limited, and every query is logged.",
        where: "/security-logs?eventType=BEHAVIOR_MODEL_QUERIED",
        whereLabel: "Audit Logs: AI queries",
      },
      {
        name: "Private content profile",
        detail:
          "Built only from your own text uploads, with separate consent, and never shared or stored.",
        where: "/enroll",
        whereLabel: "Security Settings",
      },
      {
        name: "AI register",
        detail:
          "Every AI output is labelled, and a public page lists what each AI decides, its limits and who is accountable.",
        controlId: "ai-systems",
        where: "/ai",
        whereLabel: "How We Use AI",
      },
      {
        name: "Challenge an AI decision",
        detail:
          "Anyone can challenge an AI decision; staff must acknowledge it within 2 business days and resolve it.",
        where: "/ai-oversight",
        whereLabel: "AI Oversight",
      },
      {
        name: "AI off switch",
        detail:
          "Staff can switch off each AI system, within seconds and on the record.",
        controlId: "ai-systems",
        where: "/ai-oversight",
        whereLabel: "AI Oversight",
      },
      {
        name: "Live AI attacks",
        detail:
          "The team's attacks run against the real model: poisoning, coordinated accounts, secret extraction, consent and withdrawal.",
        where: "/ai-security",
        whereLabel: "AI Security",
      },
      {
        name: "AI security proofs of concept",
        detail:
          "Memorisation defence, data-poisoning score, prompt-injection detection, behavioural risk and prediction coverage.",
        where: "/ai-security",
        whereLabel: "AI Security",
      },
      {
        name: "Face-model integrity",
        detail:
          "The face model's files are fingerprinted and CI fails if one is swapped; a passkey is always offered instead of face.",
        controlId: "ci",
      },
    ],
  },
  {
    id: "mobile",
    title: "Phone app",
    features: [
      {
        name: "Certificate pinning",
        detail:
          "The Android and iPhone apps only talk to servers with the expected certificates.",
        whereLabel: PHONE_APP,
      },
      {
        name: "Key switched off on new biometrics",
        detail:
          "Adding a new fingerprint or face to the phone switches the app's sign-in key off.",
        whereLabel: PHONE_APP,
      },
      {
        name: "No phone backups of app data",
        detail:
          "App data, including the session, is excluded from backups and phone-to-phone transfers.",
        whereLabel: PHONE_APP,
      },
      {
        name: "No tokens in app storage",
        detail: "The session lives in the phone's native cookie store.",
        whereLabel: PHONE_APP,
      },
      {
        name: "Locked in-app face check",
        detail:
          "The face check runs in an in-app browser locked to the site's own address.",
        whereLabel: PHONE_APP,
      },
      {
        name: "Encrypted traffic only",
        detail: "Unencrypted connections are allowed only in debug builds.",
        whereLabel: PHONE_APP,
      },
    ],
  },
  {
    id: "pipeline",
    title: "Development pipeline",
    features: [
      {
        name: "Branch protection",
        detail:
          "Every change needs passing checks and the owner's review before it reaches the main code.",
        controlId: "ci",
      },
      {
        name: "Static analysis",
        detail: "Semgrep scans every change with OWASP Top 10 rules.",
        controlId: "ci",
      },
      {
        name: "Dependency rules",
        detail:
          "Dependencies are audited, new package versions must be 7 days old, and GitHub Actions are pinned.",
        controlId: "ci",
      },
      {
        name: "Dynamic scan",
        detail:
          "OWASP ZAP attacks a fresh build, signed in as a user and as an administrator.",
        controlId: "ci",
      },
      {
        name: "Attack probes and load test",
        detail:
          "About 50 scripted attacks and a concurrency test run against a live build.",
        controlId: "ci",
      },
      {
        name: "Verification suites",
        detail:
          "Automatic checks for encryption keys, retention, differential privacy, data sources, alert email, ClamAV and breached passwords.",
        controlId: "ci",
      },
      {
        name: "iPhone build and pinning test",
        detail:
          "The iPhone app is built and its pinning tested on a Mac for every change to it.",
        controlId: "ci",
      },
    ],
  },
];

export const SECURITY_FEATURE_COUNT = SECURITY_FEATURE_AREAS.reduce(
  (sum, area) => sum + area.features.length,
  0,
);
