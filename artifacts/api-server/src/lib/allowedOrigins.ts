/**
 * Allowlisted origins pinned from deployment configuration — never derived
 * from request headers, which are attacker-controlled. Replit deployments use
 * REPLIT_DEV_DOMAIN / REPLIT_DOMAINS; local dev falls back to localhost with
 * whatever PORT the Vite server uses (default 5173).
 *
 * Shared by CORS config (app.ts) and the WebAuthn relying-party resolver
 * (routes/passkeys.ts) so there's exactly one source of truth for "which
 * origins is this API allowed to talk to."
 */
const isReplitDeployment =
  !!process.env["REPLIT_DEV_DOMAIN"] || (process.env["REPLIT_DOMAINS"] ?? "").trim() !== "";

export const ALLOWED_ORIGINS: readonly string[] = (() => {
  const origins = new Set<string>();
  const dev = process.env["REPLIT_DEV_DOMAIN"];
  if (dev) origins.add(`https://${dev}`);
  for (const domain of (process.env["REPLIT_DOMAINS"] ?? "").split(",")) {
    const d = domain.trim();
    if (d) origins.add(`https://${d}`);
  }
  // A tunnel domain (e.g. ngrok/Cloudflare) exposing local dev over real
  // HTTPS — needed for native passkey ceremonies, which require Digital
  // Asset Links domain verification that no localhost exception can
  // satisfy. See artifacts/mobile/README.md, "What needs a real domain."
  // Additive alongside the local dev fallback below, not a replacement for
  // it — the web app still runs on plain localhost even when a tunnel
  // domain is also allowlisted for mobile testing.
  const tunnel = process.env["DEV_TUNNEL_DOMAIN"];
  if (tunnel) origins.add(`https://${tunnel}`);
  // Local development fallback — only skipped for an actual Replit deployment.
  if (!isReplitDeployment) {
    const port = process.env["FRONTEND_PORT"] ?? "5173";
    origins.add(`http://localhost:${port}`);
    // Also accept any localhost port so the dev server port can vary.
    origins.add(`http://localhost`);
  }
  return [...origins];
})();

/** True if `origin` is on the allowlist (or any localhost port, in local dev). */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true; // same-origin/non-browser requests carry no Origin header
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (!isReplitDeployment) {
    try {
      const u = new URL(origin);
      return u.hostname === "localhost" && u.protocol === "http:";
    } catch {
      return false;
    }
  }
  return false;
}
