# SecureAI Mobile

**iOS:** the native iOS project was added on 2026-09-29 (PR #18, Sadhakshi) and runs the same code. On
2026-10-07 it caught up with Android:

- certificate pinning (`NSPinnedDomains` in `ios/SecureAI/Info.plist`);
- a device key that adding or removing a face or fingerprint switches off
  (`patches/react-native-biometrics@3.0.1.patch`);
- no plain HTTP to local addresses in Release builds (a build phase);
- the face scan option.

What is still weaker (the key isn't in the Secure Enclave) is in `docs/04` R-MOBILE-4 and `docs/06`.

Building it needs macOS with Xcode 16 and CocoaPods: `pnpm install` here, then `pod install` in `ios/`.
Because the team works on Windows, `.github/workflows/ios.yml` builds it on a GitHub-hosted Mac for every
change under `artifacts/mobile/`. It runs the app in the Simulator against the live API and keeps two
files in the run's `ios-simulator-build` artifact:

- the built app: install it on a Mac's Simulator with `xcrun simctl install booted SecureAI.app`;
- the `Podfile.lock` that `pod install` produced: commit it when it differs from the one here.

`ios/` is maintained by hand like `android/`: `expo prebuild --clean` would drop the pins and the build
phase.

Device-native biometric MFA on Android/iOS, following the brief's actual design (decision #1):
password (first factor) + a device biometric (second factor) that unlocks a key held in the device's
secure storage (Android Keystore; the Keychain on iOS), which signs a server-issued challenge.

**Fingerprint or face (Android, added 2026-10-06).** After the password the app asks which to use. Android
can't be asked for face rather than fingerprint, and many phones' face unlock is too weak for apps to use,
so the Face option is the website's own face check: `src/components/FaceCapture.tsx` opens the site's
`/app-face` page in a WebView locked to the site's origin, and sends the descriptor the page posts back to
`/auth/face-verify` or `/users/:id/enroll-face`. That carries the web app's documented departure from
decision #1 (docs/04 R-AUTH-1; the WebView's risks are R-MOBILE-5), so fingerprint is listed first and
marked recommended. The camera permission is asked only when someone chooses face. Locally, set
`EXPO_PUBLIC_WEB_BASE_URL` to the Vite site (`http://localhost:5173`, with `adb reverse tcp:5173 tcp:5173`);
a release build derives it from `EXPO_PUBLIC_API_BASE_URL`. The iPhone app offers it too since 2026-10-07, as
"Face scan" next to Face ID or Touch ID; iOS asks for the camera itself.

**This is not WebAuthn/passkeys — it's Android Keystore + `BiometricPrompt` directly**, talking to a
dedicated `/auth/biometric-key/*` route family (`artifacts/api-server/src/routes/biometricKey.ts`), not
the web app's `/auth/passkey/*` WebAuthn endpoints. See "Why this uses Android Keystore instead of
WebAuthn passkeys" below for why — short version: a full WebAuthn ceremony has a hard Digital Asset
Links domain-trust requirement that no local dev tunnel can ever satisfy (confirmed on real hardware,
not just an emulator limitation), so mobile was switched to a mechanism with no such requirement while
keeping the same actual security property the brief asks for: _a biometric unlocks a device-held key
that signs a server challenge; the biometric itself never leaves the device or reaches the server._

- **Enrollment**: `src/lib/biometricKey.ts`'s `enrollBiometricKey()` generates an RSA keypair in Android
  Keystore (`react-native-biometrics`' `createKeys()`), then immediately proves possession by signing a
  server challenge with `createSignature()` — which is what actually triggers the OS `BiometricPrompt`
  sheet — before sending the public key to `/auth/biometric-key/register`.
- **Login**: `loginWithBiometricKey()` requests a challenge from `/auth/biometric-key/login-options`,
  signs it (`BiometricPrompt` again), and POSTs the signature to `/auth/biometric-key/login-verify`,
  which does a raw `crypto.verify('RSA-SHA256', ...)` against the stored public key — no WebAuthn
  library involved on either side.
- **Backend storage**: a new `biometric_keys` table (`lib/db/src/schema/biometricKeys.ts`), separate
  from the web app's `passkeys` table — mobile never touches `passkeys`/`passkeysRouter`, both factors
  just satisfy the same OR'd `requireMfaEnrolled` check.
- **API field-name reuse, deliberately**: the `passkeyEnrolled`/`passkeyAvailable` fields in the shared
  API response shapes were _not_ renamed or extended — they were repurposed to mean "has any device-
  bound key, WebAuthn passkey or biometric key" (see `mapUser()` in `routes/auth.ts`). This avoided
  touching `lib/api-spec/openapi.yaml` or the generated `@workspace/api-zod` schemas at all; only what
  populates those fields server-side changed. `src/screens/LoginScreen.tsx` and `DashboardScreen.tsx`
  read `passkeyEnrolled`/`passkeyAvailable` for this reason — it's not a leftover from the old approach.

## Cross-device linking (accounts enrolled elsewhere, e.g. web)

A device biometric key is per-device — Android Keystore keys never leave the phone they're created on.
So an account enrolled via the **web** app (a WebAuthn passkey) has no biometric key on any given phone
yet; a face enrolled on the web works in the app too, but an account without one has no other factor to
fall back on. Without a bootstrap path, that account could **never**
complete login on mobile — password succeeds, but there's no factor
mobile can use to finish MFA. Solved with a short-lived linking code:

1. **Web, already fully authenticated** (Security Settings → "Link Mobile Device" → `Enroll.tsx`'s
   `LinkDeviceSection`): `createDeviceLinkCode()` (`src/lib/deviceLink.ts`) calls
   `POST /auth/biometric-key/create-link-code`, which requires `req.session.userId` — i.e. only a
   session that's _already_ passed this account's real MFA can mint a code. Returns a random 10-char
   hex code (~40 bits of entropy) valid for 10 minutes, single-use.
2. **Mobile** (Login screen → "Link this device to an existing account" → `linkDeviceWithCode()` in
   `src/lib/biometricKey.ts`): generates a fresh Keystore keypair, signs the code itself via
   `BiometricPrompt` (the code doubles as the challenge — it's random and gets deleted from the
   server's pending-codes map the moment it's looked up, so there's no separate replay window to
   close), and POSTs to `POST /auth/biometric-key/redeem-link-code` — deliberately the one
   **unauthenticated** endpoint in this whole file. That's safe specifically _because_ step 1 gated
   code minting on already-proven MFA; redeem itself is additionally IP-rate-limited
   (`checkAndRecordRequest`, 10 attempts / 5 min) as defense in depth against code-guessing.
3. On a valid redeem, the server inserts the new `biometric_keys` row and fully logs the session in —
   enrollment and login happen as one step, since that's the entire point of the bootstrap.

**Verified live**: registered a fresh test account, generated a code from a fully-authenticated session
(direct API call standing in for the web button click), redeemed it on the real phone — `BiometricPrompt`
fired, a new key was created, and the phone landed on the Dashboard fully authenticated as that account.
Two earlier attempts genuinely expired mid-test (confirmed via the server's request log timestamps) —
not a bug, just this being tested interactively over a slow feedback loop; a real user types the code and
taps "Link Device" within seconds of generating it, well inside the window.

**Proven working end-to-end**: built, installed, and run on a real Android emulator (Pixel 10 Pro XL,
API level from `google_apis_playstore_ps16k`) — password register/login round-trip against the live
API, real Zod validation errors rendered from the backend, confirmed via screenshots. Not a "should
work" claim — actually run.

**Not a workspace member on purpose.** This package is excluded from the root `pnpm-workspace.yaml`
(see the comment there) — it pins an older React (18.3.x) than the rest of the monorepo (19.x) needs,
and sharing one pnpm graph caused real cross-package type resolution breakage the moment it was added.
Install it independently, inside this folder, not from the repo root. Its own `pnpm-workspace.yaml`
makes this folder a separate pnpm root, so a plain `pnpm install` here stays isolated, and repeats the
root's supply-chain settings (7-day minimum release age, no git/tarball dependencies,
`trustPolicy: no-downgrade`), with overrides for the build-tooling advisories and two exact-version
trust-policy exceptions, each explained in that file (R-SUPPLY-5).

## Full page set (not just an MFA demo anymore)

Mobile originally shipped with just Login/Register/Enroll/Dashboard — a minimal MFA proof-of-concept.
It now mirrors every authenticated page the web app has, hitting the exact same REST endpoints (no
mobile-specific backend routes needed beyond `/auth/biometric-key/*`), with the same role gating
enforced server-side (frontend checks are convenience only, same as web):

- **Command Center** (`DashboardScreen.tsx`) — stat cards (operators, biometric-enrolled, failed
  logins, active threats) + recent audit trail, from `GET /security/dashboard`.
- **Operator Registry** (`UsersScreen.tsx`) — admin/it_support only. List, change role (admin only),
  reset password, reset MFA, delete.
- **Audit Trail** (`SecurityLogsScreen.tsx`) — security_analyst only (deliberately excludes admin, same
  separation-of-duties reasoning as web — see `routes/security.ts`'s `canSeeAuditLogs`). Filters
  (event type, email, IP) plus hash-chain integrity verification.
- **Threat Intel** (`ThreatsScreen.tsx`) — read-only, no role gate, same as web.
- **Financial Ledger** (`PaymentsScreen.tsx`) — subscription plans + a "simulate transaction" form.
  Deliberately **does not** replicate web's fake card-entry fields — they're client-side-only realism
  UI on web that's Luhn-validated but never actually sent to the server, so skipping them changes
  nothing about what data crosses the wire; only `{amount, currency, description}` or `{planId}` are
  ever POSTed, matching the real request contract exactly.
- **Data Vault** (`UploadsScreen.tsx`) — the heaviest port. Needed 3 new native modules (below) since RN
  has no `<input type=file>`/`Blob`/`FileReader` — `expo-document-picker` picks a file,
  `expo-file-system` reads it as base64, `expo-sharing` stands in for the browser's "download" via the
  OS share sheet. Image and text preview render inline; video/audio preview is skipped (would need
  `expo-av`, judged not worth a 4th native dependency) — Share still works for those.
- **Data Protection** (`DataProtectionScreen.tsx`) — static reference content, ported verbatim from
  web's hardcoded `ROWS` array.
- **Privacy & Your Data** (`PrivacyScreen.tsx`, added 2026-09-27) — the same rights as web: read and
  acknowledge the privacy policy (a banner in `AppShell.tsx` appears when its version changes), change
  the optional consents, download a copy of your data, delete the account. Open to every signed-in
  account, including one still setting up sign-in or awaiting a guardian.
- **Sign-up** (`RegisterScreen.tsx`) asks exactly what the web form asks: date of birth (and a
  guardian's email under 18), the data consent as an unticked box, the optional training consent, and
  the privacy policy, whose version it sends. Before 2026-09-27 it sent `dataConsent: true` without
  asking (R-CONSENT-4). An under-18 account waits on `AwaitingGuardianView` (`App.tsx`) until the
  guardian confirms by email.

**Navigation**: a custom slide-out menu (`src/navigation/AppShell.tsx`), not `react-navigation` —
deliberately, to avoid another native dependency + rebuild cycle for what's fundamentally just "show one
of N screens, filtered by role." Tabs are filtered client-side by `user.role`, mirroring
`artifacts/secureai/src/components/Sidebar.tsx`'s gates exactly.

**New native dependencies for this**: `expo-document-picker`, `expo-file-system`, `expo-sharing` — all
official Expo SDK 52 modules (same family as `expo-status-bar`, already in use), chosen specifically to
minimize the risk of a repeat of Blocker 2's real AGP/Kotlin incompatibility. Required one more
`expo prebuild` + `gradlew assembleDebug` cycle after adding them.

## Setup

```bash
cd artifacts/mobile
pnpm install                      # this folder is its own pnpm root (see note above); pnpm 10 or 11
npx expo run:android              # or open android/ in Android Studio directly
npx expo start --dev-client       # separately, for the Metro bundler (see "Running it" below)
```

The `android/` and `ios/` native projects are committed, so `expo prebuild` is not needed; re-running it
would overwrite hand-made native changes (the certificate pinning config, the `ExpoModulesPackage` shim
in Blocker 4, the backup exclusion rules).

**Pointing a build at the live API:** create `artifacts/mobile/.env` (git-ignored; copy
`.env.example`). Expo inlines `EXPO_PUBLIC_*` values into the bundle at build time:

```bash
EXPO_PUBLIC_API_BASE_URL=https://d2zb1uxt99m5ks.cloudfront.net/api
EXPO_PUBLIC_APP_ORIGIN=https://secureai-mobile.app   # must be on the API's FRONTEND_ORIGINS list
```

Without it the app uses `http://localhost:8080/api` (see "Running it"). A release APK for a phone:
`cd android && ./gradlew app:assembleRelease` (from a short path, Blocker 3).

**iOS** needs macOS with Xcode and CocoaPods: `cd ios && pod install`, then `npx expo run:ios`.

**IMPORTANT — your project's folder path must be short.** See Blocker 3 below. If you're at a long
path (anything similarly deep to `C:\Users\you\SomeVeryLongProjectFolderName\...`), move or fresh-copy
the repo to something like `C:\dev\secureai\` first. This was the single biggest blocker encountered
and the fix is entirely path-length, not a code issue.

### Blocker 1 — Java version

Gradle 8.10.2 (the version this Expo/RN template scaffolds) doesn't support Java 25, which is what
Android Studio's bundled JBR runs on newer Android Studio installs. Symptom:
`Unsupported class file major version 69`. Fix: install a JDK 21 (Temurin) and point `JAVA_HOME` at it
before running Gradle:

```powershell
winget install --id EclipseAdoptium.Temurin.21.JDK -e
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot"  # adjust to actual version
```

### Blocker 2 — `react-native-passkey` version (historical — dependency removed entirely)

This blocker no longer applies: `react-native-passkey` was removed from `package.json` and replaced
with `react-native-biometrics` (see the top of this README). Kept here only because the diagnostic
approach (bisecting a native Kotlin compile failure to a version-specific AGP mismatch in a
dependency's own `buildscript`) is still useful if a similar issue shows up elsewhere. Original text:
the newest `react-native-passkey@3.6.1` (auto-resolved from a `^3.1.0` range) failed to compile its own
bundled Kotlin with `Unresolved reference: listOf` / `emptyList` / `run` / `apply` — that version
declared AGP 8.13 in its own `buildscript`, newer than this project's AGP baseline. `react-native-
biometrics@3.0.1` compiles clean with no such pin needed.

### Blocker 3 — Windows path-length limit (fixed by moving the project)

CMake fails compiling `expo-modules-core`'s native C++ with object file paths over 250 characters
(`CMAKE_OBJECT_PATH_MAX`), cascading into `ninja: error: manifest 'build.ninja' still dirty after 100
tries`, if your project sits at a long absolute path. Two things do **NOT** fix it (both tried and
confirmed ineffective): `subst`-ing a short drive letter (pnpm's symlinks resolve back to the real
path regardless), and enabling Windows' `LongPathsEnabled` registry setting (CMake's 250-char guard is
hardcoded in this CMake/AGP version, independent of the OS setting). The only fix that works: move or
fresh-copy the project to a short path (e.g. `C:\dev\secureai\`) before running `expo prebuild` /
`expo run:android`.

### Blocker 4 — `expo-modules-autolinking@2.0.8` resolves the wrong class path for `expo` itself (fixed — shim in place)

The generated `PackageList.java` does `import expo.core.ExpoModulesPackage;`, but that class doesn't
exist there in this Expo SDK — the real one lives at `expo.modules.ExpoModulesPackage`. Confirmed this
is a genuine bug in the autolinking tool itself, not a stale cache, by running its
`react-native-config --json --platform android` command directly outside Gradle entirely and getting
the same wrong path both times. **Fixed** with a compatibility shim:
`android/app/src/main/java/expo/core/ExpoModulesPackage.kt` — a small class at the wrongly-expected
package path that delegates to the real one (composition, not inheritance, since Kotlin classes are
`final` by default and the real class isn't marked `open`).

### Blocker 5 — pnpm breaks `expo/AppEntry.js`'s relative import (fixed — custom entry point)

`expo/AppEntry.js` does `import App from '../../App'`, assuming a flat `node_modules/expo/AppEntry.js`
layout where that resolves to the project root. pnpm's `.pnpm` virtual store nests packages much
deeper, and Metro resolves the symlink to its real (deep) location before computing the relative
import, landing nowhere near the actual `App.tsx`. Symptom: `Unable to resolve "../../App"`. **Fixed**
with a custom `index.js` at the project root (`registerRootComponent(App)`, importing `./App` directly)
and `package.json`'s `"main"` pointed at it instead of `expo/AppEntry.js`.

### Blocker 6 — missing `@babel/runtime` (fixed — added as a direct dependency)

Babel's transpiled output references `@babel/runtime/helpers/interopRequireDefault` at runtime, but it
was only ever a transitive dependency, not resolvable directly from the project root under pnpm's
strict isolation. Fixed by adding `@babel/runtime` as a direct dependency.

## Running it

Two processes, both needed:

```bash
# Terminal 1 — the native app shell (only needed again if native code/deps change)
npx expo run:android

# Terminal 2 — the JS bundler (needed every time)
npx expo start --dev-client
adb reverse tcp:8081 tcp:8081   # if the app was already installed via run:android separately
```

Verified live: password register and login both round-trip against the real API server. Without a
`.env`, `src/config.ts` uses `http://localhost:8080/api`, reached from a USB-connected phone through
`adb reverse tcp:8080 tcp:8080` (a LAN IP was used at first, and failed on campus WiFi, where the
laptop and phone sat on isolated networks; the comment in `config.ts` has the details). No tunnel
domain is needed, since the biometric-key endpoints have no origin/RP-ID trust requirement beyond
ordinary CORS. From an emulator instead, use `http://10.0.2.2:8080/api` (the special host-loopback
alias).

**Full device biometric enrollment and login round-trip confirmed on a real physical phone** (iQOO Neo7
Pro): register → `BiometricPrompt` fires during `createSignature()` → key registers with the backend →
`biometric_keys` row created → Dashboard shows "Device biometric enrolled: Yes"; then log out, log back
in with password, `BiometricPrompt` fires again for the login challenge, session established. Verified
directly against the database (`biometric_keys.last_used_at` updates on each successful login-verify),
not just by trusting the UI.

### Blocker 7 — misdiagnosed "Face biometric enrollment required" (fixed — two real bugs, neither was Android)

Tapping "Enroll Device Passkey" kept returning `{"error": "Face biometric enrollment required", "code":
"FACE_ENROLLMENT_REQUIRED"}` even after successfully enrolling a real fingerprint through Android's own
Settings wizard (confirmed via the "Fingerprint added" success screen). That string isn't in this app's
code or in `react-native-passkey`'s bundled source (checked both by grep). Two independent bugs stacked
here, both confirmed by inspecting the live server's request log (pino JSON), not guessed:

1. **Stale backend build.** The running `artifacts/api-server` process was started from a compiled
   `dist/index.mjs` that predated the `requireMfaEnrolled.ts` edit (face-OR-passkey policy change) —
   `pnpm run build` was never re-run after that source change, so the live server kept serving the old
   AND-logic response (and its old error string/code) indefinitely, regardless of the emulator's actual
   OS-level biometric state. Fixed by rebuilding (`node ./build.mjs`) and restarting the process.
2. **Client sending GET instead of POST.** Even after the rebuild, the error changed only to "Face or
   passkey enrollment required" — still wrong. The server log showed why:
   `GET /api/auth/passkey/register-options` → `403`. That route is `router.post(...)`-only
   (`routes/passkeys.ts`); a GET never matches it and falls through Express's router chain to
   `securityRouter`, whose unscoped `router.use(requireMfaEnrolled)` catches anything that reaches it
   regardless of path. Root cause: `src/lib/passkey.ts`'s `enrollPasskey()` and `loginWithPasskey()`
   called `request(path)` without `{ method: 'POST' }`, and `request()`'s default method is `'GET'`.
   Fixed by passing `{ method: 'POST' }` explicitly on both calls.

The emulator's own fingerprint enrollment was never the problem in either case. **Lesson**: after any
backend source edit, rebuild and restart before re-testing the mobile app against it — `dist/index.mjs`
is a snapshot, not a live reload — and when a client-visible error text traces back to a specific backend
string, check the server's own request log for the actual method/path/status before trusting client-side
assumptions about which endpoint produced it.

## Why this uses Android Keystore instead of WebAuthn passkeys (historical — this is why the architecture changed, not a current blocker)

Everything in this section describes the original `react-native-passkey`/WebAuthn approach, which has
since been **replaced** (see the top of this README) specifically because of the wall documented here.
It's kept because it's the actual evidence for that decision — skip to "Architecture notes" below if you
just want the current design.

### Why a full passkey ceremony can't be completed against a tunnel domain (confirmed via logcat, not guessed — on both emulator and real hardware)

With Blocker 7 fixed, tapping "Enroll Device Passkey" correctly reaches Android's real Credential Manager
sheet. This was traced end-to-end through `adb logcat` on **three** devices: two AVDs (a Pixel 10 Pro XL on
a 16KB-page experimental image, and a Pixel 8 / API 34 standard Play Store image) and a real physical phone
(iQOO Neo7 Pro, arm64-v8a, Android 16).

**On both emulators**, local platform-passkey creation fails instantly (`CreatePasswordOrPasskeyOperation`,
`couj: [28434]`, ~15ms) — no x86_64 AVD has genuine StrongBox/TEE-backed secure hardware, so this fails
immediately and consistently regardless of screen lock, fingerprint enrollment, or system image choice.
GMS then falls back to a "security key only" cross-platform flow (`Fido2RequestController.
startCrossPlatformSecurityKey`) — a different code path than normal platform-passkey creation.

**On the real phone**, `CreatePasswordOrPasskeyOperation` _succeeds_ — confirming real hardware has no such
limitation and completes local passkey creation normally, no fallback needed.

**But both paths converge on the same wall.** Whether via the emulator's cross-platform fallback or the
phone's normal local-creation path, a `ValidateRpIdOperation` always runs afterward — a real, ~1-3 second
network call (not a cached/local check; re-confirmed on a completely fresh GMS instance via `pm clear
com.google.android.gms`, which had never contacted the domain before). It gets a real response, and the
verdict is always **`RpId validation failed`** (worded as `The incoming request cannot be validated` on the
emulator's older GMS build, `RP ID cannot be validated` on the phone's newer one — same underlying
`androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException`).

This was tested with two different tunnel providers (ngrok, Cloudflare Quick Tunnel) and a fully correct
`assetlinks.json` (right package name, right SHA-256 fingerprint — independently verified against each
installed APK with `apksigner verify --print-certs`), served with no interstitial in the way, and it failed
identically every time, on every device. **Conclusion: this was never an emulator hardware limitation — the
emulator's missing secure hardware was a real, separate, correctly-diagnosed issue, but not the deepest
one.** The actual, universal blocker is that Android's passkey RP-ID validation backend rejects ephemeral
tunnel subdomains (`ngrok-free.dev`, `trycloudflare.com`) outright, independent of `assetlinks.json`
correctness and independent of the device's own secure hardware — almost certainly a deliberate
anti-phishing control, since passkeys are specifically designed to resist "trust a throwaway domain"
attacks. Getting a passkey ceremony to close end-to-end needs a **real, owned, persistent domain** — not
achievable from any local dev tunnel, regardless of which device runs the app.

### Also fixed along the way: the debug APK only had x86_64 native libraries

The APK built and installed for emulator testing (`expo run:android` auto-passes
`-PreactNativeArchitectures=x86_64` to speed up local iteration against whichever emulator is connected)
only contained x86_64 `.so` files. Installing that same APK on the real arm64-v8a phone let it install
(package-manager checks don't inspect native libs) but crashed at runtime —
`SoLoaderDSONotFoundError: couldn't find DSO to load: libexpo-modules-core.so`, since
`expo-modules-core`'s native module was never actually loaded, leaving `globalThis.expo` (and everything
that reads it, like `EventEmitter`) undefined. `gradle.properties` already lists all four architectures
(`reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`); the fix was rebuilding with
`./gradlew assembleDebug` directly (no ABI override) to get a real multi-arch APK.

### Also fixed along the way: ngrok's free-tier interstitial

The first tunnel attempt used ngrok, whose free tier serves an HTML "you're about to visit…" warning page
to any request lacking its own `ngrok-skip-browser-warning` header — which Android's asset-link verifier
never sends. So the _first_ domain (`assetlinks.json`, correctly written) was silently receiving that HTML
page instead of JSON on every fetch. Switched to a Cloudflare Quick Tunnel (`cloudflared tunnel --url
http://localhost:8080`), which has no such interstitial, confirmed via a direct fetch returning real JSON.
This got past that specific bug, but led to the deeper platform limitation documented above.

### Also fixed: a CORS regression from adding the tunnel domain

Adding `DEV_TUNNEL_DOMAIN` support to `allowedOrigins.ts` briefly broke the _web_ app's login — the
original code only added the `localhost` fallback when `origins.size === 0`, so setting a tunnel domain
disabled the localhost fallback entirely (`Error: Origin not allowed`, caught via the live server's error
log). Fixed by making the tunnel domain additive alongside the localhost fallback rather than exclusive
with it — see `isProductionDeployment` in `allowedOrigins.ts`.

### If you want to attempt a real WebAuthn passkey ceremony anyway (historical — mobile no longer does this)

1. Get a real HTTPS domain reachable from your device (a Cloudflare Quick Tunnel — `cloudflared tunnel
--url http://localhost:8080` — works and has no interstitial, unlike ngrok's free tier).
2. Set `DEV_TUNNEL_DOMAIN` on the api-server to that domain's hostname (see `allowedOrigins.ts`).
3. Update `API_BASE_URL`, `APP_ORIGIN`, and `RP_ID` in `src/config.ts` to match that domain.
4. Get your Android app's signing certificate SHA-256 fingerprint:
   `cd android && ./gradlew signingReport` (debug keystore is fine for local testing), or verify against
   an installed APK with `apksigner verify --print-certs path\to\app.apk`.
5. Set `ANDROID_APP_SHA256_FINGERPRINT` on the api-server to that fingerprint — `app.ts` serves
   `/.well-known/assetlinks.json` from it directly, no separate hosting needed.
6. Expect the `RpId validation failed` wall documented above unless testing on a real physical device.

## Architecture notes

- **Cookies, not a bearer token.** The backend is session-cookie based (`express-session`). React
  Native's fetch persists cookies via the native HTTP stack automatically, same as a browser — no
  extra library needed for that part. `@react-native-cookies/cookies` is used only to _read_ the
  non-`httpOnly` `csrf_token` cookie's value back into JS (there's no `document.cookie` here), to echo
  it as the `X-CSRF-Token` header the backend's double-submit CSRF check requires on every mutating
  request — see `src/lib/api.ts`.
- **MFA policy: face OR passkey OR device biometric key, not all required.** `requireMfaEnrolled`
  (backend, `middlewares/requireMfaEnrolled.ts`) checks `faceEnrolled || passkeysTable row exists ||
biometricKeysTable row exists` — any one factor satisfies it. This is what lets a mobile account
  (device-biometric-key only) and a web account (face and/or WebAuthn passkey) share the same gate
  without either being locked out by a factor it has no way to satisfy. See
  `docs/04_Threat_Model_Risk_Assessment.md`.
- **Signing algorithm**: RSA-2048, PKCS#1 v1.5 padding, SHA-256 digest (`SHA256withRSA` on the Android
  side via `react-native-biometrics`, `kSecKeyAlgorithmRSASignatureMessagePKCS1v15SHA256` on iOS;
  `crypto.verify('RSA-SHA256', ...)` with the public key imported as DER/SPKI on the server side — see
  `verifyBiometricSignature()` in `routes/biometricKey.ts`). Confirmed to match by reading
  `react-native-biometrics`' actual native Android and iOS source, not assumed from its docs.
- **`allowDeviceCredentials: false`** (`src/lib/biometricKey.ts`) — only a real biometric (fingerprint /
  face) unlocks the key, not a PIN/pattern fallback. Matches the same "gate a crypto operation with an
  actual biometric" intent as the WebAuthn passkey path this replaces.
- **Certificate pinning (Android release builds only)** —
  `android/app/src/main/res/xml/network_security_config.xml`, wired via `android:networkSecurityConfig`
  in the release manifest. Pins `d2zb1uxt99m5ks.cloudfront.net` (the live site and API) to three real SPKI
  hashes (the current certificate, its intermediate, and Amazon Root CA 1 as a last resort) with a
  pin-set expiry of 2027-03-01, so a device with a rogue/compromised CA in its trust store can't MITM the
  app even over otherwise-valid TLS. The comment block at the top of that file records how the pins were
  computed, the 2026-09-18 rotation that made the first pin set stale, and how to re-verify before the
  expiry. Debug builds are unaffected (`src/debug/AndroidManifest.xml`'s cleartext
  override still applies for the local `adb reverse` tunnel). iOS has no pinning yet (`docs/04`
  R-MOBILE-4).
- **App data kept out of backups (Android)** — `android:allowBackup="false"` plus
  `res/xml/data_extraction_rules.xml`, so neither a cloud backup nor a device-to-device transfer copies
  the session cookie or app data to another phone (added 2026-09-29, `docs/04` R-MOBILE-3).

## UI: styled to match the web app, not just functionally equivalent

Mobile's screens (`Login`, `Register`, `Enroll`, `Dashboard`) were restyled to visually match
`artifacts/secureai`'s "terminal/HUD" design language — same product, not a differently-branded app that
happens to share a backend:

- **Color tokens** in `src/theme.ts` are direct HSL→RGB conversions of the web app's actual CSS
  variables (`artifacts/secureai/src/index.css` `:root` block — `--background`, `--primary`, etc.), not
  eyeballed approximations.
- **Shared primitives** in `src/components/ui.tsx` (`Card`, `CornerAccents`, `Label`, `Input`, `Button`,
  `SectionNote`, `ShieldBadge`) mirror `artifacts/secureai/src/components/ui.tsx`'s API and look: sharp
  (non-rounded) corners, uppercase tracked monospace labels/buttons, bordered cards with optional
  decorative corner brackets or a top accent border, a pulsing shield/reticle badge.
- **Terminology matches web's copy** where it doesn't reduce clarity — "Operator ID (Email)", "Identity
  Verification", "Command Center", "Authenticate", "Issue Clearance", "Biometric MFA" info box, mandatory-
  enrollment warning styling. One deliberate departure: the web app labels its password field "Passkey"
  as a stylistic/thematic choice; mobile keeps "Password" for that field specifically to avoid confusion
  with the actual device-biometric-key factor described above.
- **No new native dependencies for this.** No icon library (`lucide-react-native` etc.) or custom font
  asset was added — icons are approximated with plain `View`-based geometric shapes (the corner brackets,
  the reticle badge), and the monospace font is RN's built-in `monospace` family rather than the web
  app's actual JetBrains Mono. This was a deliberate trade-off to avoid another native rebuild cycle;
  visually close, not pixel-identical.
