// Every security feature in SecureAI, for the Security Center's "All features" tab. Where a live check
// on the server reports a feature, controlId names it (GET /security/controls), and the tab shows its
// status. Keep in step with docs/04 when a feature is added or removed. docs/13_Security_Features.md is
// generated from this file (node scripts/generate-security-features-doc.mjs), and CI fails if it is
// out of date.

export interface SecurityFeature {
  name: string;
  detail: string;
  /** The live control in the Security Center that reports this feature, if any. */
  controlId?: string;
  /** A page in the app where it can be seen. */
  where?: string;
  /** Where to look, when there's no page to link (or to describe the link). */
  whereLabel?: string;
  /** How it works and how it is implemented. */
  how: string;
  /** The main files that implement it. */
  code: string[];
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
        how: "At sign-up and on every password change the API hashes the password with bcrypt at cost 12 (a random salt per password, deliberately slow) and stores only the hash; sign-in compares with `bcrypt.compare`. The request log records only the method and path, never the body, and the logger redacts cookies and authorisation headers.",
        code: [
          "artifacts/api-server/src/routes/auth.ts",
          "artifacts/api-server/src/routes/passkeys.ts",
          "artifacts/api-server/src/lib/logger.ts",
        ],
      },
      {
        name: "Breached and common passwords refused",
        detail:
          "At sign-up and reset, passwords from known breaches (Have I Been Pwned; only 5 characters of a hash are sent), the most common passwords and ones built from the email are refused (NIST SP 800-63B).",
        controlId: "password-check",
        whereLabel: 'Sign-up page, signed out: try "Password123!"',
        how: "`checkNewPassword()` runs before a new password is hashed (sign-up, face reset, passkey reset). It refuses the 2,087 entries of 8+ characters from SecLists' 10,000 most common passwords (bundled, matched ignoring case), passwords containing the email's name or \"SecureAI\", and passwords Have I Been Pwned knows: the server sends only the first 5 hex characters of the password's SHA-1 hash (k-anonymity, with padding) and looks for the rest in the answer. If that service is down or slower than 2.5 s, the bundled list alone applies. The answer is 400 `PASSWORD_NOT_ALLOWED`.",
        code: [
          "artifacts/api-server/src/lib/breachedPasswords.ts",
          "artifacts/api-server/src/lib/commonPasswords.json",
          "artifacts/api-server/src/lib/breachedPasswords.verify.ts",
        ],
      },
      {
        name: "Two-step sign-in for every account",
        detail:
          "A password alone never gives access: the server refuses protected pages and APIs until a second factor is set up and used.",
        controlId: "mfa",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "A correct password only creates a pending sign-in (the session holds `pendingUserId`), which no protected route accepts. The full session (`session.userId`) is set only after the second factor, which must come within 2 minutes; the face check allows 3 tries. The `requireMfaEnrolled` middleware sits in front of every protected router and answers 403 until the account has a face, a passkey or a phone key.",
        code: [
          "artifacts/api-server/src/routes/auth.ts",
          "artifacts/api-server/src/middlewares/requireMfaEnrolled.ts",
        ],
      },
      {
        name: "Passkeys",
        detail:
          "WebAuthn/FIDO2 passkeys: the private key never leaves the device, and the server checks a signature over a fresh challenge.",
        controlId: "mfa",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "WebAuthn through `@simplewebauthn/server`. Registration stores only the credential's public key and counter; at sign-in the server issues a random challenge, the browser's authenticator signs it after a fingerprint, face or PIN (user verification required), and the server checks the signature, origin, relying-party ID and counter before creating the session.",
        code: [
          "artifacts/api-server/src/routes/passkeys.ts",
          "artifacts/secureai/src/lib/passkey.ts",
        ],
      },
      {
        name: "Phone key",
        detail:
          "In the phone app, fingerprint or Face ID unlocks a hardware-backed key that signs the server's challenge.",
        controlId: "mfa",
        whereLabel: PHONE_APP,
        how: "The app creates a key pair inside the phone's secure keystore with react-native-biometrics (Android Keystore; the iPhone Keychain), protected by the fingerprint or Face ID. Only the public key is sent to the server. At sign-in the server sends a challenge, the phone signs it once the biometric unlocks the key, and the server verifies the signature with `crypto.verify` against the stored public key.",
        code: [
          "artifacts/api-server/src/routes/biometricKey.ts",
          "artifacts/mobile/src/lib/biometricKey.ts",
        ],
      },
      {
        name: "Face check with liveness",
        detail:
          "Optional face sign-in with a blink check, stored as an encrypted template and only with separate biometric consent.",
        controlId: "mfa",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "`face-api.js` runs in the browser (or the app's in-app browser) and turns the camera image into 128 numbers; the image never leaves the device. A blink check watches the eye aspect ratio dip and recover quickly while the head stays still, so a photo held up fails. The server compares the numbers with the stored template (Euclidean distance under 0.6), allowing 3 attempts per sign-in, and stores templates only with the biometric consent box ticked.",
        code: [
          "artifacts/secureai/src/lib/faceRecognition.ts",
          "artifacts/secureai/src/lib/livenessDetection.ts",
          "artifacts/api-server/src/lib/faceUtils.ts",
          "artifacts/api-server/src/routes/auth.ts",
        ],
      },
      {
        name: "Device linking",
        detail:
          "A new phone is linked with a 10-minute, single-use code that only an already-verified session can create.",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "A fully signed-in session (already past its second factor) can create a link code: 10 random hex characters (about 40 bits), held only in the server's memory, valid for 10 minutes and deleted on first use whatever the outcome. The new phone sends the code with its own new phone key, and redemption is limited to 10 tries per network address per 5 minutes, so the code can't be guessed in time.",
        code: [
          "artifacts/api-server/src/routes/biometricKey.ts",
          "artifacts/secureai/src/lib/deviceLink.ts",
        ],
      },
      {
        name: "Password reset needs the second factor",
        detail:
          "A reset link alone changes nothing: the face or passkey must be verified too. Links are single-use, last 30 minutes and are stored as hashes.",
        whereLabel: `${SIGNED_OUT}: "Forgot?"`,
        how: "Forgot password stores a SHA-256 hash of a random 32-byte token that expires in 30 minutes and allows 5 attempts. Opening the link only reports which factor to use; the new password is set only after the face check (reset-password/face) or a passkey signature (reset-password/passkey-verify) succeeds, and the token is then marked used.",
        code: [
          "artifacts/api-server/src/routes/auth.ts",
          "artifacts/api-server/src/routes/passkeys.ts",
        ],
      },
      {
        name: "Email confirmation",
        detail:
          "New accounts confirm their email from a single-use, 24-hour link before they can upload files or pay.",
        controlId: "email-confirmation",
        whereLabel: "Register a new account to see the banner",
        how: "Sign-up sets `users.email_verified` to false and emails a link to `/verify-email` holding a random token; only its SHA-256 is stored (`email_verification_tokens`, 24 hours, single use). The `requireVerifiedEmail` middleware answers 403 `EMAIL_VERIFICATION_REQUIRED` on new uploads and payments until the link is opened. A new link (3 an hour) retires the earlier ones.",
        code: [
          "artifacts/api-server/src/middlewares/requireVerifiedEmail.ts",
          "artifacts/api-server/src/routes/auth.ts",
          "lib/db/src/schema/emailVerificationTokens.ts",
        ],
      },
      {
        name: "Password-guessing limits",
        detail:
          "Failed sign-ins are capped per account and per network address, as are sign-ups and reset emails; past the limit the server refuses (429).",
        controlId: "throttling",
        where: "/security-logs?eventType=RATE_LIMIT_HIT",
        whereLabel: "Audit Logs: requests refused",
        how: "`checkAndRecordRequest()` reserves an attempt atomically before any password is checked, keyed by the email and by the network address, so parallel requests can't slip past a check-then-record race. Sign-in: 5 per account and 20 per address per 15 minutes; sign-up: 10 per address per hour; reset emails: 5 per account and 20 per address per hour. Over the limit: 429 with Retry-After, and a `RATE_LIMIT_HIT` audit event.",
        code: [
          "artifacts/api-server/src/lib/rateLimit.ts",
          "artifacts/api-server/src/lib/authLimits.ts",
          "artifacts/api-server/src/routes/auth.ts",
        ],
      },
      {
        name: "Forge-proof network address",
        detail:
          "Only CloudFront and the server itself may report a visitor's address, so the limits can't be dodged with a fake header.",
        controlId: "throttling",
        how: "Express's `trust proxy` is set to loopback and AWS's published CloudFront address ranges only, so X-Forwarded-For is believed only from CloudFront; every limit and audit entry uses `req.ip`. The ranges are refreshed by a script from AWS's `ip-ranges.json`.",
        code: [
          "artifacts/api-server/src/app.ts",
          "artifacts/api-server/src/lib/cloudfrontRanges.ts",
          "artifacts/api-server/src/lib/clientIp.ts",
          "scripts/ops/refresh-cloudfront-ranges.mjs",
        ],
      },
      {
        name: "No account guessing",
        detail:
          "A wrong email and a wrong password get the same answer in the same time, and reset requests answer the same whether or not the account exists.",
        whereLabel: SIGNED_OUT,
        how: 'Sign-in answers "Invalid email or password" in both cases, and for an unknown email still runs a bcrypt comparison against a dummy hash so the response takes the same time. Forgot password gives the same answer whether or not the account exists, and its limit is keyed on the email typed, before any lookup.',
        code: ["artifacts/api-server/src/routes/auth.ts"],
      },
      {
        name: "Unusual sign-in detection",
        detail:
          "A correct password from a new network, a new device, a quick network switch or an unusual time is flagged, and the person is warned.",
        controlId: "login-risk",
        where: "/security-logs?eventType=LOGIN_RISK_FLAGGED",
        whereLabel: "Audit Logs: flagged sign-ins",
        how: "After a correct password, `assessLoginRisk()` compares the request with that account's own `LOGIN_SUCCESS` history: a network address or browser it hasn't used, a different network within minutes of another sign-in, and (after 8 sign-ins) a time of day far from its usual pattern, using circular statistics so 11 pm and 1 am count as close. Medium or high risk writes `LOGIN_RISK_FLAGGED`; high risk returns a plain warning to show the person.",
        code: [
          "artifacts/api-server/src/lib/loginRiskModel.ts",
          "artifacts/api-server/src/routes/auth.ts",
        ],
      },
      {
        name: "Secure sessions",
        detail:
          "Sessions live on the server, in HttpOnly, Secure, SameSite cookies; they end after 30 idle minutes or 12 hours, with a new session ID at every sign-in.",
        controlId: "sessions",
        how: "express-session with sessions stored in PostgreSQL (connect-pg-simple). The cookie is HttpOnly, Secure in production and SameSite=Lax; it rolls on a 30-minute idle timeout, and every request also checks an absolute 12-hour limit. The session ID is regenerated at sign-in and when the second factor completes, which defeats session fixation.",
        code: [
          "artifacts/api-server/src/app.ts",
          "artifacts/api-server/src/lib/sessionPolicy.ts",
          "artifacts/api-server/src/routes/auth.ts",
        ],
      },
      {
        name: "Sign out of all devices",
        detail: "One button ends every session on every device.",
        controlId: "sessions",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "POST `/auth/logout-all` deletes every row in the session table whose stored `userId` is this account's, so every device is signed out at once, and logs `LOGOUT_ALL` with the count.",
        code: [
          "artifacts/api-server/src/routes/auth.ts",
          "artifacts/secureai/src/pages/Enroll.tsx",
        ],
      },
      {
        name: "Device limit per plan",
        detail:
          "Each plan allows a set number of devices at once; the oldest is signed out, and repeated hits raise an account-sharing alert.",
        controlId: "sessions",
        how: "`enforceSessionLimit()` runs on every sign-in path: it counts the account's live sessions and deletes the oldest beyond the plan's limit (3, or 10 on Team), logging `SESSION_LIMIT_ENFORCED`. An account that keeps hitting the limit raises a possible-account-sharing alert.",
        code: ["artifacts/api-server/src/lib/sessionLimit.ts"],
      },
      {
        name: "Password check before deleting an account",
        detail: "Deleting your own account asks for your password again.",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "DELETE `/users/:id` for your own account requires the current password in the request, verified with bcrypt immediately before the delete; a staff deletion of another account needs the admin role instead.",
        code: ["artifacts/api-server/src/routes/users.ts"],
      },
      {
        name: "Parental consent for under-18s",
        detail:
          "Accounts of people under 18 are paused until a parent or guardian confirms by email.",
        whereLabel: "Sign-up page, signed out",
        how: 'The server computes age from the date of birth (never trusting a client\'s "adult" flag). Under 18 needs a parent or guardian email; the account gets a 7-day consent link emailed to that address, and the `requireParentConsent` middleware blocks protected routes until it is confirmed.',
        code: [
          "artifacts/api-server/src/routes/auth.ts",
          "artifacts/api-server/src/middlewares/requireParentConsent.ts",
        ],
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
        how: "`users.role` is one of `user`, `admin`, `security_analyst` or `it_support`. Every staff route reads the role from the database on each request (never from the browser) and refuses others: for example, only analysts and admins read the audit log, only admins change roles, and IT support can help recover accounts but not change roles.",
        code: [
          "lib/db/src/schema/users.ts",
          "artifacts/api-server/src/routes/users.ts",
          "artifacts/api-server/src/routes/security.ts",
        ],
      },
      {
        name: "Owner-only records",
        detail:
          "Another account's files, payments or profile are refused even with a guessed ID (IDOR protection).",
        controlId: "access-control",
        how: "Every route that takes a record ID checks that the signed-in account owns it (or, where the route allows it, has a staff role) before reading or changing it. Anyone else gets 403, and the attempt is written to the audit log as `UNAUTHORIZED_ACCESS`. The attack probes test this with two accounts.",
        code: [
          "artifacts/api-server/src/routes/uploads.ts",
          "artifacts/api-server/src/routes/payments.ts",
          "artifacts/api-server/src/routes/users.ts",
        ],
      },
      {
        name: "Least-privilege database login",
        detail:
          "The app's database login can read and write its own tables but can't create, drop or alter them.",
        how: "The API connects as `secureai_app`, which has SELECT, INSERT, UPDATE and DELETE on the app's tables and nothing else: no CREATE, no table ownership. A provisioning script sets it up and proves CREATE TABLE and DROP TABLE are refused; a read-only check confirms it in production.",
        code: [
          "scripts/ops/provision-app-db-role.mjs",
          "scripts/ops/check-production-db.mjs",
        ],
      },
      {
        name: "Network lockdown",
        detail:
          "On the live site the database accepts only the API server, and the API server accepts only CloudFront.",
        how: "In AWS, the database's security group admits only the API server's security group, and the API server's group admits port 80 only from CloudFront's managed origin-facing prefix list, so neither can be reached directly from the internet. The database is still flagged publicly accessible in AWS, so one wrong rule would expose it again; that is recorded as an open risk (R-AC-6).",
        code: [
          "docs/04_Threat_Model_Risk_Assessment.md (R-AC-5, R-AC-6, R-SC-6)",
        ],
      },
      {
        name: "Staff actions logged",
        detail:
          "Role changes, sign-in resets and payment holds are staff-only and logged with the old value, the new value and who acted.",
        where: "/security-logs?eventType=ROLE_CHANGED",
        whereLabel: "Audit Logs: role changes",
        how: "Role changes write `ROLE_CHANGED` with the old role, the new role and the administrator; staff MFA resets write `MFA_RESET_BY_STAFF` and payment-hold releases write their own events, all into the hash-chained audit log.",
        code: [
          "artifacts/api-server/src/routes/users.ts",
          "artifacts/api-server/src/lib/auditLog.ts",
        ],
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
        how: "`encryptFile()` and `encryptJson()` use AES-256-GCM with a random 12-byte IV per value and store the ciphertext, IV and authentication tag; decryption fails if anything was altered. Used for face templates, upload contents and payment tokens.",
        code: ["artifacts/api-server/src/lib/fileEncryption.ts"],
      },
      {
        name: "Key rotation",
        detail:
          "Encryption has its own key, which can be replaced while the site runs; older records are re-encrypted in the background.",
        controlId: "encryption",
        how: "The key comes from `FILE_ENCRYPTION_KEY`, separate from every other secret, and each stored value records which key ID encrypted it. To rotate, a new key ID becomes current and the old key moves to `FILE_ENCRYPTION_PREVIOUS_KEYS`; a background job re-encrypts every older value and logs `ENCRYPTION_KEY_ROTATED`.",
        code: [
          "artifacts/api-server/src/lib/fileEncryption.ts",
          "artifacts/api-server/src/lib/keyRotation.ts",
          "artifacts/api-server/src/lib/fileEncryption.verify.ts",
        ],
      },
      {
        name: "Encryption in transit",
        detail:
          "HTTPS with HSTS for every visit, and a certificate-checked TLS connection from the API to its database.",
        controlId: "headers",
        how: "CloudFront serves the site over HTTPS, the API adds HSTS in production, and plain-HTTP requests that didn't come through CloudFront are redirected. The API connects to its database with `sslmode=verify-full` against AWS's RDS certificate bundle, so it would refuse an impostor.",
        code: [
          "artifacts/api-server/src/app.ts",
          "scripts/ops/provision-app-db-role.mjs",
        ],
      },
      {
        name: "Malware scanning",
        detail:
          "Every upload is scanned (ClamAV and built-in signatures) before it is stored; if the scanner is down, uploads are refused, not stored unchecked.",
        controlId: "malware-scan",
        where: "/uploads",
        whereLabel: "Data Vault",
        how: "Each upload is streamed to ClamAV (clamd on `127.0.0.1:3310`, installed on the server by a deploy hook, with freshclam keeping signatures current), then to built-in checks for the EICAR test file, executable headers, script shebangs and scripts inside SVG. A configured scanner that doesn't answer makes the upload fail with 503 and an alert, instead of storing it unchecked.",
        code: [
          "artifacts/api-server/src/lib/clamdClient.ts",
          "artifacts/api-server/src/lib/malwareScan.ts",
          "artifacts/api-server/.platform/hooks/prebuild/10_clamav.sh",
        ],
      },
      {
        name: "Real file type",
        detail:
          "A file's type is read from its bytes, not its name, so a disguised file can't slip through.",
        controlId: "malware-scan",
        how: "`detectImageFormat()` and `detectVideoFormat()` read the first bytes of the file (the format's magic number) and the upload is handled by what the bytes say, not by the name or the type the browser declared.",
        code: [
          "artifacts/api-server/src/lib/imageSafety.ts",
          "artifacts/api-server/src/lib/videoSafety.ts",
        ],
      },
      {
        name: "Location data removed",
        detail:
          "GPS and other metadata are stripped from photos and videos before storage, without touching the picture.",
        controlId: "metadata",
        where: "/uploads",
        whereLabel: "Data Vault",
        how: "Before encryption, the image parser removes metadata segments (JPEG EXIF/APP1 and APP13, PNG text chunks, GIF comments, WebP EXIF/XMP) and the video parser removes the GPS atom from MP4/MOV when it can do so safely. Pixels and video samples are never changed, and a file that doesn't parse cleanly is left as it is rather than risk damage.",
        code: [
          "artifacts/api-server/src/lib/imageSafety.ts",
          "artifacts/api-server/src/lib/videoSafety.ts",
        ],
      },
      {
        name: "Safe file storage",
        detail:
          "Uploads are size- and type-limited and kept encrypted in the database, never as files that could run on the server.",
        where: "/uploads",
        whereLabel: "Data Vault",
        how: "Each upload is checked on arrival (1 byte to 15 MB; text, image, video or audio only) and rate-limited, and the encrypted bytes are stored in the database's uploads table, never written to a folder the server could run them from.",
        code: ["artifacts/api-server/src/routes/uploads.ts"],
      },
      {
        name: "Upload-flood alert",
        detail:
          "An account uploading at the edge of the limit raises an alert for staff.",
        controlId: "alerts",
        how: "The anomaly detector counts each account's uploads; 10 or more within 15 minutes raises an alert on the dashboard (and by email or webhook when configured), even though each upload was within the per-request limit.",
        code: [
          "artifacts/api-server/src/lib/uploadAnomalyDetector.ts",
          "artifacts/api-server/src/lib/securityAlerting.ts",
        ],
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
        how: "Double-submit cookie: the server sets a random `csrf_token` cookie, and every request that changes something must repeat it in the X-CSRF-Token header; the two are compared with `crypto.timingSafeEqual`. A page on another site can't read the cookie, so it can't send the header.",
        code: ["artifacts/api-server/src/middlewares/csrf.ts"],
      },
      {
        name: "CORS allowlist",
        detail: "Only the app's own origins may call the API from a browser.",
        controlId: "csrf-cors",
        how: "The cors middleware allows only the origins in `ALLOWED_ORIGINS` (the site's own addresses and the phone app's origin from `FRONTEND_ORIGINS`, plus localhost in development); any other origin gets 403.",
        code: [
          "artifacts/api-server/src/lib/allowedOrigins.ts",
          "artifacts/api-server/src/app.ts",
        ],
      },
      {
        name: "Security headers",
        detail:
          "A strict Content-Security-Policy, no framing, no type sniffing, a strict referrer policy and HSTS, on the API and the web pages.",
        controlId: "headers",
        how: "The API sets Content-Security-Policy (default-src 'none'; frame-ancestors, form-action and base-uri 'none'), X-Frame-Options DENY, X-Content-Type-Options nosniff and Referrer-Policy no-referrer on every response, and HSTS in production. The web pages get their own strict CSP and the same headers from CloudFront, applied and then checked by the deploy script.",
        code: [
          "artifacts/api-server/src/app.ts",
          "scripts/ops/web-security-headers.mjs",
          "scripts/ops/deploy-web.mjs",
        ],
      },
      {
        name: "Request validation",
        detail:
          "Every request is checked against the API's schema before it runs; bad input gets a clear 400, and NUL characters are refused.",
        controlId: "input-validation",
        how: "Request schemas are written once in the OpenAPI spec and generated into Zod; every route parses its body and parameters before doing anything (unknown fields are dropped), a middleware refuses NUL characters anywhere in the input, and the error handler answers client errors with 4xx instead of 500.",
        code: [
          "lib/api-spec/openapi.yaml",
          "lib/api-zod",
          "artifacts/api-server/src/middlewares/rejectNulCharacters.ts",
        ],
      },
      {
        name: "SQL injection prevented",
        detail:
          "All database access uses parameterised queries; no query is built from text.",
        controlId: "input-validation",
        how: "All database access goes through Drizzle ORM's query builder or its sql template, which sends values as parameters; no query is assembled from strings. The attack probes send injection payloads to sign-in and check nothing gets through.",
        code: [
          "lib/db/src/schema",
          "scripts/src/security/adversarial-probes.ts",
        ],
      },
      {
        name: "Mass assignment blocked",
        detail:
          "A role or flag sent by a client is ignored, and prototype-pollution payloads have no effect.",
        controlId: "input-validation",
        how: 'Zod strips fields the schema doesn\'t define, and handlers copy only the fields they mean to (registration always creates role "user"). The probes send role, MFA and consent flags, and `__proto__` payloads, and check none of them take effect.',
        code: [
          "artifacts/api-server/src/routes/auth.ts",
          "scripts/src/security/adversarial-probes.ts",
        ],
      },
      {
        name: "Per-feature rate limits",
        detail:
          "Uploads, payments, AI queries, AI challenges and staff tools each have their own limit.",
        controlId: "throttling",
        how: "`requestRateLimit()` gives each feature its own budget, 14 in all (per account, or per address where there is no account): uploads, payments, data exports, content reports, passkey and phone-key registration, device-link codes, AI suggestions (30 per 5 minutes), AI challenges, the content profile, the AI security report, the Security Center and other staff tools. Past the budget the answer is 429 with Retry-After.",
        code: ["artifacts/api-server/src/middlewares/requestRateLimit.ts"],
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
        how: "The card form only ever sends the last 4 digits and the brand; the server generates a provider reference token, encrypts it with AES-256-GCM, and the payments table has no column that could hold a card number.",
        code: [
          "artifacts/api-server/src/routes/payments.ts",
          "lib/db/src/schema/payments.ts",
        ],
      },
      {
        name: "Server-side prices",
        detail:
          "Prices come only from the server's catalogue; a client can't set its own price.",
        where: "/payments",
        whereLabel: "Payments",
        how: "The browser sends only a plan ID; the amount, currency and description come from the PLANS catalogue on the server, so a tampered request can't change the price.",
        code: [
          "artifacts/api-server/src/lib/plans.ts",
          "artifacts/api-server/src/routes/payments.ts",
        ],
      },
      {
        name: "Card form checks",
        detail:
          "The card form runs the Luhn checksum and each network's number-length and security-code rules.",
        where: "/payments",
        whereLabel: "Payments",
        how: "Before anything is sent, the web and phone forms run the Luhn checksum and check the length and security-code format for the network the card number belongs to (Visa, Mastercard, Amex and others).",
        code: [
          "artifacts/secureai/src/lib/cardValidation.ts",
          "artifacts/mobile/src/lib/cardValidation.ts",
        ],
      },
      {
        name: "Realistic declines",
        detail:
          "Test cards give real outcomes: insufficient funds, lost or stolen card, expired card, wrong security code.",
        where: "/payments",
        whereLabel: "Payments",
        how: "`simulateProcessorDecision()` maps documented test-card endings to real decline codes (insufficient funds, lost, stolen, expired, wrong security code, processing error). A declined attempt is stored as a failed payment, answered 402, and logged `PAYMENT_FAILED`.",
        code: ["artifacts/api-server/src/lib/paymentSimulation.ts"],
      },
      {
        name: "No double charges",
        detail:
          "Each payment carries an idempotency key, so a retry returns the same payment; another account's key is refused and alerted.",
        where: "/payments",
        whereLabel: "Payments",
        how: "A payment request carries an Idempotency-Key. If the same account sends the same key again, the original payment is returned instead of a new charge, even when the retries arrive at the same moment (a unique constraint in the database settles the race). A key that belongs to another account is refused and logged.",
        code: ["artifacts/api-server/src/routes/payments.ts"],
      },
      {
        name: "Refund rules",
        detail:
          "Refunds within 14 days of a completed payment, one subscription refund a year, never twice even under load; the plan reverts after a refund.",
        where: "/payments",
        whereLabel: "Payments",
        how: "POST `/payments/:id/refund` accepts only the owner's completed payment within 14 days, and one self-service subscription refund per account per year. The check and the refund run as one conditional update inside a transaction, so five parallel refunds give exactly one; afterwards the account's plan is recomputed from what it is still paying for.",
        code: [
          "artifacts/api-server/src/routes/payments.ts",
          "artifacts/api-server/src/lib/paymentLifecycle.ts",
        ],
      },
      {
        name: "Signed payment notifications",
        detail:
          "Notifications from the payment provider need an HMAC-SHA256 signature less than 5 minutes old.",
        controlId: "input-validation",
        how: "Each notification must carry an HMAC-SHA256 signature over its timestamp and body, made with `WEBHOOK_SECRET`; the server recomputes it, compares in constant time, and refuses notifications older than 5 minutes, so a forged or replayed one is rejected and logged.",
        code: [
          "artifacts/api-server/src/lib/webhookSignature.ts",
          "artifacts/api-server/src/routes/webhooks.ts",
        ],
      },
      {
        name: "Chargeback protection",
        detail:
          "During a dispute the plan is paused; after a lost one, new purchases wait for staff review.",
        where: "/users",
        whereLabel: "Users",
        how: "Dispute notifications (opened, won, lost) are signature-checked like every other: an open dispute pauses the plan it paid for and blocks a refund of the same payment; a lost one sets `payment_hold`, which blocks new purchases until an admin clears it. Events are accepted only in a valid order, so a replayed message can't undo a refund.",
        code: [
          "artifacts/api-server/src/routes/webhooks.ts",
          "artifacts/api-server/src/lib/paymentLifecycle.ts",
        ],
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
        how: "`logEvent()` is called from every security-relevant route with one of 78 event types, the account, network address, browser and a timestamp set by the app. Writes go through a queue so concurrent events can't fork the chain.",
        code: [
          "artifacts/api-server/src/lib/auditLog.ts",
          "artifacts/api-server/src/lib/eventDescriptions.ts",
        ],
      },
      {
        name: "Tamper-evident chain",
        detail:
          "Each entry is chained to the previous one with SHA-256, and a database trigger records any deletion; one click verifies the whole chain.",
        controlId: "audit-chain",
        where: "/security-logs",
        whereLabel: "Audit Logs: Verify chain",
        how: "Each entry stores a SHA-256 hash of the previous entry's hash plus its own content, so changing, removing or reordering any entry breaks every hash after it. `verifyLogChain()` recomputes the whole chain on demand, and a database trigger copies any deleted row into `security_log_deletions`, with tools for staff to restore it.",
        code: [
          "artifacts/api-server/src/lib/auditLog.ts",
          "artifacts/api-server/src/lib/dbBootstrap.ts",
        ],
      },
      {
        name: "Retention",
        detail:
          "Logs are kept 12 months, AI challenge records 2 years and payments 7 years; spent links are purged hourly, and removed log entries leave hash stubs.",
        controlId: "retention",
        how: "An hourly job deletes used or expired reset, consent and confirmation links, and calls `purge_aged_security_logs()`, a `SECURITY DEFINER` database function: it removes log entries older than 12 months (AI challenge records after 2 years) and keeps a hash-only stub of each so the chain can still be verified. Payment records are removed after 7 years. Records under a legal hold are copied first.",
        code: [
          "artifacts/api-server/src/lib/retention.ts",
          "artifacts/api-server/src/lib/retentionSql.mjs",
        ],
      },
      {
        name: "No personal data in log messages",
        detail: "Log messages name accounts by number, not email address.",
        where: "/security-logs",
        whereLabel: "Audit Logs",
        how: 'Log messages name accounts by ID ("user 42"); messages about an address with no account leave it out. The account\'s email is kept once, in a separate column, so staff can still filter by it, and it goes with the entry after 12 months.',
        code: [
          "artifacts/api-server/src/routes/auth.ts",
          "artifacts/api-server/src/lib/auditLog.ts",
        ],
      },
      {
        name: "Automatic alerts",
        detail:
          "Every 2 minutes the server looks for sign-in failure spikes, face-check probing, upload floods, account sharing, scanner outages and overdue AI challenges.",
        controlId: "alerts",
        where: "/dashboard",
        whereLabel: "Dashboard",
        how: "A job runs every 2 minutes and checks recent activity: failed sign-ins and rate-limit hits piling up from one address (last 15 minutes), face checks failing repeatedly or clustering just above the match threshold (probing), upload floods, account sharing, a virus scanner that stopped answering, chargebacks and payment holds (last 24 hours), AI challenges past their deadline, and data breaches near or past their 30-day assessment deadline. Alerts show on the dashboard; high ones are also emailed and sent to a webhook, at most once every 30 minutes each.",
        code: [
          "artifacts/api-server/src/lib/securityAlerting.ts",
          "artifacts/api-server/src/lib/faceVerificationAnomaly.ts",
          "artifacts/api-server/src/lib/sessionLimit.ts",
          "artifacts/api-server/src/lib/alertEmail.ts",
        ],
      },
      {
        name: "Security Center",
        detail: "This page: every backend control's live state, for staff.",
        how: "GET `/security/controls` builds a report from the live server: settings, database counts, a fresh chain verification and the headers on its own response, with no secrets. It is behind the second-factor gate and the analyst and admin roles, and rate-limited. This list of features is part of the same page.",
        code: [
          "artifacts/api-server/src/lib/securityControls.ts",
          "artifacts/secureai/src/pages/SecurityCenter.tsx",
          "artifacts/secureai/src/lib/securityFeatures.ts",
        ],
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
        how: "Four separate flags with timestamps on the account: data (required to sign up), biometric (ticked when a face is enrolled, cleared and the template deleted when withdrawn), AI training (opt-in) and content profile (opt-in). The withdrawal endpoints sit outside the MFA and parental-consent gates, so withdrawing is never blocked, and each change is logged.",
        code: [
          "lib/db/src/schema/users.ts",
          "artifacts/api-server/src/routes/behavior.ts",
          "artifacts/api-server/src/routes/contentProfile.ts",
          "artifacts/api-server/src/routes/users.ts",
        ],
      },
      {
        name: "Training-data source rules",
        detail:
          "Only the sources Team 2's acceptability matrix allows can feed a model, enforced in code.",
        where: "/ai-security",
        whereLabel: "AI Security",
        how: "Each upload records where its content came from (`uploads.content_source`, \"unspecified\" by default). `assessTrainingEligibility`(source, file type) applies Team 2's acceptability matrix, so only the uploader's own text can feed a model; refusals are logged `TRAINING_SOURCE_REJECTED` with the reason.",
        code: [
          "artifacts/api-server/src/lib/dataProvenance.ts",
          "artifacts/api-server/src/lib/dataProvenance.verify.ts",
        ],
      },
      {
        name: "Download my data",
        detail: "A full copy as JSON, and a readable copy anyone can open.",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "GET `/users/me/export` returns everything held about the account as JSON; `/users/me/export/readable` returns an HTML page with every value escaped and no scripts, downloaded as a file. Each download is logged `DATA_EXPORTED`.",
        code: [
          "artifacts/api-server/src/routes/privacy.ts",
          "artifacts/api-server/src/lib/readableExport.ts",
        ],
      },
      {
        name: "Correct my details",
        detail: "People can update their own details.",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "The Your details form sends the change to the users API. An account can change only its own name; only an administrator can change a role or another account. Each change is logged as `USER_UPDATED`.",
        code: [
          "artifacts/secureai/src/components/YourDetails.tsx",
          "artifacts/api-server/src/routes/users.ts",
        ],
      },
      {
        name: "Delete my account",
        detail:
          "Deleting an account removes its files, passkeys, phone keys and sessions.",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "One database transaction: anything under a legal hold is copied first, then the account's passkeys, phone keys and sessions are deleted, then the account itself, taking its uploads and pending links with it (`ON DELETE CASCADE`). Payment records stay, with the link to the account cleared, until their 7-year retention ends. `USER_DELETED` is logged, and audit entries stay until their own retention period ends.",
        code: [
          "artifacts/api-server/src/routes/users.ts",
          "artifacts/api-server/src/lib/legalHolds.ts",
          "lib/db/src/schema",
        ],
      },
      {
        name: "Versioned privacy policy",
        detail: "Each person's acknowledgement of each version is recorded.",
        where: "/privacy",
        whereLabel: "Privacy Policy",
        how: 'The policy text carries a version; signing up or pressing "I\'ve read it" logs `PRIVACY_POLICY_ACKNOWLEDGED` with that version, and a banner asks anyone whose last acknowledgement is older. A CI check fails if the version differs between the web text, the phone app and the API.',
        code: [
          "artifacts/api-server/src/lib/privacyPolicy.ts",
          "artifacts/secureai/src/components/PrivacyPolicyNotice.tsx",
          "scripts/check-privacy-policy-version.mjs",
        ],
      },
      {
        name: "Data breach register",
        detail:
          "Breaches are recorded with assessment deadlines, notices to the people affected and the regulator notification.",
        controlId: "privacy-operations",
        where: "/privacy-compliance",
        whereLabel: "Privacy Compliance",
        how: "Staff record a breach (what, when found, data involved); the register tracks the 30-day assessment deadline, sends notices to the affected people in the app and by email, and records when the regulator was told, each step logged.",
        code: [
          "artifacts/api-server/src/lib/dataBreaches.ts",
          "artifacts/secureai/src/components/BreachNotices.tsx",
        ],
      },
      {
        name: "Government requests and legal holds",
        detail:
          "Each disclosure to an agency is recorded (APP 6), and legal holds keep copies safe from deletion.",
        controlId: "privacy-operations",
        where: "/privacy-compliance",
        whereLabel: "Privacy Compliance",
        how: "Each disclosure to an agency is recorded with the legal basis, the request type, the categories given and whether the person was told (APP 6). A legal hold copies the person's records, with a SHA-256 of each copy, into `legal_hold_items` before retention or deletion could remove them; releasing a hold is logged.",
        code: [
          "artifacts/api-server/src/lib/legalHolds.ts",
          "artifacts/api-server/src/lib/dataBreaches.ts",
        ],
      },
      {
        name: "Bystander protection",
        detail:
          "Uploaders say who else a file shows; anyone can report a file showing them; staff pause and review it.",
        controlId: "privacy-operations",
        where: "/report-content",
        whereLabel: "Report Content",
        how: "Uploaders declare who else a file shows (`uploads.bystanders`). Anyone, without an account, can report a file through a rate-limited form; staff match the report to an upload, pause it (`paused_for_review_at`, after which nothing uses it), tell the uploader and record the outcome.",
        code: [
          "artifacts/api-server/src/lib/bystanderReports.ts",
          "artifacts/api-server/src/routes/bystanderReports.ts",
          "artifacts/secureai/src/pages/ReportContent.tsx",
        ],
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
        how: "`buildTrainingCorpus()` reads audit-event types (never upload content) only for accounts whose training consent is on, checked fresh on every build, and leaves out the model's own query events. Nothing is stored between requests, so withdrawing consent takes effect on the next suggestion.",
        code: ["artifacts/api-server/src/lib/behaviorModel.ts"],
      },
      {
        name: "Anti-poisoning cap",
        detail:
          "One account can contribute at most 50 events and 12 transitions, so it can't steer the model.",
        controlId: "ai-privacy",
        how: "When the training set is built, each account contributes at most 50 of its events and at most 12 distinct transitions, so one account, however active, has a bounded effect on the counts. The 12-transition cap is also the bound the differential-privacy calculation relies on.",
        code: [
          "artifacts/api-server/src/lib/behaviorModel.ts",
          "artifacts/api-server/src/lib/behaviorModelPrivacy.ts",
        ],
      },
      {
        name: "Anti-memorisation",
        detail:
          "A pattern is shown only when 3 or more different accounts share it.",
        controlId: "ai-privacy",
        how: "`predictNext()` only answers with a transition that at least 3 different accounts made (`MIN_DISTINCT_USERS`), so a suggestion can never reveal one person's own activity.",
        code: ["artifacts/api-server/src/lib/behaviorModel.ts"],
      },
      {
        name: "Differential privacy",
        detail:
          "A Laplace-noise mechanism is built and measured; it is off by default because it is unusable at this size.",
        controlId: "ai-privacy",
        how: "`releasableModel()` can add Laplace noise (from a cryptographic random source) to the transition counts with a stability-based release rule, controlled by `BEHAVIOR_MODEL_DP_EPSILON`. Measured by `verify:dp`; off by default because at this corpus size it would hide every suggestion.",
        code: [
          "artifacts/api-server/src/lib/behaviorModelPrivacy.ts",
          "artifacts/api-server/src/lib/behaviorModelPrivacy.verify.ts",
        ],
      },
      {
        name: "Model-extraction protection",
        detail: "AI queries are rate-limited, and every query is logged.",
        where: "/security-logs?eventType=BEHAVIOR_MODEL_QUERIED",
        whereLabel: "Audit Logs: AI queries",
        how: "The suggestion endpoint is limited to 30 requests per 5 minutes per account, and every successful query writes `BEHAVIOR_MODEL_QUERIED`, so bulk querying is both slowed and visible.",
        code: [
          "artifacts/api-server/src/routes/behavior.ts",
          "artifacts/api-server/src/middlewares/requestRateLimit.ts",
        ],
      },
      {
        name: "Private content profile",
        detail:
          "Built only from your own text uploads, with separate consent, and never shared or stored.",
        where: "/enroll",
        whereLabel: "Security Settings",
        how: "With its own consent, the account's own text uploads are decrypted in memory, scored with TF-IDF (single words and two-word phrases), and only the top keywords are returned; nothing is saved, and no other account's data is involved.",
        code: [
          "artifacts/api-server/src/lib/contentPersonalizationModel.ts",
          "artifacts/api-server/src/routes/contentProfile.ts",
        ],
      },
      {
        name: "AI register",
        detail:
          "Every AI output is labelled, and a public page lists what each AI decides, its limits and who is accountable.",
        controlId: "ai-systems",
        where: "/ai",
        whereLabel: "How We Use AI",
        how: "`AI_SYSTEMS` lists the six AI systems with their purpose, decisions, data, oversight, known limits and accountable owner; the public `/ai` page shows it, and every AI output in the app carries a label linking there.",
        code: [
          "artifacts/api-server/src/lib/aiSystems.ts",
          "artifacts/secureai/src/components/AiLabel.tsx",
          "artifacts/secureai/src/pages/ResponsibleAi.tsx",
        ],
      },
      {
        name: "Challenge an AI decision",
        detail:
          "Anyone can challenge an AI decision; staff must acknowledge it within 2 business days and resolve it.",
        where: "/ai-oversight",
        whereLabel: "AI Oversight",
        how: "`submitChallenge()` records the challenge (`AI_DECISION_CHALLENGED`); staff must acknowledge it within 2 business days (overdue ones raise an alert) and resolve it as upheld or not, and the person sees the outcome.",
        code: [
          "artifacts/api-server/src/lib/aiGovernance.ts",
          "artifacts/secureai/src/pages/AiOversight.tsx",
        ],
      },
      {
        name: "AI off switch",
        detail:
          "Staff can switch off the AI systems that can safely stop, within seconds and on the record.",
        controlId: "ai-systems",
        where: "/ai-oversight",
        whereLabel: "AI Oversight",
        how: "Three of the six AI systems can be switched off: sign-in risk scoring, suggestions and the content profile. `setAiSystemEnabled()` records `AI_SYSTEM_TOGGLED` with the reason, and those features check `isAiSystemEnabled()` (cached for 5 seconds) before running. The API refuses to switch off the other three: turning off face matching or liveness would stop every face-only sign-in (a staff MFA reset or a passkey helps one person instead), and the anomaly alerts are themselves an oversight channel.",
        code: [
          "artifacts/api-server/src/lib/aiGovernance.ts",
          "artifacts/api-server/src/lib/aiSystems.ts",
          "artifacts/api-server/src/routes/aiGovernance.ts",
        ],
      },
      {
        name: "Live AI attacks",
        detail:
          "The team's attacks run against the real model: poisoning, coordinated accounts, secret extraction, consent and withdrawal.",
        where: "/ai-security",
        whereLabel: "AI Security",
        how: "GET `/ai-security/report` (MFA-gated, rate-limited) runs six attacks against the live behaviour model's own corpus, training and prediction code with synthetic data: consent gate, secret extraction with three prompts, a one-account poisoning flood, coordinated accounts, preserving genuine patterns and consent withdrawal.",
        code: [
          "artifacts/api-server/src/lib/aiSecurityValidation.ts",
          "artifacts/api-server/src/routes/aiSecurity.ts",
        ],
      },
      {
        name: "AI security proofs of concept",
        detail:
          "Memorisation defence, data-poisoning score, prompt-injection detection, behavioural risk and prediction coverage.",
        where: "/ai-security",
        whereLabel: "AI Security",
        how: "The team's Python models (memorisation defence, data-poisoning score, prompt-injection detection, behavioural risk, prediction coverage) run unmodified through `ai_security_report.py`, which records their results and each script's SHA-256 for the AI Security page; CI fails if a script changes without the results being regenerated.",
        code: [
          "artifacts/ai-model/ai_security_report.py",
          "artifacts/ai-model",
        ],
      },
      {
        name: "Face-model integrity",
        detail:
          "The face model's files are fingerprinted and CI fails if one is swapped; a passkey is always offered instead of face.",
        controlId: "ci",
        how: "`face-model-weights.sha256` lists the hash of every `face-api.js` model file; CI runs `sha256sum -c`, so a swapped file fails the build. Face sign-in is optional, and a passkey is always offered, because face matching can work less well for some people.",
        code: [
          "artifacts/secureai/face-model-weights.sha256",
          ".github/workflows/ci.yml",
        ],
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
        how: "The Android app pins three SHA-256 public-key hashes for the live API's domain in `network_security_config.xml`: the site's certificate, its issuing CA and Amazon's root, with an expiry date (2027-03-01) after which an out-of-date app falls back to normal certificate checks instead of breaking. The iPhone app pins the CA keys with NSPinnedDomains in `Info.plist`. A connection presenting any other certificate fails; the iOS CI test proves it by swapping the pins.",
        code: [
          "artifacts/mobile/android/app/src/main/res/xml/network_security_config.xml",
          "artifacts/mobile/ios/SecureAI/Info.plist",
        ],
      },
      {
        name: "Key switched off on new biometrics",
        detail:
          "Adding a new fingerprint or face to the phone switches the app's sign-in key off.",
        whereLabel: PHONE_APP,
        how: "The phone key can only be used after a biometric check. On iPhone it is created with `kSecAccessControlBiometryCurrentSet` (a patch to react-native-biometrics); on Android the Keystore key requires user authentication, and Android invalidates such keys when a new fingerprint is enrolled. Someone who adds their own finger or face can't use the key.",
        code: [
          "artifacts/mobile/patches/react-native-biometrics@3.0.1.patch",
          "artifacts/mobile/src/lib/biometricKey.ts",
        ],
      },
      {
        name: "No phone backups of app data",
        detail:
          "App data, including the session, is excluded from backups and phone-to-phone transfers.",
        whereLabel: PHONE_APP,
        how: "`AndroidManifest.xml` sets `allowBackup=\"false\"` and data-extraction rules that exclude the app's data from cloud backup and device-to-device transfer, so the signed-in session can't be copied off the phone.",
        code: [
          "artifacts/mobile/android/app/src/main/AndroidManifest.xml",
          "artifacts/mobile/android/app/src/main/res/xml/data_extraction_rules.xml",
        ],
      },
      {
        name: "No tokens in app storage",
        detail: "The session lives in the phone's native cookie store.",
        whereLabel: PHONE_APP,
        how: "The session cookie is HttpOnly and lives in the phone's native cookie store, which React Native's fetch sends automatically; the app's code never reads it or copies a token into AsyncStorage. The only cookie it reads is the CSRF token, to repeat it in a header.",
        code: ["artifacts/mobile/src/lib/api.ts"],
      },
      {
        name: "Locked in-app face check",
        detail:
          "The face check runs in an in-app browser locked to the site's own address.",
        whereLabel: PHONE_APP,
        how: "The face check's WebView only loads the site's own origin: `originWhitelist` and `onShouldStartLoadWithRequest` refuse any other address, and new windows are disabled.",
        code: ["artifacts/mobile/src/components/FaceCapture.tsx"],
      },
      {
        name: "Encrypted traffic only",
        detail: "Unencrypted connections are allowed only in debug builds.",
        whereLabel: PHONE_APP,
        how: "Android: the network security configuration leaves plain HTTP at the platform default, which blocks it; only the debug build's manifest allows it, for a local development server. iPhone: App Transport Security stays on (NSAllowsArbitraryLoads is false), and the iOS CI job checks that a Release build has no plain-HTTP exception.",
        code: [
          "artifacts/mobile/android/app/src/main/res/xml/network_security_config.xml",
          "artifacts/mobile/android/app/src/debug/AndroidManifest.xml",
          "artifacts/mobile/ios/SecureAI/Info.plist",
        ],
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
        how: "GitHub branch protection on main requires three CI checks to pass (typecheck and dependency audit, Semgrep, and the load test with attack probes) and an approval from the code owner (`.github/CODEOWNERS`). A new push dismisses earlier approvals, and the last push must be approved by someone other than its author. Repository administrators can still override it.",
        code: [".github/CODEOWNERS", ".github/workflows/ci.yml"],
      },
      {
        name: "Static analysis",
        detail: "Semgrep scans every change with OWASP Top 10 rules.",
        controlId: "ci",
        how: "The semgrep-sast CI job scans every change with Semgrep's OWASP Top 10, TypeScript and React rulesets, with `--error` so any finding fails the build.",
        code: [".github/workflows/ci.yml"],
      },
      {
        name: "Dependency rules",
        detail:
          "Dependencies are audited, new package versions must be 7 days old, and GitHub Actions are pinned.",
        controlId: "ci",
        how: "CI runs `pnpm audit` and fails on a critical advisory; `pnpm-workspace.yaml` refuses package versions less than 7 days old (`minimumReleaseAge`) and pins fixed versions of vulnerable transitive packages; GitHub Actions are pinned to commit SHAs.",
        code: ["pnpm-workspace.yaml", ".github/workflows/ci.yml"],
      },
      {
        name: "Dynamic scan",
        detail:
          "OWASP ZAP attacks a fresh build, signed in as a user and as an administrator.",
        controlId: "ci",
        how: "The dast-zap CI job builds a fresh API, downloads ZAP 2.17.0 (checked against its SHA-256), and runs an authenticated active scan from the OpenAPI spec as a user and as an admin; any Medium or High alert fails the build.",
        code: [
          "scripts/security/dast/zap-local.mjs",
          ".github/workflows/ci.yml",
        ],
      },
      {
        name: "Attack probes and load test",
        detail:
          "About 50 scripted attacks and a concurrency test run against a live build.",
        controlId: "ci",
        how: "Against a freshly built server, the probes try SQL injection, CSRF, missing and wrong-role access, IDOR, stored XSS, mass assignment, prototype pollution, CORS, payment tampering, idempotency and refund races, breached passwords and email confirmation; the load test fires concurrent sign-ins at the rate limiter and re-verifies the audit chain.",
        code: [
          "scripts/src/security/adversarial-probes.ts",
          "scripts/src/security/load-test.ts",
        ],
      },
      {
        name: "Verification suites",
        detail:
          "Automatic checks for encryption keys, retention, differential privacy, data sources, alert email, ClamAV and breached passwords.",
        controlId: "ci",
        how: "Focused `verify:*` scripts in CI prove properties that are easy to break silently: the encryption keyring, retention, differential privacy, data sources, alert email, the ClamAV client and the breached-password check.",
        code: [
          "artifacts/api-server/src/lib/*.verify.ts",
          ".github/workflows/ci.yml",
        ],
      },
      {
        name: "iPhone build and pinning test",
        detail:
          "The iPhone app is built and its pinning tested on a Mac for every change to it.",
        controlId: "ci",
        how: "For every change to the phone app, the iOS workflow typechecks it, builds a Release app for the iPhone Simulator on a Mac, and checks the pins match the chain the live site serves and that there is no plain-HTTP exception. Then it runs the app: the first request to the live API must succeed with the real pins and be refused with both pins replaced.",
        code: [".github/workflows/ios.yml"],
      },
    ],
  },
];

export const SECURITY_FEATURE_COUNT = SECURITY_FEATURE_AREAS.reduce(
  (sum, area) => sum + area.features.length,
  0,
);
