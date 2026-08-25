# Mobile Security — OWASP MASVS Checklist Walkthrough

Team 1: Technical Security. Brief §4 (mobile client hardening) and §7 asks this be mapped to
**OWASP MASVS** control-by-control, not just described in prose. Assessed against MASVS v2's eight
categories, scoped to what's actually built in `artifacts/mobile` (Expo/React Native, Android target —
see `04_Threat_Model_Risk_Assessment.md` §0 for why no `ios/` project exists yet in this PoC).

Status legend: **Met** (control satisfied, code cited) · **Partial** (some coverage, gap stated) ·
**N/A** (control doesn't apply to this app's actual design) · **Gap** (not implemented, accepted for PoC
scope).

## MASVS-STORAGE — sensitive data at rest on the device

| Control | Status | Detail |
|---|---|---|
| No sensitive data in shared/world-readable storage | Met | No `AsyncStorage`, no plain-file writes of session/credential data anywhere in `artifacts/mobile/src` — verified by grep, not just design intent |
| Session/auth tokens stored via a secure mechanism | Met | Session lives entirely in the native cookie jar (`@react-native-cookies/cookies`, backed by the OS's own HTTP stack), the same mechanism a mobile browser uses — never touches app-controlled storage |
| Cryptographic keys stored in hardware-backed storage, not app files | Met | The biometric signing key lives in Android Keystore (`react-native-biometrics`), hardware-backed on any device with StrongBox/TEE support — the app never sees the private key material, only signature output |
| No sensitive data in logs | Met | No `console.log`/logging of descriptors, tokens, or passwords in the mobile client; mirrors the same audit already done server-side for `logEvent` call sites (`04`, Logging section) |

## MASVS-CRYPTO — cryptography

| Control | Status | Detail |
|---|---|---|
| No custom/home-rolled cryptographic primitives on-device | Met | The app performs no cryptography itself — key generation and signing happen inside Android Keystore via `react-native-biometrics`'s native bridge, not in JS |
| Server-side crypto reused, not re-implemented per-platform | Met | Mobile talks to the same `/auth`, `/passkeys`-equivalent (`biometricKey.ts`/`routes/biometricKey.ts`), and payment/upload endpoints as web — one AES-256-GCM/bcrypt/HMAC implementation server-side, not a parallel mobile-specific one |

## MASVS-AUTH — authentication & session management

| Control | Status | Detail |
|---|---|---|
| Biometric gates a cryptographic operation, not a boolean | Met | Same design as web's WebAuthn path — `BiometricPrompt` unlocks the Keystore key that signs a server-issued challenge (`biometricKey.ts`); the server verifies the signature, never a client-reported "success" flag |
| Device-passcode fallback does not silently satisfy the biometric factor | Met (by deliberate design) | `allowDeviceCredentials: false` — see `02_Authentication_Flow.md`, "Design decision: no device-passcode MFA fallback" |
| Session has idle timeout and absolute lifetime | Met | Same `lib/sessionPolicy.ts` enforcement as web — the session cookie is shared infrastructure, not a mobile-specific (weaker) implementation |
| Step-up re-authentication for high-risk/irreversible actions | Met | `DELETE /users/:id` password re-verification applies identically — mobile calls the same endpoint, no bypass path exists |
| Logout-everywhere reachable from mobile | Met | Mobile calls the same `POST /auth/logout-all` as web |

## MASVS-NETWORK — network communication

| Control | Status | Detail |
|---|---|---|
| All traffic over TLS in production | Met (production) / N/A (local dev) | Release builds have no cleartext exception (only `src/debug/AndroidManifest.xml` sets `usesCleartextTraffic`, scoped to debug builds only, needed for the local `adb reverse` HTTP tunnel — see `artifacts/mobile/src/config.ts`) |
| Certificate pinning | Partial | `network_security_config.xml` pins the production API domain's SPKI hash, wired into the release manifest — but the pin values are placeholders pending a real deployed domain (see `04`, R-MOBILE-2). Mechanism is real and correctly wired; the actual pin hashes are not yet the real production cert's |
| CSRF/session protection carries over from web | Met | Same double-submit CSRF cookie mechanism, read via `@react-native-cookies/cookies` instead of `document.cookie` — not a weaker mobile-specific auth model |
| CORS/Origin allowlisting applies to mobile's declared origin | Met | `APP_ORIGIN` sent as the `Origin` header; backend's `allowedOrigins.ts` accepts local-dev origins explicitly, would need the real production app's origin added for a real deployment |

## MASVS-PLATFORM — platform interaction

| Control | Status | Detail |
|---|---|---|
| Uses platform biometric API correctly (not a custom camera-based check) | Met | `react-native-biometrics` wraps Android's own `BiometricPrompt` — no custom face/fingerprint capture logic exists on mobile (unlike the web app's face-api.js path, which is a deliberate, documented departure — see `04`) |
| Minimal permissions requested | Met | `AndroidManifest.xml` requests only `INTERNET`, `USE_BIOMETRIC`/`USE_FINGERPRINT`, `VIBRATE`, and storage permissions for the upload/document-picker feature — no camera, contacts, location, or SMS permissions requested anywhere |
| Deep links validated, not blindly trusted | Partial | `secureai://` and `com.secureai.mobile://` custom schemes are registered for the device-linking flow (`deviceLink.ts`) but the intent-filter itself doesn't independently verify the link's origin beyond what the app-level linking code checks — acceptable for this PoC's scope (the link only carries a short-lived, single-use device-link code that's re-validated server-side regardless of how it was delivered) |

## MASVS-CODE — code quality & build

| Control | Status | Detail |
|---|---|---|
| Typechecked build | Met | `pnpm --filter mobile run typecheck` (`tsc -p tsconfig.json --noEmit`) — same discipline as every other package in this monorepo |
| Dependency vulnerability scanning covers the mobile package too | Met | `pnpm audit` runs workspace-wide, `artifacts/mobile/package.json` is part of the same pnpm workspace as everything else audited in `04`, Section 3 |
| Debug/release build variants correctly separated | Met | Standard Expo/RN pattern — `src/debug/AndroidManifest.xml` overlays apply only to debug builds, verified by inspecting the actual manifest merge inputs, not just assuming the template is correct |

## MASVS-RESILIENCE — anti-tampering / anti-reverse-engineering

| Control | Status | Detail |
|---|---|---|
| Root/jailbreak detection | Gap | Not implemented — a rooted device could have a compromised Keystore/TEE, undermining the hardware-backed key guarantee the whole biometric design rests on. Accepted PoC-scope gap; a real deployment would want `react-native-device-info`'s root-detection or Play Integrity API |
| Code obfuscation / anti-tampering | Gap | Standard Expo/Metro build, no ProGuard/R8 obfuscation config beyond Android's own defaults (`proguard-rules.pro` exists but is the stock Expo template, not app-specific hardening rules) |
| Anti-debugging | Gap | Not implemented — accepted, consistent with this being a PoC, not a production release build |

## MASVS-PRIVACY — privacy

| Control | Status | Detail |
|---|---|---|
| No biometric data leaves the device | Met | Same device-native guarantee as the brief's core scope decision — the biometric never reaches this app's server at all, mobile or web (the Keystore path is *more* conservative than the web app's face-descriptor path, which does store an encrypted template server-side — see `04`'s documented scope deviation) |
| Data minimization in what's requested/stored | Met | No location, contacts, or media-library-wide access requested; upload feature uses `expo-document-picker`'s scoped file picker, not broad storage access |

## Summary

| Category | Met | Partial | Gap | N/A |
|---|---|---|---|---|
| STORAGE | 4 | 0 | 0 | 0 |
| CRYPTO | 2 | 0 | 0 | 0 |
| AUTH | 5 | 0 | 0 | 0 |
| NETWORK | 3 | 1 | 0 | 0 |
| PLATFORM | 2 | 1 | 0 | 0 |
| CODE | 3 | 0 | 0 | 0 |
| RESILIENCE | 0 | 0 | 3 | 0 |
| PRIVACY | 2 | 0 | 0 | 0 |

The RESILIENCE category is the honest weak point — anti-tampering/root-detection is the one MASVS
category with zero coverage, consistent with this being a PoC rather than a hardened release build. Every
other category has at least majority coverage, with the two Partial items (cert-pin values, deep-link
origin validation) being "mechanism built, one input still placeholder/light" rather than "not attempted."
