# Threat Model / Risk Assessment — SecureAI

Team 1: Technical Security. CORE brief requirement. Method: STRIDE per component (Section 1), rolled
up into a prioritised risk register (Section 2), plus the security-testing approach the brief asks for
(Section 3).

## 0. Scope and assumptions

- Assessed system: this repository's proof-of-concept — web app + Express API + PostgreSQL (the deep
  PoC), plus a mobile client (`artifacts/mobile`, Expo/React Native) covering the brief's Tier 1 §4
  mobile requirement at a narrower scope: password + native passkey only, no face factor, matching the
  brief's device-native-only design exactly (unlike the web app's dual-factor departure — see below).
  The mobile app has not been run against a real device/emulator in this environment (no Android SDK
  available here) — see `artifacts/mobile/README.md` for what's built vs. what still needs a real
  device to verify, including the Digital Asset Links domain-verification step native passkeys require.
  Certificate pinning on mobile (brief §5.2) is implemented for Android release builds via
  `network_security_config.xml` (see R-MOBILE-2) with placeholder pin values pending a real production
  domain; iOS pinning is not implemented (no `ios/` project exists yet in this PoC).
- **MFA completion policy: face OR passkey, not both.** `requireMfaEnrolled` was relaxed from requiring
  both factors to requiring either one, specifically so a passkey-only mobile account (which has no way
  to enroll a face factor) isn't permanently locked out. This also means a web account can now reach
  protected routes with just one factor enrolled — standard 2FA is password + one additional factor,
  so this isn't a weakening below what was actually asked for, just removal of an extra hardening
  requirement (both factors mandatory) that had been layered on beyond the brief's ask.
- Dummy data only, per the brief's ground rules — no real personal data, card numbers, or biometrics
  used in testing.
- **Service-account least privilege (brief §5.3).** The application connects to Postgres as
  `secureai_app`, a role granted exactly `SELECT`/`INSERT`/`UPDATE`/`DELETE` on this app's own tables and
  nothing else, not the `postgres` superuser. Verified directly: a raw `CREATE TABLE` attempt under that
  role was rejected with "permission denied for schema public," while normal CRUD worked. See R-AC-2.
- **Deliberate deviation from the current brief's biometric scope decision.** The brief's revised
  Section 2 decision #1 scopes biometric MFA as device-native only and states that "app-captured
  biometric verification is out of scope" and "no biometric data is held server-side." This PoC keeps
  its original dual-factor design instead: a face descriptor is captured in-browser and compared
  server-side (see `02_Authentication_Flow.md`, "Biometric MFA specifically," and `03_Data_Flow.md`),
  alongside WebAuthn/passkey. This is a conscious choice, not an oversight — the face-matching path
  represents substantial hardening work and remains mandatory alongside, not instead of, the passkey
  factor the current brief asks for exclusively. The resulting gap: this PoC stores a biometric template
  server-side (encrypted, consented, deletable — see `05_Consent_and_Deletion_Design.md`) in a design the
  brief's current revision says shouldn't exist. Revisit before final submission — either migrate to
  passkey-only MFA or keep this as a documented, reasoned departure.
- **The live web/API application still trains no model** — face-api.js is a pretrained, client-side
  comparison library that never learns from user data (see `03_Data_Flow.md`). Separately, a **standalone
  AI/ML security PoC** now exists at `artifacts/ai-model/model_starter.py`: a small word-level n-gram
  model, trained on synthetic records only, built specifically to demonstrate the brief's §8 AI/ML
  requirements (data poisoning, training-data memorisation/leakage, consent enforcement, deletion) with
  a live, runnable attack-then-defend demo. It is not wired into the running Node/TS application — it's a
  separate, self-contained fixture (per its own header: "It is NOT a product... it is a test fixture that
  exists to be attacked"), consistent with the brief's acceptance criterion #3 ("a working PoC using
  synthetic data only" for at least one Tier 2/3 area). See the updated "AI/ML model security" section
  below for what it actually demonstrates and what it doesn't cover.
- `.env` was not gitignored; `.gitignore` had entries for build output and editor files but nothing for
  env files. Fixed — `.gitignore` now excludes `.env`/`.env.local`/`.env.*.local`; added `.env.example`
  documenting the required variables without real values.
- "Status" below reflects the actual state of this codebase, not an aspirational target — known,
  accepted gaps are marked as such rather than presented as solved.

## 0.1 Assets, threat actors, trust boundaries

- **Key assets**: user accounts & credentials; user-uploaded media; payment & subscription data; audit
  logs; a stored biometric template (per the scope deviation above — not present in the brief's own
  device-native baseline design). The live app trains/serves no model. The standalone AI/ML PoC's assets
  are its synthetic training corpus and the resulting n-gram model — both throwaway/regenerated on every
  run, not persisted anywhere the main app touches.
- **Threat actors**: external unauthenticated attacker; malicious authenticated user; compromised
  device/stolen session; malicious or negligent administrator (insider); automated bots (credential
  stuffing, scraping). Added for the AI/ML PoC specifically: a malicious data contributor poisoning a
  training set (modeled via the per-user contribution cap), and an attacker attempting extraction of
  memorised training data via crafted prompts (modeled via the canary-extraction test). Still not
  applicable to either the live app or the PoC: model theft via a served inference API — neither exposes
  one (see R-ML-4).
- **Trust boundaries**: web client ↔ backend API; backend ↔ Postgres; backend ↔ payment provider
  (simulated); device authenticator (WebAuthn) ↔ backend; browser (face-api.js) ↔ backend (the descriptor
  capture/compare boundary that exists specifically because of the biometric-scope deviation above). The
  AI/ML PoC's boundary is data ingestion → consent gate → training — modeled and demonstrated in isolation
  (`artifacts/ai-model/model_starter.py`), not connected to the live app's request path. Still not
  applicable: model ↔ inference API — no model-serving endpoint exists anywhere in this project.

## 1. STRIDE analysis by component

### Authentication & session management

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Spoofing | Attacker guesses/stuffs credentials | Per-account (5/15min) + per-IP (20/15min) rate limiting on `POST /auth/login` | Done — see the concurrency finding below (R-AUTH-2) |
| Spoofing | Rate limiter race condition under concurrency — a burst of simultaneous requests could all pass the "under the limit" check before any of them recorded, since the original implementation split check-and-record into two calls with an `await` gap (DB lookup + bcrypt compare) in between | Found with a concurrency load test: 30 simultaneous wrong-password attempts against one account, limit 5, all came back 401 — zero rate-limited. Fixed by making the reservation atomic (`checkAndRecordRequest`) and moving it before any async work; re-run after the fix: 5 got through, 25 got `429` | Fixed, re-verified (R-AUTH-2) — see `scripts/src/security/load-test.ts`, kept as a regression test |
| Spoofing | Attacker enumerates valid emails via login response timing | Dummy bcrypt compare on unknown-email path burns equivalent time | Done, verified live |
| Spoofing | Attacker replays a captured "biometric OK" client message | Rejected by design — second factor is a signed WebAuthn challenge, not a client-asserted boolean | Done |
| Tampering | Attacker forges a session cookie | `httpOnly`, signed session ID (express-session secret), server-side session store | Done |
| Repudiation | User denies performing a login/enrollment action | Every auth event logged to hash-chained `security_logs` | Done |
| Information disclosure | Session token exposed via XSS | `httpOnly` cookies (unreadable to JS); CSP restricts inline script execution | Done |
| Denial of service | Attacker floods `/auth/login` with large request bodies | Per-route JSON body limit (256KB default, separate 15MB allowance only for `/uploads`) | Done, verified live |
| Elevation of privilege | User reaches a protected route without completing MFA | `requireMfaEnrolled` enforced server-side on every protected route, not just a frontend redirect | Done |
| Spoofing | Device theft while unlocked (brief §8's illustrative threat) — an attacker with physical access to an already-authenticated, unlocked device/browser acts as the user for as long as the session cookie remains valid | Two controls: (1) `POST /auth/logout-all` deletes every persisted session row for the account, reachable from any other device — reactive, needs the owner to notice; (2) session cookie is an idle-timeout, not a fixed window (`rolling: true`, 30-minute `maxAge`), plus an absolute 12-hour cap independent of activity (`absoluteExpiresAt`, checked every request) | Mitigated (R-AUTH-5) — idle-timeout covers the "nobody notices" case logout-all alone doesn't |
| Elevation of privilege | Account deletion completable by anyone with access to an already-unlocked session, not just the account owner actively re-proving it's them | Step-up re-authentication: `DELETE /users/:id` for self-deletion requires the current password in the request body, verified server-side with `bcrypt.compare` immediately before the delete. Not required for admin-driven deletion of a different account | Fixed (R-AC-3) |
| Spoofing | Recovery-flow abuse / account-takeover-via-recovery (brief §7 explicitly names SIM-swap-style takeovers as the illustrative case to model) | See "Recovery-abuse analysis" below | Mitigated (R-AUTH-6) |

### Recovery-abuse analysis (brief §7 — "model recovery-abuse explicitly, e.g. SIM-swap-style takeovers")

**SIM-swap itself does not apply to this app's actual design.** Classic SIM-swap abuse requires an
SMS/phone-number-based recovery or MFA channel — an attacker social-engineers the victim's carrier into
porting the phone number to a SIM they control, then intercepts an SMS OTP or reset code. This app has no
phone number field, no SMS delivery, and no phone-based factor anywhere in registration, login, MFA, or
recovery. There is nothing to port. Stating this explicitly (rather than silently skipping the brief's
example) is itself part of the analysis the brief asks for.

**What this app's recovery channel actually is, and what abusing it would require:**

1. `POST /auth/forgot-password` issues a random 32-byte token, hashed before storage
   (`passwordResetTokensTable`), 30-minute TTL, single-use, attempt-capped (`RESET_MAX_ATTEMPTS`). In
   production this token would be emailed; in this demo (no email provider configured) it's returned
   directly in the API response only when `NODE_ENV !== "production"`, and the endpoint gives an identical
   response whether or not the email is registered (no account-enumeration via this path).
2. **Token possession alone is never sufficient.** `POST /auth/reset-password/face` (or the passkey
   equivalent) requires the *same live biometric/passkey proof as login* before the password actually
   changes — this is the design point already established in `02_Authentication_Flow.md` ("password-reset
   flow requires the same proof as login").

**The realistic analog to SIM-swap here is email-account takeover**, not phone-number porting: an
attacker who compromises the user's actual email inbox (phishing, credential reuse, provider-side breach)
would receive the reset link. Walking through what that buys them:

- They can open the link and reach the reset-password page.
- They **cannot** complete the reset — that still requires a live face scan matching the encrypted
  server-side descriptor, or a signed WebAuthn assertion from the enrolled physical device. An
  email-inbox compromise, however complete, does not hand over either of those.
- The only way recovery becomes a full account takeover is if the attacker *also* controls the victim's
  enrolled device (biometric) or a cloned/stolen passkey-bearing device — at which point the attacker
  already had the equivalent of physical device compromise independent of the email step, which is a
  different, already-modeled threat actor ("compromised device / stolen session," Section 0.1).

**Residual gap, stated honestly:** the reset-token TTL (30 minutes) and attempt cap bound the window and
guessability of the token itself, but this app does not currently rate-limit *how many `forgot-password`
requests* can be issued for one account in a period — an attacker with email access could request
unlimited reset links. This doesn't defeat the biometric/passkey gate above, but it is unbounded request
volume against an endpoint that does real work (token generation, a DB insert, an audit-log write) each
time. Accepted as a low-severity gap for PoC scope (see R-AUTH-6 below), not silently ignored.

### Biometric MFA specifically

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Spoofing | Attacker physically tilts/moves a static photo to fake an EAR dip | Face-box position/size tracked alongside EAR — a dip only counts as a blink if the face stayed stationary | Mitigated (R-BIO-1) |
| Spoofing | A static photo held perfectly still still produces a shallow EAR dip from pure noise (screen glare, auto-exposure, landmark jitter) — indistinguishable from a partially-sampled real blink by depth alone | Dip must show a genuine open→dip shape and recover within `MAX_RECOVERY_MS` (800ms) — real blinks are fast; static-image noise/drift is slower or shapeless | Mitigated, narrowed (R-BIO-1) — raises the bar considerably, doesn't guarantee immunity to every noise source that produces a fast, well-shaped dip |
| Spoofing | Attacker presents a video replay of the real user blinking while holding the camera/photo still, or a mask engineered to blink | Not defended against — this is a client-side behavioral heuristic, not a cryptographic liveness proof | Gap — accepted, documented (R-BIO-1, residual) |
| Tampering | Attacker tampers with the face-api.js model weights in transit/at source | Model source pinned to a specific upstream commit hash, not a moving branch | Done |
| Spoofing | Adversarial input (imperceptible perturbation, adversarial patch, or real-time pattern) crafted to make face-api.js extract a descriptor that falsely matches a different enrolled user, or evade detection (STRETCH — a different attack class from the presentation attacks R-BIO-1 addresses) | Not defended against — open problem for any biometric system without dedicated anti-spoofing hardware | Gap — accepted, documented (R-ADV-1) |
| Information disclosure | Face descriptor stolen from the database | AES-256-GCM at rest; descriptor is a 128-float vector, not a reversible image | Done |
| Elevation of privilege | Password-reset flow used to bypass MFA entirely | Reset requires the same live biometric/passkey proof as login, not just link possession | Done |

### Data protection & uploads

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Tampering | Malicious executable uploaded disguised as an image | Signature-based scan: EICAR string, PE/ELF/Mach-O/Java-class magic bytes | Done (not a full AV engine — R-DP-2) |
| Tampering | SVG containing `<script>`/event-handler XSS payload uploaded as an "image" | SVG-specific script/event-handler regex check | Done |
| Information disclosure | Uploaded photo's embedded GPS/EXIF metadata leaks the user's location | EXIF/GPS/text metadata stripped from JPEG, PNG, GIF, and WebP before storage | Done (JPEG/PNG/GIF/WebP). Video (MP4/MOV) container metadata is not stripped — accepted limitation |
| Information disclosure | Another user reads/downloads a user's uploaded file | Uploads are strictly owner-only to decrypt/download, no admin bypass | Done |
| Tampering | Client lies about a file's MIME type to bypass validation | Server detects the real image format from magic bytes independent of the declared type | Done |
| Elevation of privilege | Uploaded file lands somewhere it could later be executed (e.g. a public static-file directory that also serves `.js`/`.php`) | Uploads are never written to a filesystem path — content is stored as encrypted ciphertext columns (`uploads.ciphertext`/`iv`/`authTag`) directly in Postgres, decrypted only in-memory on owner-authenticated download | Done — structural, not a configuration choice that could drift |

### AI/ML model security (brief IMPORTANT tier)

The live web/API app trains no model (face-api.js is pretrained and client-side only) — those rows stay
N/A. A standalone PoC (`artifacts/ai-model/model_starter.py`) now demonstrates the training-pipeline
side of the brief's §8 requirements: a synthetic corpus with a deliberately duplicated "canary" secret is
trained into a word-level n-gram model twice — once without defenses (the canary is extractable via a
crafted prompt) and once with sentence-level deduplication and a consent gate (the canary is not
extractable, while genuine repeated *patterns* still generate correctly — confirmed by actually running
it, not just reading the code). See that file's own header comments for the full walkthrough; this table
records the outcome.

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Tampering | Data poisoning — attacker injects corrupted/mislabeled data into a training set | PoC: per-user contribution cap (`MAX_DOCS_PER_USER = 3`) enforced in `consent_gate()`, so no single contributor can dominate the corpus. Live app's closest analog: upload-time provenance/validation (magic-byte format detection, malware scan) — see `03_Data_Flow.md` point 2 | PoC implemented but **not exercised by the demo run** — the synthetic corpus generator never gives any user more than 2 records, so the cap of 3 never actually triggers in the sample output. Honest gap, not silently claimed as proven (R-ML-3) |
| Information disclosure | Model memorisation/leakage — a trained model regurgitates private training data, discoverable via membership-inference / extraction-style attacks | PoC: sentence-level exact-duplicate deduplication before training, tested with a real extraction attempt (prompt `"my private"` against a planted canary secret, duplicated across 5 users) | PoC mitigated, verified by actually running it: undefended model leaks the canary verbatim; deduplicated model does not, while a genuine repeated pattern (not the canary) still generates correctly afterward — proving the fix removes verbatim copying without breaking real learning (R-ML-1) |
| Denial of service / Elevation of privilege | Model theft/extraction via repeated inference-API queries | Neither the live app nor the PoC serves a queryable inference endpoint — the PoC is a local script, not a hosted API | Not applicable / not built — if this were ever wired behind a real endpoint, `middlewares/requestRateLimit.ts` (already used for uploads/payments) is the ready-made pattern to rate-limit it (R-ML-4) |
| Tampering | Model weights swapped for a malicious version in transit/at source | face-api.js model source pinned to a specific upstream commit hash | Done (R-SUPPLY-1) |
| Spoofing | Prompt-injection / unsafe generative output (STRETCH) | The PoC model is technically generative (greedy word-continuation) but not instruction-following — it has no system prompt or tool access to inject against, so "prompt injection" in the OWASP-LLM sense doesn't apply to it. No chat/LLM interface exists anywhere in the live app | Not applicable (R-ML-2) |
| Elevation of privilege / Tampering | Non-consented data reaches training | PoC: `consent_gate()` rejects any record without a `consent_id` before training ever sees it — demonstrated live with a planted non-consented record that is correctly blocked | Done, verified by running it (R-ML-5, new) |
| Tampering | Deleting a user's data doesn't actually remove it from a model that already learned from it | PoC: `delete_user()` removes the user's records from the corpus and the model is retrained from the reduced set — demonstrated live (10 → 8 records after deleting one user, retrain completes near-instantly) | Partial by design, and stated honestly rather than oversold: retraining removes the data going forward, but what an *already-deployed* model previously learned can't be surgically un-learned — the brief explicitly scopes this as "design an approach and state its limitations," not "solve machine unlearning" (R-ML-6, new) |
| Spoofing | Adversarial input crafted against face-api.js's real inference (STRETCH) | See "Biometric MFA specifically" above (R-ADV-1) | Gap — accepted, documented (R-ADV-1) |

### Access control

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Elevation of privilege | Regular user calls an admin-only endpoint directly (bypassing hidden UI) | Server-side role check on every admin route (`/security/logs`, user management) | Done |
| Information disclosure | Non-admin sees other users' audit log entries via `/security/dashboard` | `recentLogs` scoped empty for non-admins; only aggregate counts shown | Done |
| Elevation of privilege | IDOR / broken object-level authorisation — user modifies another user's data by substituting a different `:id` in a direct API call | Ownership check (`sessionUserId === params.data.id`) or admin/it_support role required, per route, on every ID-addressed resource (`users`, `uploads`, `payments`), enforced server-side in the route handler | Done — not yet exercised by an automated IDOR-specific test case (see Section 3) |
| Information disclosure | A shared, all-users-visible surface (`GET /security/threats`, intentionally not admin-gated by product design) leaks another account's identity through free-text content | Threat `description` is free text with no route to create/edit it via the API (seed-only) — one seed row naming a real account's email was found and scrubbed to a generic reference | Fixed (seed data corrected) |

### Secure communications

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Tampering | Cross-site request forges a state-changing action using the victim's session cookie | Double-submit-cookie CSRF (`csrf_token` cookie + `X-CSRF-Token` header) | Done |
| Spoofing | Malicious origin makes credentialed cross-origin requests | CORS allowlist (`lib/allowedOrigins.ts`), not `origin: true` | Done |
| Tampering | Man-in-the-middle intercepts/modifies traffic | HTTPS force-redirect + HSTS in production; no-op locally (no TLS available in dev) | Done (prod only, documented) |
| Information disclosure | Missing security headers enable clickjacking / MIME-sniffing attacks | CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` set on every response | Done |
| Denial of service | Authenticated user hammers a costly route (uploads, payments, passkey registration) with no limit | Per-account rate limiting (`middlewares/requestRateLimit.ts`) on `POST /uploads`, `/payments`, `/payments/subscribe`, `/auth/passkey/register-verify` | Done |
| Tampering | CSRF token comparison is timing-attackable, letting an attacker guess it byte-by-byte | `crypto.timingSafeEqual`, not `===`, used for the cookie/header comparison | Done |

### Logging

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Repudiation | Attacker (or insider) edits/deletes log rows to cover tracks | Hash chain (`prevHash` linkage); `GET /security/logs/verify` recomputes and reports exactly where the chain breaks | Done |
| Information disclosure | Logs contain plaintext secrets/PII beyond what's needed | Every `logEvent` call site audited: passwords and face descriptor values are never logged; `PAYMENT_CREATED` logs a 12-character prefix of the payment provider token (of a ~28-char token) — a truncated fragment, left as-is by decision | Mostly done — one accepted, reviewed exception (payment token prefix) |
| Tampering | Concurrent writes race the "previous hash" pointer and fork the chain | Writes serialized through an in-memory promise queue | Done (single-process only — see R-LOG-1) |
| Repudiation | Removing a passkey (weakening the account's MFA) leaves no audit trail | `DELETE /auth/passkey/:id` had no `logEvent` call, unlike the equivalent `FACE_REMOVED` event for the other factor. Added `PASSKEY_REMOVED` to `AuditEventType` and wired the log call | Fixed |
| Denial of service / Spoofing | Suspicious-activity detection (brief §5.5) — repeated failed logins, credential stuffing, or a single account/route being hammered should be a visible signal | Every rate-limit trip (`RATE_LIMIT_HIT`) is an audit-logged event with the threshold and key that fired, filterable in the Security Logs page | Partial — the signal exists and is queryable, but there's no active alerting/dashboard-highlighting; a security_analyst has to go looking |

### Payments

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Tampering | Client sends a tampered `amount` alongside a real `planId` | Price is always looked up server-side from `lib/plans.ts`; client-supplied amount is ignored | Done |
| Spoofing | Attacker forges a webhook call claiming a payment succeeded | HMAC-SHA256 signature verification over `${timestamp}.${rawBody}` | Done |
| Tampering | Attacker replays a genuinely-signed webhook later | Timestamp check rejects anything more than 5 minutes stale | Done |
| Elevation of privilege | Repeated subscription calls abuse the billing flow | Duplicate-subscription guard (can't re-subscribe to the same plan) | Done |
| Information disclosure | Raw card numbers touch the server/database | Server-generated `tok_*` tokens only; tokenisation, no raw card storage (PCI scope reduction) | Done |
| Elevation of privilege | Subscription abuse — refund fraud, shared accounts, free-tier abuse, chargebacks (brief §9) | See "Subscription abuse analysis" below | Analysed (R-PAY-3 through R-PAY-6) — no code changes; these are pattern-analysis writeups against a payment flow that has no real processor or refund endpoint to abuse yet |

### Subscription abuse analysis (brief §9)

This app has no real payment processor behind it — `lib/plans.ts` and `routes/payments.ts` simulate
tokenisation and webhook verification, but there is no actual money movement, no refund endpoint, and no
chargeback integration to exploit today. The analysis below is deliberately written as "what would need
controls if/when this became real," per the brief's instruction to analyse and threat-model this tier even
without a full implementation.

**Refund fraud.** No refund flow exists in this PoC (`routes/payments.ts` has no `DELETE`/refund route), so
there is nothing to abuse yet — but the brief asks for the analysis regardless of build status. The
realistic attack, once a refund path exists: a user subscribes, consumes the paid feature, then requests a
refund through the payment processor directly (bypassing the app) or via a support/chargeback channel,
keeping both the refunded money and the value already extracted. Recommended control for a real
implementation: tie refund eligibility to a time-boxed window (matches most processors' own dispute
windows) and to usage evidence (e.g., don't auto-approve a refund if the account has already consumed
the plan's premium features that billing period) — a policy decision Team 2 would own the threshold for,
Team 1 would enforce server-side at the refund endpoint.

**Shared-account abuse.** One paid subscription, credentials shared across many people, so N users get
paid-tier access for the price of one. This app's session model doesn't currently detect or limit
concurrent sessions per account (each login just creates another session row; `POST /auth/logout-all`
revokes all of them, but nothing looks at *how many* are concurrently active or flags an anomaly). A real
implementation would want: a concurrent-session cap enforced at login (reject/evict oldest on exceeding
N), or lighter-weight, geographically-implausible-concurrent-session detection surfaced to the account
holder as a security notice, not a hard block (avoids false-positives from legitimate multi-device use).
Neither is built here — this app's actual per-account session tracking is a real foundation to build it on
(`session` table keyed by `userId`), but the anomaly-detection logic itself does not exist.

**Free-tier abuse.** Repeatedly registering new accounts (disposable emails) to keep resetting a free
tier's limits. `POST /auth/register` had no registration-specific rate limit at all — fixed: a per-IP cap
(10/hour, matching the login rate limiter's per-IP pattern) now applies before the request body is even
parsed. Residual gap, stated honestly: this raises the cost of the attack (10 disposable accounts/hour per
IP instead of unlimited) but doesn't eliminate it — full closure needs email verification before free-tier
access is granted, which isn't implemented (this app has no email provider configured at all — see
`02_Authentication_Flow.md`'s password-reset flow for the same limitation). See R-PAY-5.

**Chargebacks.** A user pays, receives the paid-tier benefit, then disputes the charge with their card
issuer (a chargeback) instead of requesting a refund through the app — recovering the money while often
also keeping (at least temporarily) the access, and the merchant eating both the reversed charge and a
chargeback fee. This app's webhook handler (`lib/webhookSignature.ts`, `routes/payments.ts`) verifies
*payment-succeeded* events but has no explicit handler for a *chargeback/dispute* webhook event type — a
real payment processor (Stripe, etc.) sends a distinct event for this (`charge.dispute.created`). The
correct control is to handle that event by immediately revoking the account's paid-tier access
(fail-closed on dispute, not just on non-payment), which requires no new infrastructure beyond adding one
more webhook-event-type branch to the existing signed-webhook handler — not built in this PoC, but the
mechanism it would slot into already exists and is proven (R-PAY-6).

### Consent & deletion (brief §6 overlap with Team 2)

| Threat (STRIDE) | Scenario | Control | Status |
|---|---|---|---|
| Elevation of privilege | Biometric data stored/used without explicit opt-in | `POST /users/:id/enroll-face` rejects with 400 unless `consent: true` is sent | Done |
| Repudiation | User claims they never consented to data processing | `dataConsentGiven`/`dataConsentAt`, `biometricConsentGiven`/`biometricConsentAt` timestamped on the user record | Done |
| Tampering | Consent withdrawn but biometric data silently retained | `DELETE /users/:id/face` clears the descriptor and the consent flag together, atomically | Done |
| Information disclosure | Deleting a user silently breaks payment/audit history integrity | `payments.userId` uses `ON DELETE SET NULL` (history retained); `securityLogs.userId` is a plain, unconstrained column written once and never mutated (see R-LOG-3); uploads/passkeys `CASCADE` (nothing to retain) | Done |

## 2. Prioritised risk register

Likelihood/Impact: Low/Medium/High. Rating = combined severity.

| ID | Risk | Likelihood | Impact | Rating | Mitigation / Status |
|---|---|---|---|---|---|
| R-AUTH-1 | Biometric MFA implemented as a bypassable boolean rather than a signed challenge | Low | Critical | High | Mitigated — WebAuthn passkey is the authoritative factor; face match is an explicit, weaker fallback |
| R-AUTH-2 | Credential stuffing / brute force against login | Medium | High | High | Mitigated, atomic under concurrency after a fix — the original check-then-record implementation had a race (30-way concurrent flood: all 30 got through when the limit was 5); fixed by reserving atomically before any async work, re-verified (5 through, 25 rate-limited). Regression test: `scripts/src/security/load-test.ts` |
| R-AUTH-3 | User enumeration via login response timing | Medium | Medium | Medium | Mitigated — dummy-hash timing compensation, verified live |
| R-AUTH-4 | Password reset becomes an MFA bypass | Low | Critical | High | Mitigated — reset requires the same live biometric/passkey proof as login |
| R-AUTH-5 | Stolen/lost device with an unlocked, already-authenticated session remains valid for the full session lifetime | Medium (lost/stolen unlocked devices are a common occurrence) | High | Medium | Mitigated, two layers: `POST /auth/logout-all` (session revocation, reactive) plus a rolling idle-timeout (30 min) and a 12-hour absolute cap independent of activity |
| R-BIO-1 | No liveness/anti-spoofing check — a photo or video could pass face verification | Low (photo, incl. tilted/moved or held still) / Medium (video replay) | High | Medium — narrowed, not closed | Two spoofing vectors found and fixed: (1) a tilted/moved photo faked an EAR dip via perspective distortion — fixed by requiring face-position stability during the dip; (2) a photo held perfectly still also faked a dip via pure noise — fixed by requiring a genuine open→dip shape that recovers within 800ms. Residual risk: a video replay of the real user blinking, an engineered mask, or noise fast/stable/well-shaped enough to mimic the check are not defended against — a client-side behavioral heuristic, not a cryptographic liveness proof, which is why passkey (not face) is the primary factor |
| R-DP-1 | Biometric template or uploaded file stored in plaintext | Low | Critical | High | Mitigated — AES-256-GCM at rest for descriptors, uploads, payment tokens |
| R-DP-2 | No production-grade antivirus scanning of uploads | Medium | Medium | Medium | Accepted, documented limitation — signature-based heuristics only (EICAR/magic-bytes/SVG-script), not a ClamAV/cloud-AV integration |
| R-DP-3 | Single symmetric encryption key (`FILE_ENCRYPTION_KEY`) with no key-rotation or HSM/KMS | Low | Medium | Medium | Accepted, appropriate for PoC scope; a real deployment needs managed key rotation |
| R-AC-1 | User accesses another user's data or an admin-only endpoint via direct API call (IDOR / broken object-level authorisation) | Low | High | Medium | Mitigated — server-side ownership/role checks on every route, not just hidden UI |
| R-AC-2 | Application database connection uses a broad-privilege role instead of a scoped, least-privilege service account | Low (single trusted process) | Medium (a SQL-injection or RCE elsewhere would have more blast radius than necessary) | Low | Fixed — connects as `secureai_app`, granted exactly `SELECT`/`INSERT`/`UPDATE`/`DELETE` on this app's own tables. Verified: normal CRUD succeeded, `CREATE TABLE` was rejected |
| R-AC-3 | Account deletion completable by anyone with access to an already-unlocked session, not just the account owner re-proving it's them | Low | High (irreversible action) | Medium | Mitigated — self-deletion requires step-up re-authentication (current password, re-verified via `bcrypt.compare` immediately before the delete); admin-driven deletion of a different account is unaffected |
| R-SC-1 | CSRF on state-changing requests | Medium | High | High | Mitigated — double-submit-cookie CSRF |
| R-SC-2 | Overly permissive CORS | Low | High | Medium | Mitigated — explicit origin allowlist |
| R-LOG-1 | In-memory, single-process rate limiter and audit-log write queue won't scale correctly across multiple server instances | Low (for this PoC) | Medium | Low | Accepted, scope-appropriate for a single-instance demo; a real deployment needs a shared store (Redis) |
| R-LOG-2 | Audit log tampering goes undetected | Low | High | Medium | Mitigated — hash chain + `/security/logs/verify` |
| R-LOG-3 | Legitimate account deletion silently broke the hash chain — `security_logs.userId` had `ON DELETE SET NULL`, intended to preserve audit rows past account deletion, but SET NULL is an active mutation of a hash-chained row's content, executed after that row's hash was already computed. Deleting any user broke chain verification for their own historical log rows | Low likelihood of exploitation (not attacker-controlled), but certain to occur on every account deletion until fixed | High (undermines the tamper-evidence guarantee for a routine operation) | High | Fixed — `security_logs.userId` is no longer a foreign key; a hash-chained row's content must never change after being written, including via a cascading side effect from an unrelated table's deletion. `userEmail` (already stored redundantly per-row) remains the way to identify who an event was about after account deletion. Re-verified: deleted a user, re-ran the chain check — clean |
| R-PAY-1 | Unvalidated/unsigned webhook forges payment events | Low | High | Medium | Mitigated — HMAC signature + anti-replay timestamp |
| R-PAY-2 | Client-supplied price tampering | Low | High | Medium | Mitigated — server-canonical pricing lookup |
| R-PAY-3 | Refund fraud — refund granted without usage/time-window evidence, letting a user keep both the money and consumed value | N/A (no refund flow exists to abuse yet) | Medium | Low | Accepted analysis-only gap — see "Subscription abuse analysis." No refund endpoint exists in this PoC; recommendation stated for a real implementation (time-boxed + usage-gated refund eligibility) |
| R-PAY-4 | Shared-account abuse — one paid subscription used concurrently by many people | Medium (low technical barrier — just password sharing) | Low (per-incident revenue loss, not a security breach) | Low | Accepted gap — session infrastructure to build detection on exists (`session` table), but no concurrent-session cap or anomaly detection is implemented |
| R-PAY-5 | Free-tier abuse — disposable-email re-registration to repeatedly reset free-tier limits | Low (rate-limited; would still need email verification to fully close) | Low | Low | Mitigated — `POST /auth/register` now enforces a per-IP rate limit (10/hour, `checkAndRecordRequest("register:ip:...")` in `routes/auth.ts`), same pattern as the login IP cap. Residual gap: still no email-verification step, so one IP can still register up to 10 disposable accounts/hour — rate limiting raises the cost, doesn't eliminate the pattern entirely |
| R-PAY-6 | Chargeback used instead of refund — user disputes the charge with their card issuer while keeping paid-tier access, since no chargeback/dispute webhook handler revokes access | N/A (no real payment processor connected, so no real dispute webhook can fire) | Medium | Low | Accepted analysis-only gap — the signed-webhook mechanism this would extend already exists and is proven (`lib/webhookSignature.ts`); adding a `charge.dispute.created`-style handler is the recommended, low-effort extension for a real deployment |
| R-SUPPLY-1 | face-api.js model weights loaded from an unpinned, moving branch — a compromised upstream repo could swap in malicious weights | Low | Medium | Low | Mitigated — pinned to a specific commit hash |
| R-CONSENT-1 | Biometric data captured/retained without explicit, revocable consent | Low | High | Medium | Mitigated — consent required at enrollment, tied 1:1 to data retention (withdrawal deletes the data) |
| R-ML-1 | Model memorisation/leakage of training data | Medium (duplication is a realistic real-world data pattern, not a contrived edge case) | High (PII regurgitated verbatim to any user who guesses the right prompt) | High | Mitigated in the standalone PoC (`artifacts/ai-model/model_starter.py`) — sentence-level deduplication verified, by actually running both variants, to block a planted canary secret's extraction while leaving genuine repeated patterns intact. Not wired into the live app (which trains no model) |
| R-ML-2 | Prompt-injection / unsafe generative output (STRETCH) | N/A | N/A | N/A | Not applicable — the PoC model has no instruction-following or tool access to inject against; no generative-model/LLM chat integration exists anywhere in the codebase. See `03_Data_Flow.md` point 6 for what the equivalent controls would be if a future model were instruction-following |
| R-ML-3 | Data poisoning — attacker deliberately corrupts or mislabels training data to manipulate the resulting model | Low (requires controlling many accounts) | Medium | Low | Partially mitigated in the PoC — a per-user contribution cap (`MAX_DOCS_PER_USER`) is implemented in `consent_gate()`, but the demo's own synthetic corpus never gives any single user enough records to actually trigger it, so the cap is implemented, not proven, by the current run. Live app's closest analog (upload-time provenance/validation) documented in `03_Data_Flow.md` point 2 |
| R-ML-4 | Model-serving API abuse (unrestricted inference requests, model extraction) | N/A | N/A | N/A | Not applicable — no model-serving endpoint exists to abuse anywhere in this project, including the standalone PoC (it's a local script, not a hosted API). If one existed, `middlewares/requestRateLimit.ts` is a directly reusable pattern. See `03_Data_Flow.md` point 5 |
| R-ML-5 | Non-consented data reaches model training | Low | High (regulatory/ethical exposure, not just technical) | Medium | Mitigated in the PoC — `consent_gate()` rejects any record lacking a `consent_id` before training, demonstrated live against a planted non-consented record |
| R-ML-6 | A user's data can't be fully removed from a model that already learned from it | High (fundamental ML property, not a bug to fix) | Medium (mitigated by the model being a toy PoC retrained on demand, not a production system with persistent inference) | Medium | Accepted, honestly scoped per the brief's own instruction ("state its limitations," not "solve machine unlearning") — the PoC's `delete_user()` removes the user's records and retrains from the reduced corpus (demonstrated live), which is the correct mechanism for data the model hasn't been *served from* since; what a long-lived deployed model already memorised cannot be surgically erased without full retraining |
| R-ADV-1 | Adversarial input crafted against face-api.js's real, running inference (imperceptible perturbation, adversarial patch, or real-time pattern shown to the webcam) to force a false match or evade detection (STRETCH) | Low (requires ML expertise + physical/digital access to the camera feed) | High (would defeat the biometric factor entirely) | Medium | Accepted, documented gap — not mitigated. Different from R-BIO-1 (presentation attacks): liveness detection doesn't address adversarial perturbations at all. Defeating this class of attack is an open problem for biometric systems without dedicated anti-spoofing hardware. The mandatory passkey factor is the real backstop — this residual risk only matters for the face-scan fallback path |
| R-MOBILE-1 | Mobile client (`artifacts/mobile`) built but not verified against a real device — native passkey ceremonies specifically require Digital Asset Links domain verification this environment can't complete | Medium (untested code path) | Medium | Medium | Partial — architecture matches the web app's proven WebAuthn backend exactly (same endpoints, same JSON shapes), but the on-device passkey ceremony and Android/iOS-specific config are unverified. See `artifacts/mobile/README.md`. Certificate pinning: see R-MOBILE-2 |
| R-MOBILE-2 | No TLS certificate pinning on mobile — network trust relies on the OS default trust store, so a device with a malicious/compromised CA installed (rogue MDM profile, compromised root store) could MITM the app's traffic even over otherwise-valid TLS | Low (requires a compromised trust store, not just network position) | High (would expose session cookie, CSRF token, and all request/response bodies) | Medium | Mitigated for production builds — `network_security_config.xml` pins the production API domain's SPKI hash (`artifacts/mobile/android/app/src/main/res/xml/network_security_config.xml`), wired via `android:networkSecurityConfig` in the release manifest. Debug builds are deliberately exempted (`src/debug/AndroidManifest.xml`'s `usesCleartextTraffic`, needed for the local-dev HTTP tunnel — see `artifacts/mobile/src/config.ts`) — pinning a real cert against `localhost` would be meaningless since local dev has no TLS at all. The pin values are placeholders until a real production domain exists to compute them against (documented in the config file itself); iOS pinning is not implemented (no `ios/` project exists yet in this PoC) |
| R-AUTH-6 | Recovery-flow abuse modeled after the brief's SIM-swap example | Low (SIM-swap itself doesn't apply — no phone/SMS channel exists; the closest analog, email-inbox compromise, still can't complete a reset without live biometric/passkey proof) | High if it *could* complete (full account takeover) | Low | Mitigated by design — reset-token possession alone never suffices; completing a reset requires the same live MFA proof as login (see "Recovery-abuse analysis" above). Residual, accepted gap: no rate limit yet on `POST /auth/forgot-password` request volume per account |

**Open items requiring a decision, not yet closed:** every risk in this register now has either a real
mitigation or an explicitly accepted, appropriately-scoped limitation. R-BIO-1 moved from High/open to
Medium/narrowed once blink-based liveness detection landed — the residual risk (video replay, engineered
masks) is a stated limit of a client-side behavioral check, not a silently-ignored gap.

## 2.1 Standards mapping

Brief acceptance criterion #2: "maps each major risk to a recognised standard." Grouped by standard
rather than repeated per-row above:

| Standard | Applies to |
|---|---|
| **NIST SP 800-63** (authentication assurance) | R-AUTH-1 (AAL2-style multi-factor, signed challenge not a boolean), R-AUTH-2/3/4 (credential-stuffing/enumeration/recovery-as-bypass resistance), R-AUTH-5 (session lifetime/revocation), R-AUTH-6 (recovery-flow abuse) |
| **WebAuthn / FIDO2** | R-AUTH-1 (the passkey factor itself), R-SUPPLY-1 (model/credential-source integrity is the analogous concern for the face-matching path) |
| **OWASP Top 10** (web) | R-SC-1 (CSRF, A01/A05-adjacent), R-SC-2 (CORS misconfiguration), R-AC-1 (broken access control, A01), R-AC-3 (A07 identification/authentication failures — step-up re-auth for the one irreversible action) |
| **OWASP API Security Top 10** | R-AUTH-2 (API4:2023 Unrestricted Resource Consumption — rate limiting, including the concurrency-race fix), R-AC-1/R-AC-2 (API1/API5 broken object- and function-level authorisation), R-PAY-5 (API4:2023 — unrestricted registration is the same resource-consumption category as unrestricted login) |
| **OWASP Top 10 for LLM/AI Applications** | R-ML-1 through R-ML-6, R-ADV-1 — assessed against this standard's categories (training-data poisoning, sensitive-information disclosure/memorisation, model theft, supply chain, consent/deletion) with a live-run standalone PoC (`artifacts/ai-model/model_starter.py`) backing R-ML-1/3/5/6, and R-ML-2/4 correctly left "not applicable" with reasoning rather than skipped |
| **OWASP MASVS** | R-MOBILE-1/R-MOBILE-2 — see `06_Mobile_Security_MASVS_Checklist.md` for the full control-by-control walkthrough |
| **PCI-DSS** (payment card handling, referenced by brief §9) | R-PAY-1 through R-PAY-6 — tokenisation keeps raw card data out of scope (R-DP-1-adjacent for payment tokens specifically); R-PAY-3/4/5/6 are the subscription-abuse patterns PCI-DSS itself doesn't cover but the brief explicitly asks for |
| Data-protection general practice (encryption at rest/in transit, key management) | R-DP-1, R-DP-2, R-DP-3 |
| STRIDE | The method underlying every row in Section 1, not a single risk — listed here for completeness |

## 3. Security-testing approach (before a hypothetical launch)

What was actually done in this PoC, and what a real pre-launch process would add:

**Done in this PoC:**
- Manual, targeted verification of each control against a running server (not just code review) — e.g.,
  live timing comparison for R-AUTH-3, live 400/200 assertions for consent gating, live 413/401
  assertions for body-size scoping.
- Targeted unit tests for the pieces of logic risky enough to deserve them: the blink-detection state
  machine (`livenessDetection.ts` — 6 assertions covering the open→closed→open sequence, eyes-never-close,
  eyes-never-reopen, and hysteresis-noise cases), GIF/WebP metadata stripping (`imageSafety.ts` — 17
  assertions including deliberately malformed input), and the general rate limiter (`rateLimit.ts` — 7
  assertions covering per-key isolation and window expiry). These caught two real bugs before they
  shipped: the blink detector's phase wasn't resetting after a confirmed blink (would have silently
  re-confirmed liveness on every subsequent open-eye frame), and malformed WebP input with a trailing
  partial chunk was being silently truncated instead of failing open to the original bytes. Both were
  fixed and re-verified.
- `pnpm run typecheck` as a correctness gate on every change (Zod schemas shared between client/server
  via the OpenAPI spec catch shape mismatches at compile time).
- Direct database inspection to confirm encrypted columns hold ciphertext, never plaintext.
- Independent, from-scratch re-verification of the audit-log hash chain (a second implementation of the
  same verification algorithm, run directly against the database rather than through the app's own
  `verifyLogChain()` function) — this caught a leftover tampered test row (see `replit.md`).
- **SAST**: two layers. SonarLint is wired into the editor and has flagged real issues throughout
  development — unused variables left after refactors, a hardcoded IP literal, missing `type="button"` on
  form-adjacent buttons, nested ternaries hurting readability. On top of that, **Semgrep** (the actual
  named tool the brief asks for) now runs as a real CI gate — `.github/workflows/ci.yml`'s `semgrep-sast`
  job, `p/owasp-top-ten` + `p/typescript` + `p/react` community rulesets, `--error` so any finding fails
  the build, not just reports it. Honest caveat, consistent with this workflow's existing disclaimer below:
  this job's YAML follows Semgrep's documented container-action pattern correctly, but hasn't been run
  through an actual GitHub Actions runner, and — unlike every other command in this section — couldn't be
  smoke-tested locally either (Semgrep doesn't run natively on Windows without Docker/WSL, neither of
  which is available on this dev machine). Written and reasoned about, not yet observed to pass.
- **Dependency vulnerability scanning** (`pnpm audit`, 2026-08-15): 7 findings (5 high, 2 low), all in
  dev/build-time tooling, none in a runtime dependency that handles a real request:
  - `fast-uri`, `brace-expansion`, `js-yaml` — transitive dependencies of `orval` (the OpenAPI codegen
    tool), only invoked at `pnpm codegen` time.
  - `nanoid`, `esbuild` — transitive dependencies of Vite's dev server, not part of the production build.
  - `node-fetch` (two findings) — a transitive dependency of `face-api.js` → `@tensorflow/tfjs-core`,
    TensorFlow.js's Node.js fallback for environments without a native `fetch`. In an actual browser
    session (the only place face-api.js runs in this app), the browser's native `fetch` is used instead,
    so this code path is dead weight in the shipped bundle.
  - None of `express`, `drizzle-orm`, `bcryptjs`, `@simplewebauthn/server`, `pg`, or `connect-pg-simple` —
    the packages actually touching a live request — appear in the findings.
- **Concurrency load testing.** `scripts/src/security/load-test.ts` fires 30 simultaneous login attempts
  against one account (limit: 5/15min) and independently re-verifies the audit-log hash chain afterward.
  This caught R-AUTH-2's race condition — 30/30 got through before the fix, 5/30 after — and confirms the
  hash chain's in-memory write queue holds up under concurrent load. Kept as a regression test.
- **Scripted adversarial probes**, a partial substitute for a real DAST pass, not a replacement.
  `scripts/src/security/adversarial-probes.ts` fires attack payloads at the running app: SQL injection
  attempts against login (including a `DROP TABLE` payload, with a follow-up check that the table
  survived), CSRF with a missing/mismatched token, auth-bypass attempts against admin- and
  security_analyst-only routes, IDOR probes (one registered user trying to read/delete another's account
  by ID), and a stored-XSS payload through registration. 14/14 passed on the run that produced this
  document — meaning these specific payloads didn't work today, not that the app is broadly hardened
  against every technique a real tool or attacker would try.
- **CI pipeline**, written and its components individually proven, not yet run through an actual CI
  system. `.github/workflows/ci.yml` chains: typecheck + `pnpm audit --audit-level=critical`
  (`package.json`'s `ci` script), then a live-server job (fresh Postgres, non-interactive
  `drizzle-kit push --force`) that runs the load test and adversarial probes above against a freshly-built
  server. Every individual command has been run for real against this repo; the assembled workflow has
  not been executed by an actual GitHub Actions runner.

**What a real pre-launch process would still add:**

- Actually running the CI workflow through a GitHub Actions runner — the YAML is written and every piece
  it calls is proven, but that's not the same as a runner having executed it and gone green. This applies
  with extra force to the `semgrep-sast` job specifically: unlike the rest of this workflow, it couldn't
  even be smoke-tested locally in this environment (no Docker/WSL on this Windows dev machine).
- A real DAST pass (OWASP ZAP/Burp against a running deployment) — the adversarial-probe suite below is a
  real step toward this, not a full substitute; it's five hand-picked attack categories, not the broad
  automated crawl-and-attack coverage a dedicated DAST tool provides.
- Broader automated test coverage beyond the specific risky logic and the adversarial-probe scenarios
  above — most routes still have no dedicated test coverage, only the manual live-HTTP checks and probes
  noted above.
- A real penetration test / OWASP ZAP or Burp Suite pass against a staging deployment. The adversarial
  probes above are a real step in this direction, but they're five specific attack categories hand-picked
  for this app, not the broad, automated coverage a dedicated tool provides.
