# Authentication Flow (with Biometric MFA) — SecureAI

Addresses the brief's explicit warning: *"never trust a 'biometric OK' message coming from the app —
the biometric should unlock a secret key on the device that signs a challenge from your server."*

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

## Why the passkey path is the "real" second factor

The face-descriptor path is a legitimate control (a live camera capture matched against an encrypted,
server-stored template), but by itself it is exactly the pattern the brief warns against: a comparison
result that a compromised or spoofed client could claim to have passed. WebAuthn closes that gap —
the server never sees the private key or the raw biometric, only a cryptographic signature over a
server-issued, single-use challenge. That signature cannot be produced without the device-held key,
regardless of what the client claims. This is why:

- On web, either factor satisfies MFA (`requireMfaEnrolled` accepts face OR passkey — a passkey-only mobile account has no way to enroll a face factor, so requiring both would lock it out permanently). Both can still be enrolled for extra assurance.
- Passkey is offered **first** at login/reset; face scan is an explicit, clearly-labelled fallback.
- Face scan now also requires a blink-based liveness check before a descriptor is captured or
  auto-submitted (`lib/livenessDetection.ts`) — defends against the most obvious spoof (a static photo
  held to the webcam) but is explicitly a client-side behavioral check, not a cryptographic proof, unlike
  the passkey signature. See `04_Threat_Model_Risk_Assessment.md` (R-BIO-1) for the honest boundary.
- The password-reset flow requires the *same* proof as login — a reset link alone is never sufficient,
  closing the classic "account recovery becomes the MFA bypass" failure mode.

## Session model

- `express-session`, PostgreSQL-backed (`connect-pg-simple`), `httpOnly`, `secure` in production,
  `sameSite: lax`.
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

**What a passkey-alone design would look like.** A WebAuthn passkey with `userVerification: "required"`
already combines two of the three classic factor categories in one user gesture: *possession* of the
enrolled device (the private key never leaves it) and *inherence* (the biometric gates release of that
key). NIST SP 800-63B recognizes this as a legitimate multi-factor authenticator. Under this design,
registration and login would both collapse to a single passkey ceremony — no separate password field, no
two-step login flow, no password-hash storage or reset-token infrastructure at all.

**Why this app kept the password anyway:**

- **A third, independent factor category.** Password adds *knowledge* on top of *possession + inherence*.
  If a device is lost, stolen, or its Keystore/Secure Enclave is somehow compromised, a passkey-alone
  design has nothing left to fall back on — the single gesture that grants access is also the single
  point of failure. This app's password remains a genuinely separate secret an attacker needs even after
  fully compromising the enrolled device's biometric hardware (a much higher bar than software
  compromise, but not zero — e.g. a coerced unlock).
- **Device-loss continuity.** A brand-new, unenrolled device can still get the user to "I know the
  password" before any device-specific ceremony — useful for the recovery/re-enrollment flow
  (`02` above), where the password is what lets `POST /auth/forgot-password` + the reset-token flow work
  at all as an *entry point*, even though the reset still can't *complete* without the live biometric/
  passkey proof (see `04_Threat_Model_Risk_Assessment.md`'s recovery-abuse analysis, R-AUTH-6).
- **Matches the brief's own stated default.** Section 2 decision #1 and Tier 1 §1 both specify
  "device-native biometric authentication as a **second factor** on top of the password" as the confirmed
  scope decision, not an open design choice — this app implements that decision as written, while still
  documenting the passkey-alone alternative here because the brief separately asks for the trade-off to be
  reasoned about, not assumed away.

**The cost of this choice, stated honestly:** two-step login instead of one gesture; password-reset attack
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

**Why, given the brief explicitly asks for a passcode fallback:** the entire point of this app's MFA
design is that the second factor is *inherence* (something you are), layered on top of the password's
*knowledge* factor. A device passcode is itself a *knowledge* factor (something you know) — allowing it to
satisfy the "biometric" second factor would silently collapse the design back to knowledge-plus-knowledge
(password + device PIN), which is not meaningfully different from just having a longer password, and
defeats the reason a second factor category was required in the first place. This mirrors the exact
reasoning in the trade-off above: factor-category independence is the point, and a passcode fallback would
quietly erase it for exactly the accounts that ever needed the fallback.

**This is not the same as having no fallback at all.** The brief's actual underlying concern — a user
being permanently locked out — is covered a different way: the password-reset flow (`02` above) is a
complete, working recovery path that doesn't depend on the original device's biometric sensor at all,
only on live re-proof via a *newly enrolled* device's biometric or passkey. A user who can't use their
enrolled device's biometric sensor (broken sensor, lost device) recovers via password + re-enrolling a
working device, never via a passcode standing in for the biometric on the same device. Documented here as
a deliberate departure from the brief's literal wording, in service of the brief's own stated intent
(the second factor "must gate a cryptographic operation... never be trusted as a client-reported success
boolean") — a passcode-gated key release is still cryptographically real, but factor-category-wise it
undermines the two-factor guarantee, which is the more important property to preserve.
