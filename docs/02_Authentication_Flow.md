# Authentication Flow (with Biometric MFA) — SecureAI

Addresses the brief's explicit warning: _"never trust a 'biometric OK' message coming from the app —
the biometric should unlock a secret key on the device that signs a challenge from your server."_

## Registration + enrollment

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant A as API server
    participant DB as PostgreSQL

    U->>A: POST /auth/register {email, name, password, dataConsent: true}
    A->>A: Reject with 400 if dataConsent != true
    A->>A: bcrypt.hash(password, 12)
    A->>DB: INSERT users (dataConsentGiven=true, dataConsentAt=now)
    A-->>U: 201 {user, session cookie}

    Note over U,A: Every subsequent protected request is blocked by<br/>requireMfaEnrolled until AT LEAST ONE step below is done.

    U->>U: Capture face via webcam (face-api.js, client-side only)
    U->>A: POST /users/:id/enroll-face {descriptor[128], consent: true}
    A->>A: Reject with 400 if consent != true
    A->>A: AES-256-GCM encrypt descriptor
    A->>DB: UPDATE users SET faceDescriptorCiphertext=..., faceEnrolled=true,<br/>biometricConsentGiven=true
    A-->>U: 200 {user}

    U->>A: WebAuthn registration ceremony (navigator.credentials.create)
    Note over U,A: Device biometric/PIN unlocks a private key ON THE DEVICE.<br/>Only the PUBLIC key + attestation ever reach the server.
    A->>DB: INSERT passkeys (publicKey, counter, deviceName)
    A-->>U: 200 — requireMfaEnrolled now passes (faceEnrolled OR passkey count > 0)
```

## Login (two-step, MFA-enforced)

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant A as API server
    participant DB as PostgreSQL

    U->>A: POST /auth/login {email, password}
    A->>A: checkAndRecordRequest() — atomic reservation against<br/>per-account (5/15min) and per-IP (20/15min) limits, BEFORE any DB/bcrypt work
    alt over the limit
        A-->>U: 429 Too many attempts
    else account not found
        A->>A: bcrypt.compare(password, DUMMY_PASSWORD_HASH)<br/>(burns identical time — no user-enumeration via timing)
        A-->>U: 401 "Invalid email or password"
    else account found
        A->>DB: SELECT user; bcrypt.compare(password, user.passwordHash)
        alt wrong password
            A-->>U: 401 "Invalid email or password" (attempt stays counted)
        else correct password
            A->>A: Create pendingUserId + tempToken in session<br/>(short-lived — NOT a full session yet)
            A-->>U: 200 {requiresFaceVerification: true, faceAvailable, passkeyAvailable, tempToken}
        end
    end

    Note over U,A: Step 2 — the actual second factor. Password alone never<br/>grants a full session.

    alt User completes with passkey (preferred)
        U->>A: GET /passkeys/login-options (challenge issued, tied to tempToken)
        A-->>U: WebAuthn challenge
        U->>U: navigator.credentials.get() — device biometric/PIN unlocks<br/>the on-device private key, which SIGNS the challenge
        U->>A: POST /passkeys/login-verify {signed assertion}
        A->>A: Verify signature against stored PUBLIC key<br/>(this signature IS the second factor — not a boolean)
        A->>A: Upgrade session: req.session.userId = user.id; clear pending state
        A-->>U: 200 {user} — full session established
    else User completes with face scan (fallback)
        U->>U: Blink-based liveness check (client-side EAR tracking over<br/>live frames) must confirm before capture proceeds
        U->>U: Capture live descriptor via webcam
        U->>A: POST /auth/face-verify {tempToken, descriptor[128]}
        A->>DB: SELECT + decrypt stored descriptor
        A->>A: Euclidean distance(stored, live) < 0.6 ?
        alt match
            A->>A: Upgrade session, clear pending state
            A-->>U: 200 {user} — full session established
        else no match / MFA_MAX_ATTEMPTS(3) exceeded / TTL(2min) expired
            A-->>U: 401 — pending session destroyed, must restart from step 1
        end
    end
```

## Mobile: fingerprint or face (added 2026-10-06)

The phone app asks which second step to use (Android since 2026-10-06, iPhone since 2026-10-07).
Android can't be asked for face rather than fingerprint (`BiometricPrompt` uses whichever strong
biometric the phone has), and many phones' face unlock is Class 1, which apps can't use at all, so the
app's Face option is the website's own face check, shown in a WebView. On an iPhone the device key opens
with Face ID or Touch ID, so the same option is called "Face scan" there. Both options use the same
endpoints as the website.

```mermaid
sequenceDiagram
    participant U as Person
    participant App as Phone app
    participant W as WebView (the site's /app-face page)
    participant A as API server

    U->>App: Email + password
    App->>A: POST /auth/login
    A-->>App: 200 {requiresFaceVerification, faceAvailable, passkeyAvailable, tempToken}
    App->>U: Choose: Fingerprint (a key exists) or Face (a face is enrolled)

    alt Fingerprint (listed first, recommended: the brief's design)
        App->>A: POST /auth/biometric-key/login-options
        A-->>App: challenge
        U->>App: Fingerprint (Android) or Face ID / Touch ID (iPhone) unlocks the device key, which SIGNS the challenge
        App->>A: POST /auth/biometric-key/login-verify {signature}
    else Face (the website's face check)
        App->>U: Ask for the camera permission (first time only)
        App->>W: Open https://<site>/app-face, locked to the site's origin
        W->>W: Same face-api.js models and blink check as the website
        W-->>App: postMessage {type: "face-descriptor", descriptor[128]}
        App->>App: Accept only from the site's origin, only 128 finite numbers
        App->>A: POST /auth/face-verify {tempToken, descriptor} over the app's pinned connection
        A->>A: Same comparison, 3 attempts and 2-minute window as the website
    end
    A-->>App: 200 {user}: full session
```

- **Set-up.** A new account chooses one on the set-up screen; face needs the same express biometric
  consent as the website, as an unticked box. Privacy & Your Data adds the other later, or removes the
  face (withdrawing consent deletes the template).
- **The page makes no API call.** On Android the WebView shares the app's cookies, so the page is
  rendered outside the website's sign-in provider; a request from it could otherwise disturb the app's
  half-finished sign-in. The app sends the descriptor itself. The WebView isn't incognito, because on
  Android that deletes every cookie, the app's own session included.
- **iPhone** (2026-10-07): the device key opens with Face ID or Touch ID, and the camera option is
  called "Face scan". iOS asks for the camera itself the first time the page opens it, and WebKit gives
  the camera only to the site's own page.
- The face option carries R-AUTH-1's gap (a descriptor, not a signature); the WebView's own risks are
  R-MOBILE-5 (`04_Threat_Model_Risk_Assessment.md`).

## Why the passkey path is the "real" second factor — and why face-verify exists anyway

Compliance note, decided 2026-08-28: face-verify is a deliberate, documented departure from the
brief's device-native-only biometric scope (see `04_Threat_Model_Risk_Assessment.md` §0, "Deliberate,
final deviation," for the full reasoning). It was weighed against migrating to passkey-only MFA and kept
— this section is that decision's technical detail, not an open question.

The face-descriptor path is a legitimate control (a live camera capture matched against an encrypted,
server-stored template), but by itself it is exactly the pattern the brief warns against: a comparison
result that a compromised or spoofed client could claim to have passed. WebAuthn closes that gap —
the server never sees the private key or the raw biometric, only a cryptographic signature over a
server-issued, single-use challenge. That signature cannot be produced without the device-held key,
regardless of what the client claims. This is why:

- On web and mobile, either factor satisfies MFA (`requireMfaEnrolled` accepts face OR passkey — a person sets up one, and someone without a camera, or whom the face model fails, may never have the other, so requiring both would lock them out permanently). Both can still be enrolled for extra assurance.
- Passkey is offered **first** at login/reset; face scan is an explicit, clearly-labelled fallback.
- Face scan now also requires a blink-based liveness check before a descriptor is captured or
  auto-submitted (`lib/livenessDetection.ts`) — defends against the most obvious spoof (a static photo
  held to the webcam) but is explicitly a client-side behavioral check, not a cryptographic proof, unlike
  the passkey signature. See `04_Threat_Model_Risk_Assessment.md` (R-BIO-1) for the honest boundary.
- The password-reset flow requires the _same_ proof as login — a reset link alone is never sufficient,
  closing the classic "account recovery becomes the MFA bypass" failure mode.

## Session model

- `express-session`, PostgreSQL-backed (`connect-pg-simple`), `httpOnly`, `secure` in production,
  `sameSite: lax` in every environment (production used `none` until 2026-09-27, left from an earlier
  deployment with the web app and API on different domains; R-SC-5).
- The `pendingUserId`/`tempToken` pair created after step 1 is **not** a valid session — no protected
  route accepts it. Only after step 2 succeeds is `session.userId` set.
- `MFA_CHALLENGE_TTL_MS` (2 minutes) and `MFA_MAX_ATTEMPTS` (3) bound how long/how many times a pending
  challenge can be attempted before the pending session is destroyed outright.
- **Revocation ("logout everywhere")**: `POST /auth/logout-all` deletes every persisted row in the
  `session` table belonging to the account (matched via the session's stored `userId`), not just the
  session making the request. Mitigates the brief's "device theft while unlocked" scenario (§8) — a lost
  or stolen device with a live session can be locked out from any other device, without needing the
  stolen device itself or a password change. Reactive, not preventive.
- **Idle timeout + absolute cap** (`lib/sessionPolicy.ts`): the cookie is a 30-minute rolling idle
  timeout (`rolling: true`), so an abandoned session expires on its own, plus an independent 12-hour
  absolute cap checked on every request, so a session an attacker keeps "warm" with their own traffic
  still expires. Together with logout-all this covers both the "owner notices" and "nobody notices"
  cases (see `04_Threat_Model_Risk_Assessment.md`, R-AUTH-5).
- **Step-up re-authentication**: self-account deletion requires the current password re-entered and
  verified server-side immediately before the delete — an unlocked session alone isn't enough for the one
  irreversible action (R-AC-3).

## Design trade-off: password + biometric, not passkey-alone (brief §7)

The brief explicitly flags an alternative worth considering: "a passkey with user verification can itself
be multi-factor in a single gesture (possession + inherence), potentially replacing the password," and
asks for the trade-off to be documented. This app chose the more conservative design — password (first
factor) + device-native biometric/passkey (second factor) — deliberately, not by default. Reasoning:

A passkey-alone design would look like this — a WebAuthn passkey with `userVerification: "required"`
already combines two of the three classic factor categories in one user gesture: _possession_ of the
enrolled device (the private key never leaves it) and _inherence_ (the biometric gates release of that
key). NIST SP 800-63B recognizes this as a legitimate multi-factor authenticator. Under this design,
registration and login would both collapse to a single passkey ceremony — no separate password field, no
two-step login flow, no password-hash storage or reset-token infrastructure at all.

Why this app kept the password anyway:

- A third, independent factor category: password adds _knowledge_ on top of _possession + inherence_.
  If a device is lost, stolen, or its Keystore/Secure Enclave is somehow compromised, a passkey-alone
  design has nothing left to fall back on — the single gesture that grants access is also the single
  point of failure. This app's password remains a genuinely separate secret an attacker needs even after
  fully compromising the enrolled device's biometric hardware (a much higher bar than software
  compromise, but not zero — e.g. a coerced unlock).
- Device-loss continuity: a brand-new, unenrolled device can still get the user to "I know the
  password" before any device-specific ceremony — useful for the recovery/re-enrollment flow
  (`02` above), where the password is what lets `POST /auth/forgot-password` + the reset-token flow work
  at all as an _entry point_, even though the reset still can't _complete_ without the live biometric/
  passkey proof (see `04_Threat_Model_Risk_Assessment.md`'s recovery-abuse analysis, R-AUTH-6).
- Matches the brief's own stated default: Section 2 decision #1 and Tier 1 §1 both specify
  "device-native biometric authentication as a **second factor** on top of the password" as the confirmed
  scope decision, not an open design choice — this app implements that decision as written, while still
  documenting the passkey-alone alternative here because the brief separately asks for the trade-off to be
  reasoned about, not assumed away.

The cost of this choice, stated honestly: two-step login instead of one gesture; password-reset attack
surface and infrastructure that a passkey-alone design wouldn't need at all; users must remember a
password in addition to owning an enrolled device. The conservative choice is not free — it's a real
trade of convenience and reduced attack surface (passkey-alone) against defense-in-depth via an
independent factor category (password + biometric), and this app takes the latter deliberately.

## Design decision: no device-passcode MFA fallback (brief §7)

The brief's recovery-and-fallback item asks for "a safe local fallback (device passcode)" alongside the
lost-device recovery path. This app's mobile client makes a deliberate, documented choice **not** to offer
one: `ReactNativeBiometrics` is constructed with `allowDeviceCredentials: false`
(`artifacts/mobile/src/lib/biometricKey.ts`), meaning only a real fingerprint/face scan can unlock the
device-bound signing key — a PIN/pattern/device-passcode can never substitute for it.

Why, given the brief explicitly asks for a passcode fallback: the entire point of this app's MFA
design is that the second factor is _inherence_ (something you are), layered on top of the password's
_knowledge_ factor. A device passcode is itself a _knowledge_ factor (something you know) — allowing it to
satisfy the "biometric" second factor would silently collapse the design back to knowledge-plus-knowledge
(password + device PIN), which is not meaningfully different from just having a longer password, and
defeats the reason a second factor category was required in the first place. This mirrors the exact
reasoning in the trade-off above: factor-category independence is the point, and a passcode fallback would
quietly erase it for exactly the accounts that ever needed the fallback.

This is not the same as having no fallback at all: the brief's actual underlying concern — a user
being permanently locked out — is covered a different way: the password-reset flow (`02` above) is a
complete, working recovery path that doesn't depend on the original device's biometric sensor at all,
only on live re-proof via a _newly enrolled_ device's biometric or passkey. A user who can't use their
enrolled device's biometric sensor (broken sensor, lost device) recovers via password + re-enrolling a
working device, never via a passcode standing in for the biometric on the same device. Documented here as
a deliberate departure from the brief's literal wording, in service of the brief's own stated intent
(the second factor "must gate a cryptographic operation... never be trusted as a client-reported success
boolean") — a passcode-gated key release is still cryptographically real, but factor-category-wise it
undermines the two-factor guarantee, which is the more important property to preserve.
