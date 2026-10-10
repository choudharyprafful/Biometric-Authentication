/**
 * Allowlisted origins pinned from deployment configuration — never derived
 * from request headers, which are attacker-controlled.
 *
 * Shared by CORS config (app.ts) and the WebAuthn relying-party resolver
 * (routes/passkeys.ts) so there's exactly one source of truth for "which
 * origins is this API allowed to talk to."
 */
// Gated on NODE_ENV so the localhost fallback below is disabled for any
// production deployment — otherwise a split deployment with only
// FRONTEND_ORIGINS set would still trust any localhost origin in
// production, defeating the point of an allowlist.
const isProductionDeployment = process.env["NODE_ENV"] === "production";

export const ALLOWED_ORIGINS: readonly string[] = (() => {
  const origins = new Set<string>();
  // FRONTEND_ORIGINS: comma-separated full origins (scheme + host, no
  // trailing slash) for a split deployment (frontend and API on different hosts).
  for (const origin of (process.env["FRONTEND_ORIGINS"] ?? "").split(",")) {
    const o = origin.trim();
    if (o) origins.add(o);
  }
  // A tunnel domain (ngrok/Cloudflare) exposing local dev over real HTTPS —
  // needed for native passkey ceremonies, which require Digital Asset
  // Links domain verification that no localhost exception can satisfy.
  // Additive alongside the localhost fallback below, not a replacement.
  const tunnel = process.env["DEV_TUNNEL_DOMAIN"];
  if (tunnel) origins.add(`https://${tunnel}`);
  if (!isProductionDeployment) {
    const port = process.env["FRONTEND_PORT"] ?? "5173";
    origins.add(`http://localhost:${port}`);
    origins.add("https://192.168.0.110:5173");
    origins.add("https://localhost:5173");
    origins.add(`http://localhost`);
  }
  return [...origins];
})();

/** True if `origin` is on the allowlist (or any localhost port, in local dev). */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true; // same-origin/non-browser requests carry no Origin header
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (!isProductionDeployment) {
    try {
      const u = new URL(origin);
      return u.hostname === "localhost" && u.protocol === "http:";
    } catch {
      return false;
    }
  }
  return false;
}
