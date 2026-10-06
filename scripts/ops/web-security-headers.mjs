// Security headers for the web app's pages and assets (docs/04 R-SC-4). The API sets its own on
// every /api response (helmet, in app.ts); the pages come from Amplify through CloudFront, and
// until 2026-09-27 they had none: no Content-Security-Policy, no clickjacking protection, no HSTS.
// The OWASP ZAP scan of the live site found that.
//
// One definition, used by:
//   scripts/ops/deploy-web.mjs   applies them as Amplify custom headers, then checks the live site
//   the local browser test       serves the production build with exactly these headers
//
// Content-Security-Policy, directive by directive:
//   script-src 'self'         only the site's own bundle: no inline script, no eval, no CDN
//   style-src 'self'          stylesheets from this site only, no inline <style>: React's style={}
//                             sets properties through the DOM, which CSP allows. Tested 2026-09-27 on
//                             every page (public, user, analyst, admin) with no violation; the ZAP
//                             rescan had flagged the earlier 'unsafe-inline'
//   font-src 'self'           fonts are bundled (@fontsource), not fetched from Google
//   img-src data: blob:       inline icons, and camera frames drawn for face capture
//   media-src blob:           the camera preview
//   connect-src 'self'        the API is same-origin (/api) and the face models are under /models
//   worker-src blob:          TensorFlow.js (face matching) may start a worker from a blob URL
//   frame-ancestors 'none'    nobody may frame the site (clickjacking), as X-Frame-Options says
//   form-action, base-uri     no form posting or <base> tag pointing elsewhere
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

export const WEB_SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Password-reset and parental-consent links carry a token in the URL; never pass it on.
  "Referrer-Policy": "no-referrer",
  // The camera is used for face sign-in on this site only; nothing else is needed.
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** Amplify's customHeaders format: every path gets every header. */
export function amplifyCustomHeadersYaml() {
  const quote = (v) => `'${String(v).replaceAll("'", "''")}'`;
  const lines = ["customHeaders:", "  - pattern: '**/*'", "    headers:"];
  for (const [key, value] of Object.entries(WEB_SECURITY_HEADERS)) {
    lines.push(`      - key: ${quote(key)}`, `        value: ${quote(value)}`);
  }
  return `${lines.join("\n")}\n`;
}
