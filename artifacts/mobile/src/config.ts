// No @types/node in this package (deliberately minimal RN deps — see
// pnpm-workspace.yaml's note on why mobile has its own independent
// install), so `process.env` needs a local ambient type. This doesn't
// affect runtime — Expo/Metro's EXPO_PUBLIC_ inlining happens at bundle
// time regardless of what TypeScript sees here.
declare const process: { env: Record<string, string | undefined> };

// Uses `adb reverse tcp:8080 tcp:8080` over the USB cable rather than a LAN
// IP — deliberately, after hitting real campus-network client isolation
// (dev machine on "RMIT-University" WiFi, phone on "RMIT-Guest" — two
// isolated subnets with 100% packet loss between them, confirmed via `adb
// shell ping`). A LAN IP is fragile on any network like that (or one that
// just reassigns DHCP addresses), and USB is already required for adb/Metro
// anyway, so tunneling the API port the same way removes an entire class of
// "wrong network" failures. Run `adb reverse tcp:8080 tcp:8080` once per
// device connection (same command as Metro's port 8081) before testing.
//
// Android emulator: use 'http://10.0.2.2:8080/api' instead (special
// loopback alias to the host machine, no adb reverse needed there).
//
// EXPO_PUBLIC_API_BASE_URL is inlined at build time (Expo's convention for
// client-exposed env vars — anything prefixed EXPO_PUBLIC_ gets baked into
// the JS bundle, same mechanism as Vite's VITE_ prefix). Set it when
// building a release APK against a live deployed backend, e.g.:
//   EXPO_PUBLIC_API_BASE_URL=https://secureai-api.onrender.com/api eas build ...
// Falls back to the local-dev adb-reverse tunnel when unset.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api';

// Sent as the Origin header on every request — must be on the backend's
// FRONTEND_ORIGINS/ALLOWED_ORIGINS allowlist (see allowedOrigins.ts) for
// CORS and the WebAuthn relying-party check to accept it. In local dev, any
// http://localhost:<port> origin is accepted automatically; for a release
// build this needs to be a real, allowlisted value — there's no "the app"
// origin for a native client the way a browser has one, so this is
// necessarily an arbitrary-but-consistent placeholder the backend is
// configured to trust specifically for the mobile app.
export const APP_ORIGIN = process.env.EXPO_PUBLIC_APP_ORIGIN ?? 'http://localhost:8081';

// The privacy policy is one page for web and mobile: the live site's /privacy.
export const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? 'https://d2zb1uxt99m5ks.cloudfront.net/privacy';
