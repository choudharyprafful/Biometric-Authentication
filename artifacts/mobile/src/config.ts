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
// building a release APK against a live deployed backend, e.g. in a
// git-ignored .env (see .env.example):
//   EXPO_PUBLIC_API_BASE_URL=https://d2zb1uxt99m5ks.cloudfront.net/api
// Falls back to the local-dev adb-reverse tunnel when unset.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";

// Sent as the Origin header on every request — must be on the backend's
// FRONTEND_ORIGINS/ALLOWED_ORIGINS allowlist (see allowedOrigins.ts) for
// CORS and the WebAuthn relying-party check to accept it. In local dev, any
// http://localhost:<port> origin is accepted automatically; for a release
// build this needs to be a real, allowlisted value — there's no "the app"
// origin for a native client the way a browser has one, so this is
// necessarily an arbitrary-but-consistent placeholder the backend is
// configured to trust specifically for the mobile app.
export const APP_ORIGIN =
  process.env.EXPO_PUBLIC_APP_ORIGIN ?? "http://localhost:8081";

// The website, whose /app-face page is the face check (src/components/FaceCapture.tsx). Live, the
// site and the API share one address (CloudFront sends /api to the API), so by default this is
// API_BASE_URL without its /api. Set EXPO_PUBLIC_WEB_BASE_URL when they differ, as in local
// development, where the site runs on Vite's port: http://localhost:5173 with
// `adb reverse tcp:5173 tcp:5173`.
export const WEB_BASE_URL = (
  process.env.EXPO_PUBLIC_WEB_BASE_URL ?? API_BASE_URL.replace(/\/api\/?$/, "")
).replace(/\/$/, "");

// Scheme and host (and port) of a URL, lower-cased; "" when it isn't http(s). A regex, because
// React Native's URL class doesn't implement .origin.
export function originOf(url: string): string {
  return /^https?:\/\/[^/?#]+/i.exec(url)?.[0].toLowerCase() ?? "";
}

// The only origin the face check WebView may load or accept a message from.
export const WEB_ORIGIN = originOf(WEB_BASE_URL);
export const FACE_CHECK_URL = `${WEB_BASE_URL}/app-face`;

// The privacy policy is one page for web and mobile: the live site's /privacy.
export const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ??
  "https://d2zb1uxt99m5ks.cloudfront.net/privacy";

// The policy version the sign-up screen points to. Must equal the web text's version and the
// API's PRIVACY_POLICY_VERSION (CI checks all three: scripts/check-privacy-policy-version.mjs).
// An older build sending an older version is harmless: the API records an acknowledgement only
// for the current version, and otherwise asks the person to review the policy after signing in.
export const PRIVACY_POLICY_VERSION = "2026-10-06";

// Must match MINOR_CONSENT_AGE_THRESHOLD in api-server's auth.ts. Only decides whether to show
// the guardian field; the server recomputes age from the date of birth.
export const MINOR_CONSENT_AGE_THRESHOLD = 18;
