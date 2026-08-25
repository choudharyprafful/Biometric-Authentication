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
export const API_BASE_URL = 'http://localhost:8080/api';

// Sent as the Origin header on every request — the backend's CORS check
// (ALLOWED_ORIGINS / isAllowedOrigin in allowedOrigins.ts) accepts any
// http://localhost:<port> origin in local dev, so this arbitrary-but-
// consistent value works without further backend configuration.
export const APP_ORIGIN = 'http://localhost:8081';
