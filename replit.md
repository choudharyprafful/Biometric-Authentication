# SecureAI — Biometric Security Demo

A security proof-of-concept platform demonstrating biometric MFA (face and/or WebAuthn passkey on web; passkey-only on mobile), secure session management, access control, encrypted-at-rest data (files, face descriptors, payment tokens), signed/replay-resistant payment webhooks, CSRF/CORS/transit hardening, audit logging, and simulated subscription payments. Built as a student project deliverable (Team 1 — Technical Security) per the brief.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/secureai run dev` — run the frontend (port from $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — rebuild lib declarations (run after changing lib/db or lib/api-spec)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm run ci` — static half of the CI pipeline (typecheck + `pnpm audit --audit-level=critical`), runnable standalone
- `pnpm --filter @workspace/scripts run security:load-test` / `security:probes` — dynamic half (concurrency + adversarial-payload tests); needs the dev servers already running. See `docs/04_Threat_Model_Risk_Assessment.md` Section 3
- Required env: `DATABASE_URL` — Postgres connection string. Connects as a scoped `secureai_app` role (SELECT/INSERT/UPDATE/DELETE on this app's own tables only), not the `postgres` superuser
- Required env: `SESSION_SECRET` — express-session secret
- Optional env: `FILE_ENCRYPTION_KEY` — 64-char hex string (32 bytes), AES-256 key for encrypting uploads, face descriptors, and payment provider tokens at rest. Falls back to a key derived from `SESSION_SECRET` for local dev — set a real one before any real deployment.
- Optional env: `WEBHOOK_SECRET` — HMAC secret for verifying `POST /payments/webhook` signatures. Falls back to a dev default; set a real one before any real deployment.
- `.env` is gitignored — copy `.env.example` and fill in real values; never commit `.env` itself.
- `artifacts/mobile` — Expo/React Native app, password + native passkey only (no face factor). See `artifacts/mobile/README.md` for setup; not run against a real device in this environment.
- `python3 artifacts/ai-model/model_starter.py` — AI/ML training-pipeline security PoC (brief §8). Pure Python 3 standard library, no install step, runs in under a second

## Demo Credentials

All demo accounts use password: `Password123!`

- `admin_user@prafful.com` — admin role (user management, role changes, account deletion — no audit-log visibility, by design)
- `security_monitoring@prafful.com` — security_analyst role (full audit-trail/threat visibility — no user-management authority, by design)
- `it_support@prafful.com` — it_support role (view users, reset a locked-out user's password link, clear their face+passkey enrollment — no role changes, no deletion, no audit-log visibility)
- `admin@prafful.com` — regular user
- `bob@prafful.com` — regular user

None start MFA-enrolled. At least one of face enrollment or passkey registration is required before any protected page or API route is reachable — the `/enroll` page starts with face by default and offers passkey next, but completing either one alone is enough to reach the dashboard.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7, wouter routing, TanStack React Query, face-api.js, @simplewebauthn/browser
- API: Express 5, express-session (PostgreSQL-backed via connect-pg-simple), @simplewebauthn/server, cookie-parser
- DB: PostgreSQL + Drizzle ORM
- Auth: bcryptjs password hashing + face biometric MFA + WebAuthn passkeys (either satisfies MFA)
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec at lib/api-spec/openapi.yaml)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (users, securityLogs, threats, payments, uploads, passwordResetTokens, passkeys, sessions)
- `artifacts/api-server/src/routes/` — Express route handlers (auth, passkeys, users, security, payments, uploads, webhooks — the payment webhook lives in its own file, kept out of the `router.use(requireMfaEnrolled)`-style blanket middleware other route files apply)
- `artifacts/api-server/src/middlewares/requireMfaEnrolled.ts` — blocks protected routes server-side unless both face AND passkey are enrolled (the frontend route guard is UX only; this is the real enforcement)
- `artifacts/api-server/src/middlewares/csrf.ts` — double-submit-cookie CSRF protection
- `artifacts/api-server/src/middlewares/requestRateLimit.ts` — per-account sliding-window rate limiting for uploads/payments/passkey-registration (login has its own limiter in `lib/rateLimit.ts`)
- `artifacts/api-server/src/lib/faceUtils.ts` — Euclidean distance face comparison (threshold 0.6)
- `artifacts/api-server/src/lib/fileEncryption.ts` — AES-256-GCM encrypt/decrypt helpers (+ JSON convenience wrappers), used for uploaded files, face descriptors, and payment provider tokens
- `artifacts/api-server/src/lib/imageSafety.ts` — detects real image format from magic bytes (PNG/JPEG/GIF/WebP), independent of client-declared MIME type, then strips EXIF/GPS/text metadata using that detected format
- `artifacts/api-server/src/lib/malwareScan.ts` — signature-based upload scan (EICAR test file, executable magic bytes disguised as another type, script injection inside SVG)
- `artifacts/api-server/src/lib/webhookSignature.ts` — HMAC-SHA256 webhook signing/verification with anti-replay timestamp check
- `artifacts/api-server/src/lib/allowedOrigins.ts` — shared origin allowlist, used by both CORS config and the WebAuthn relying-party resolver
- `artifacts/api-server/src/lib/rateLimit.ts` — in-memory sliding-window rate limiter (login credential-stuffing defense)
- `artifacts/api-server/src/lib/sessionPolicy.ts` — idle-timeout and absolute-cap constants for session lifetime
- `artifacts/api-server/src/lib/retention.ts` — periodic purge of used/expired password reset tokens
- `artifacts/api-server/src/lib/plans.ts` — canonical subscription plan catalog (server-only source of truth for prices)
- `artifacts/api-server/src/lib/auditLog.ts` — hash-chained security event logging helper
- `artifacts/api-server/src/lib/seed.ts` — demo data seeder (runs on startup if DB is empty)
- `artifacts/secureai/src/` — React frontend (pages, components, auth context); notable `lib/`: `livenessDetection.ts` (blink-based liveness state machine), `cardValidation.ts` (client-only card format/checksum validation)
- `artifacts/mobile/` — Expo/React Native app; `src/lib/passkey.ts` wraps `react-native-passkey` against the same `/auth/passkey/*` endpoints the web app uses
- `artifacts/ai-model/model_starter.py` — standalone AI/ML training-pipeline security PoC (brief §8), no dependencies beyond the Python 3 standard library, `python3 model_starter.py` runs the full demo in under a second. Not wired into the live app — see `replit.md`'s AI/ML bullet above and `docs/05_Consent_and_Deletion_Design.md` Section 5

## Architecture decisions

- **Session cookies over JWTs**: express-session with PostgreSQL store (`user_sessions` table). Simpler, revocable, httpOnly cookies prevent XSS token theft.
- **Liveness detection on face capture — blink-based, client-side (`lib/livenessDetection.ts`)**: before a face descriptor is captured (enrollment) or auto-submitted (login/reset verification), the user must complete a genuine open→closed→open eye transition, tracked via Eye Aspect Ratio (EAR) computed from face-api.js's 68-point landmarks (`BlinkDetector` state machine). A static photo held up to the webcam can't blink. Thresholds are adaptive per session rather than fixed, since absolute EAR values vary too much across cameras/lighting to use a universal number.
  - Three real spoofing techniques were found and closed during development: a tilted/moved photo faking an EAR dip via perspective distortion (fixed by also requiring the face position to stay stable during the dip); a perfectly still photo faking a shallower dip via pure sensor/exposure noise (fixed by requiring the dip to show a genuine open→dip shape and recover within 800ms); and a first version of that shape check that was too strict and rejected real blinks (fixed by using the same close-boundary ratio for the "was recently open" check rather than a separate stricter one).
  - Honest limit: this is a client-side behavioral heuristic, not a cryptographic liveness proof. It doesn't defeat a video replay of a real blink, and a direct API call bypassing the UI skips it entirely — which is why face-scan is the fallback factor here, not the primary one. WebAuthn's signed challenge is the actual cryptographic guarantee. Covered by 10 unit test assertions on the `BlinkDetector` state machine.
- **Mobile client, device-native only (`artifacts/mobile`)**: password + native passkey, no face factor — this is the brief's decision #1 built exactly as written, distinct from the web app's dual-factor departure. Talks to the same `/auth/passkey/*` WebAuthn endpoints via `react-native-passkey`, which produces/consumes the same JSON shapes `@simplewebauthn/browser` does, so no mobile-specific backend branching was needed. Not run against a real device in this environment — see `artifacts/mobile/README.md`, including the Digital Asset Links domain-verification step real passkey testing needs.
- **MFA policy: face OR passkey, not both**: `requireMfaEnrolled` was relaxed from requiring both factors to requiring either one, so a passkey-only mobile account (no way to enroll a face factor) isn't permanently locked out. Standard 2FA is password + one additional factor — this removes an extra hardening requirement layered on beyond the brief's ask, not a weakening below it. Web's `Enroll.tsx`/`AuthContext.tsx` route guard updated to match: completing either factor now reaches the dashboard instead of forcing both.
- **Two biometric factors on web, either one satisfies MFA**: Face descriptor matching (in-browser 128-float vector, server compares via Euclidean distance < 0.6) is a real control but isn't a cryptographically signed challenge. WebAuthn passkeys close that gap: the device biometric unlocks a secret key that signs a server-issued challenge, and that signature is the actual second factor. At least one is required to reach any protected route (`requireMfaEnrolled`, enforced server-side, not just a frontend redirect) — see the MFA policy bullet above. At login/reset, the passkey is offered as the preferred factor with face scan as an explicit fallback, and web users can still enroll both for extra assurance even though only one is required.
- **Two-step login**: Step 1 (password) creates a short-lived `pendingUserId + tempToken` in session. Step 2 (face or passkey) validates it and upgrades to a full session. Prevents a fake "biometric OK" message from bypassing auth.
- **General per-account rate limiting beyond login** (`middlewares/requestRateLimit.ts`): `POST /uploads` (malware scan + AES encryption on every call), `POST /payments` and `/payments/subscribe`, and `POST /auth/passkey/register-verify` are all keyed per-account and capped within a rolling window, returning `429` + `Retry-After` once exceeded. Reuses the same in-memory sliding-window primitive as login rate limiting (`lib/rateLimit.ts`).
- **Credential-stuffing defense on login**: `POST /auth/login` is rate-limited two ways — 5 failed attempts per account / 15 min (stops targeted brute force) and 20 failed attempts per IP / 15 min across any accounts (stops a bot rotating through a stolen credential list). Even a correct password is rejected while locked out; a successful login only clears the per-account counter, not the per-IP one.
- **Login rate limiter concurrency fix**: the original implementation checked the limit and recorded a failed attempt as two separate calls with an `await` gap in between, so a burst of simultaneous requests could all pass the check before any of them counted. A 30-way concurrent flood against one account (limit 5) confirmed it: 30/30 got through. Fixed by reserving atomically before any async work (`checkAndRecordRequest`); re-run after the fix: 5/30 got through, 25 rate-limited. Kept as a regression test: `scripts/src/security/load-test.ts`.
- **Session lifetime is an idle-timeout plus an absolute cap, not a flat window**: `rolling: true` + 30-minute `maxAge` (an abandoned session expires on its own; an actively-used one keeps sliding forward), plus a separate 12-hour `absoluteExpiresAt` checked on every request, independent of activity. Complements `POST /auth/logout-all` (session revocation / "logout everywhere") rather than replacing it — logout-all is the deliberate response once someone notices; idle-timeout is the safety net for when nobody does.
- **Step-up re-authentication for account deletion**: deleting your own account requires re-entering your current password, verified server-side (`bcrypt.compare`) immediately before the delete — an already-unlocked session alone isn't sufficient for the one irreversible action. Not required when an admin deletes a different account.
- **Database connection is least-privilege, not superuser**: connects as `secureai_app`, a role granted exactly `SELECT`/`INSERT`/`UPDATE`/`DELETE` on this app's own tables — verified directly: normal CRUD succeeded, a `CREATE TABLE` attempt was rejected.
- **Scripted adversarial-probe suite** (`scripts/src/security/adversarial-probes.ts`, `pnpm --filter @workspace/scripts run security:probes`): SQL injection against login, CSRF with a missing/mismatched token, auth-bypass against admin- and security_analyst-only routes, IDOR (one user reading/deleting another's account by ID), and stored XSS through registration. A practical substitute for a real OWASP ZAP/Burp pass, not a replacement — see `docs/04_Threat_Model_Risk_Assessment.md` Section 3.
- **CI pipeline**: `.github/workflows/ci.yml` chains typecheck + `pnpm audit --audit-level=critical` (critical-only threshold, since current findings are all dev/build-tooling-only), then a live-server job running the load test and adversarial probes above against a freshly-built, freshly-migrated server. Every command has been proven individually; the assembled workflow hasn't been run through an actual GitHub Actions runner in this environment (no git remote to trigger one).
- **Timing-safe login (no user enumeration via response time)**: when the submitted email doesn't match any account, the handler still runs a bcrypt compare against a module-level `DUMMY_PASSWORD_HASH` before recording the failed attempt, so a nonexistent-account response costs the same bcrypt work as a wrong-password response on a real account (CWE-208).
- **Per-route JSON body-size limits**: the global `express.json()` cap is 256KB; `/api/uploads` gets its own 15MB allowance since it legitimately carries base64-encoded files.
- **Password reset requires the same MFA proof as login, not just link possession**: `/auth/forgot-password` issues a single-use, hashed, time-limited token (no email provider configured for this demo — outside production the link is returned directly in the response). Possessing the link isn't sufficient — `/auth/reset-password/verify` reports which factor is available, and only a live face match or a signed passkey challenge actually changes the password. Accounts with neither factor enrolled get a "contact an administrator" message.
- **Encryption at rest, uniformly**: uploaded files, face descriptors, and payment provider tokens are all AES-256-GCM encrypted before being written to Postgres. Uploads are strictly owner-only to decrypt (no admin bypass, unlike payments/users).
- **Uploads validated and sanitized server-side, never trusted from the client**: images get a magic-byte format check independent of the declared MIME type, then have EXIF/GPS/text metadata stripped before encryption (JPEG APPn/COM, PNG tEXt/zTXt/iTXt/eXIf/tIME, GIF Comment Extension, WebP EXIF/XMP RIFF chunks — hand-rolled at the segment/chunk level, no image-decode dependency, fails open to the original bytes on malformed input). Video is out of scope — MP4/MOV container metadata stripping needs a real parser (documented limitation in `docs/04_Threat_Model_Risk_Assessment.md`). Capped at 15MB, base64 JSON body. The `/api/uploads` body-size allowance in `app.ts` is raised in tandem (21mb) for base64's ~33% inflation.
- **Image validation is detect-based, not declared-type-based** (`lib/imageSafety.ts`'s `detectImageFormat`): browsers derive `file.type` for a locally-picked file from the extension, not the content, so a legitimate WebP saved with a `.png` filename would be wrongly rejected under declared-type checking. Fixed by detecting the actual format from the bytes and using that single detection for both acceptance and metadata stripping.
- **Upload scanning is signature-based, explicitly not a full antivirus engine** (`lib/malwareScan.ts`): detects the EICAR test file, executable magic bytes masquerading as text/image/video (PE/ELF/Mach-O/Java-class headers), and `<script>`/event-handler injection inside SVG. A production deployment would swap `scanBuffer`'s body for a ClamAV or cloud-AV call at the same call site.
- **CSRF — double-submit cookie**: a `csrf_token` cookie (readable by JS, unlike the session cookie) must be echoed back as an `X-CSRF-Token` header on every state-changing request. A cross-site page can trigger a request carrying the session cookie automatically, but can't read the CSRF cookie to also set the matching header. Wired into both the generated API client and the hand-rolled passkey fetch calls. The payment webhook is exempted (server-to-server, trust comes from the HMAC signature instead).
- **CORS — allowlist, not `origin: true`**: origins are resolved through the same allowlist the WebAuthn relying-party check uses (`lib/allowedOrigins.ts`).
- **Transit hardening**: HTTPS is force-redirected in production (308) with HSTS; `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and a strict `Content-Security-Policy` are set on every response. No-op in local dev (no TLS available locally) — `trust proxy` is enabled so `req.secure` reflects `X-Forwarded-Proto` correctly behind a reverse proxy.
- **Payment tokenisation**: Server generates a `tok_*` provider token; raw card numbers never touch the API. Simulates PCI-compliant Stripe-style tokenisation.
- **Card entry UI stops at the browser** (`lib/cardValidation.ts`, used by `pages/Payments.tsx`): the card number/expiry/CVV form (Luhn checksum + expiry validation) is local to the React form and never included in the `POST /payments` or `/payments/subscribe` request bodies — same design as Stripe Elements, minus a real provider on the other end. "Deducted from card ending in XXXX" on the confirmation screen is derived entirely from that discarded client-only state; there's no server-side concept of a card balance.
- **Signed, replay-resistant payment webhooks**: `POST /payments/webhook` validates an HMAC-SHA256 signature over `${timestamp}.${rawBody}` and rejects any timestamp more than 5 minutes stale.
- **Subscription pricing is server-canonical, never client-supplied**: `POST /payments/subscribe` takes a `planId` only — price is always looked up from `lib/plans.ts` server-side. Also blocks re-subscribing to the same plan.
- **Audit logs are security_analyst-only, deliberately excluding admin**: `/security/logs`, `/security/logs/verify`, and `/security/dashboard`'s event-level `recentLogs` feed check specifically for `role === "security_analyst"`. Separation of duties — the role with account-management authority isn't the role with audit-trail visibility. Aggregate telemetry counts stay visible to everyone; only event-level detail is restricted.
- **`security_analyst`** — read-only monitoring role, disjoint from admin (full audit-trail visibility, zero account-management authority). Demo account: `security_monitoring@prafful.com`.
- **`it_support`** — a narrower slice of admin's authority, not disjoint: `canManageUsers()` returns true for both `admin` and `it_support`. Scoped to `POST /users/:id/reset-mfa` (clears face descriptor + all passkeys, forcing re-enrollment) and `POST /users/:id/reset-password` (issues a staff-triggered reset link). No role-change or delete authority, no audit-log visibility. Demo account: `it_support@prafful.com`.
- **Multi-field log filtering** (`routes/security.ts`'s `buildLogFilterConditions`): event type, user email/IP (case-insensitive partial match), and a date range — all optional, AND-combined.
- **Audit logging**: every security event (login, face/passkey enroll or verify, password reset, upload access, subscription change, payment, webhook received/rejected, rate-limit hit) is written to `security_logs` with IP, user-agent, and details. No passwords, full tokens, or biometric descriptor values are logged anywhere; `PAYMENT_CREATED` logs only a truncated token prefix.
- **Tamper-evident audit log (hash chain)**: each row stores `hash = SHA256(prevHash + eventType + details + userId + userEmail + ipAddress + userAgent + timestamp)`, linking it to the row before it. `GET /security/logs/verify` recomputes the entire chain and reports exactly which row broke and why. Writes are serialized through an in-memory promise queue (`lib/auditLog.ts`) so concurrent requests can't fork the chain. Rows written before this feature existed have `hash`/`prevHash` = null and are treated as a known pre-chain gap.
- **Deletion doesn't break the audit/financial trail**: deleting a user preserves payment and audit history (a redundant `userEmail` text column on both tables keeps it attributable) instead of losing financial/audit records when an account goes away. Uploads and passkeys cascade-delete with the account.
  - `payments.userId` is a foreign key with `ON DELETE SET NULL`.
  - `securityLogs.userId` is deliberately not a foreign key at all: `SET NULL` mutates a hash-chained row's content after its hash was already computed, which silently broke `/security/logs/verify` on every account deletion. A hash-chained row's content must never change after being written. See `04_Threat_Model_Risk_Assessment.md`, R-LOG-3.
- **Consent, captured and enforced separately per data category (brief §6)**: Team 2 owns consent policy; Team 1 enforces it. General data-processing consent (`dataConsentGiven`) is required at `POST /auth/register`. Biometric consent (`biometricConsentGiven`) is a separate flag required again at `POST /users/:id/enroll-face`. Withdrawal and deletion are the same action — `DELETE /users/:id/face` clears the stored descriptor and resets `biometricConsentGiven` together. Honest limit: because face + passkey are both mandatory, withdrawing consent blocks the account from every protected route again until re-enrollment.
- **AI/ML model security — live app doesn't train a model; a standalone PoC now demonstrates the pipeline case**: the running web/API app still trains/hosts no model (face-api.js is pretrained, client-side, never learns from user data). Separately, `artifacts/ai-model/model_starter.py` is a small, self-contained word-level n-gram model built to demonstrate brief §8's training-pipeline requirements on synthetic data: a consent gate that rejects non-consented records before training, a per-user contribution cap (anti-poisoning), sentence-level deduplication that's verified (by actually running it) to block a planted canary secret from being extracted while genuine repeated patterns still generate correctly, and a delete-and-retrain mechanism with an honest statement of what it can't do (un-teach an already-deployed model). Not wired into the live app — see `docs/04_Threat_Model_Risk_Assessment.md`'s AI/ML section and `docs/05_Consent_and_Deletion_Design.md` Section 5 for the full writeup.

## Product

Authenticated + fully-MFA-enrolled users see:

- **Dashboard** — security telemetry cards (visible to all), recent events feed (security_analyst only)
- **Enrollment** — two mandatory stages: webcam face capture → 128-element descriptor, then WebAuthn passkey registration. Neither is optional; the app is unusable until both are done.
- **Threat Assessment** — board of detected threats with severity/status. Each threat has both a jargon-heavy technical `description` (for security staff) and a plain-English `plainSummary` — the UI leads with the plain-English version and keeps the technical detail available underneath.
- **Payments** — subscription tier cards (Plus/Pro/Team, fixed server-side pricing) + one-off simulated payment ledger, provider tokens encrypted at rest
- **Data Vault** — upload text/image/video/audio files, AES-256-GCM encrypted at rest with EXIF/location stripped from images (JPEG/PNG/GIF/WebP — video and audio containers aren't parsed for embedded metadata, a documented limitation), view/download/delete; strictly owner-only, no admin access to content.
- **Data Protection** — a plain-language table of every data category the app stores, where it lives, its at-rest protection, and who can access it

Admin and security_analyst are disjoint, not tiers of each other; it_support is a narrower slice of admin, not a third disjoint peer:

- **Security Logs** (security_analyst only, NOT admin or it_support) — full cross-user audit trail with multi-field filtering (event type, user, IP, date range)
- **User Management** (admin and it_support) — both can view the user list and help a locked-out user recover (send a password reset link, clear face+passkey enrollment). Role changes and account deletion stay admin-only.

## User preferences

*Populate as you build*

## Gotchas

- Always run `pnpm run typecheck:libs` after changing `lib/db/src/schema/` before running the API server typecheck — stale composite declarations cause false "module has no exported member" errors.
- Orval 8.23.0 with Zod 3.25.76: do NOT use `type: integer` or `format: email` in the OpenAPI spec — these trigger Zod v4 methods (`zod.int()`, `zod.email()`) that don't exist on the v3 API surface. Use `type: number` and plain `type: string` instead.
- Don't name an OpenAPI component schema exactly `<operationId>Response` or `<operationId>Body` (e.g. `ForgotPasswordResponse` for operation `forgotPassword`) — Orval auto-generates a same-named constant for the operation and the two collide on export. Pick a distinct name (`...Result`), or use the Orval-generated name directly.
- `drizzle-kit push` needs an interactive TTY to resolve column rename-vs-recreate ambiguity; it hangs/errors in non-interactive shells (CI, scripted runs). Either run it from a real terminal, or make the column change unambiguous first (e.g. drop the old column via raw SQL before pushing the new one). `push-force` skips the prompt entirely and is safe against a fresh/empty database.
- Adding a `references()` FK to an existing column that already has orphaned values fails the push with a Postgres FK-violation error, not a drizzle-kit prompt — clean up orphans first (`UPDATE ... SET user_id = NULL WHERE user_id NOT IN (SELECT id FROM users)`), then push.
- face-api.js models load from CDN (~12MB total) — first face capture has a 5-15s model download delay.
- Model weight source (`lib/faceRecognition.ts`) is pinned to a specific upstream commit hash, not `master` — closes an ML supply-chain gap where a compromised upstream branch could swap in malicious weights unnoticed. Re-pin deliberately (update the hash) rather than moving back to a branch reference.
- The `token` field in AuthResponse is just the string "authenticated" — real auth is the session cookie. Don't use it as a bearer token.
- Seeded demo accounts start with neither face nor passkey enrolled — "forgot password" won't work for them (and most protected routes won't either) until MFA enrollment is completed at least once.
- CSRF protection means any new hand-rolled `fetch()` call (outside the generated API client) must manually attach the `X-CSRF-Token` header on non-GET requests — see the `mutatingHeaders()` helper in `artifacts/secureai/src/lib/passkey.ts` for the pattern.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- `docs/` — the brief's §8 deliverables that don't belong in a dev README: security architecture
  diagram, authentication flow diagram, data flow diagram (incl. the assumed training pipeline),
  threat model / risk assessment, and the consent-enforcement & deletion-mechanism design note
