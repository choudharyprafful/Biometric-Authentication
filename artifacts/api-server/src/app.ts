import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { isAllowedOrigin } from "./lib/allowedOrigins";
import { issueCsrfCookie, requireCsrfMatch } from "./middlewares/csrf";
import { IDLE_TIMEOUT_MS, ABSOLUTE_SESSION_MAX_MS } from "./lib/sessionPolicy";

declare global {
  namespace Express {
    interface Request {
      /** Raw request body bytes, captured for HMAC signature verification
       *  (payment webhooks) — re-serialized JSON can differ byte-for-byte
       *  from what was originally signed, so the parsed body isn't safe to
       *  re-sign and compare. */
      rawBody?: Buffer;
    }
  }
}

// Augment express-session SessionData
declare module "express-session" {
  interface SessionData {
    userId?: number;
    /** Epoch ms — set alongside userId at every point a full session is
     *  established (register, login without MFA, face-verify, passkey
     *  login-verify). Enforced independently of the cookie's own idle-timeout
     *  expiry — see lib/sessionPolicy.ts and the middleware below. */
    absoluteExpiresAt?: number;
    pendingUserId?: number;
    tempToken?: string;
    /** Epoch ms when the MFA challenge was issued — used for expiry. */
    mfaIssuedAt?: number;
    /** Failed face-verification attempts for the current challenge. */
    mfaAttempts?: number;
    /** Pending WebAuthn challenge (registration or authentication). */
    webauthnChallenge?: string;
    /** Raw password-reset token bound to a pending passkey reset ceremony. */
    resetToken?: string;
  }
}

const PgSession = ConnectPgSimple(session);

const app: Express = express();
app.disable("x-powered-by");

// Digital Asset Links statement — lets Android's Credential Manager trust
// this domain for native passkey ceremonies claiming rpId = this domain
// (see artifacts/mobile/README.md, "What needs a real domain"). Public,
// unauthenticated, no CORS/CSRF concerns: it's fetched server-to-server by
// Android's verification service, not by the app itself. Fingerprint is the
// local debug keystore's SHA-256 (from `cd android && ./gradlew
// signingReport`) — re-generate this if the signing key ever changes.
app.get("/.well-known/assetlinks.json", (_req, res) => {
  const fingerprint = process.env["ANDROID_APP_SHA256_FINGERPRINT"];
  if (!fingerprint) {
    res.status(404).json([]);
    return;
  }
  res.json([
    {
      relation: ["delegate_permission/common.get_login_creds"],
      target: {
        namespace: "android_app",
        package_name: "com.secureai.mobile",
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ]);
});

// Trust the first reverse-proxy hop (Replit and most real deployments
// terminate TLS upstream) so req.secure reflects X-Forwarded-Proto instead
// of the plain-HTTP hop between the proxy and this process.
app.set("trust proxy", 1);

// Data protection — encrypt in transit: force HTTPS in production and tell
// browsers to remember that (HSTS), plus baseline response-header hardening.
// No-op locally (NODE_ENV !== "production"), since local dev has no TLS.
app.use((req, res, next) => {
  if (process.env["NODE_ENV"] === "production" && !req.secure) {
    res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    return;
  }
  if (process.env["NODE_ENV"] === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // API responses are JSON, never HTML — a strict CSP still blocks any
  // response that somehow got script-executed in a browser context.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Secure comms: reflect only allowlisted origins, not `origin: true` (which
// echoes back whatever Origin the request sent — effectively no restriction
// at all when combined with credentials: true).
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Origin not allowed"));
    }
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "X-CSRF-Token"],
}));
// Body-size limits are scoped per-route, not one ceiling for everything:
// a 21mb allowance exists only because uploads legitimately need it
// (base64-encoded files, up to 15mb decoded — base64 inflates size ~33%,
// so 15mb decoded needs ~20mb of body just for the encoded bytes, plus a
// little headroom for the JSON envelope). Applying that same large limit
// to cheap endpoints like /auth/login would let an attacker flood them
// with oversized bodies to burn server memory/CPU parsing JSON before any
// auth or rate-limit check even runs. Express skips a path-scoped body
// parser for non-matching requests and won't re-parse an already-consumed
// body, so registering the uploads override first and the small default
// after is safe for both cases.
const jsonBodyVerify = (req: express.Request, _res: express.Response, buf: Buffer) => {
  req.rawBody = Buffer.from(buf);
};
app.use("/api/uploads", express.json({ limit: "21mb", verify: jsonBodyVerify }));
app.use(express.json({ limit: "256kb", verify: jsonBodyVerify }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(issueCsrfCookie);
// Webhooks are server-to-server (no browser, no cookies) and are validated
// by HMAC signature instead — see routes/payments.ts POST /payments/webhook.
app.use((req, res, next) => (req.path === "/api/payments/webhook" ? next() : requireCsrfMatch(req, res, next)));

app.use(
  session({
    store: new PgSession({
      pool,
      // The "session" table is provisioned via Drizzle (lib/db/src/schema/sessions.ts).
      // createTableIfMissing is disabled because connect-pg-simple's bundled
      // table.sql uses obsolete syntax that fails on this Postgres.
      createTableIfMissing: false,
    }),
    secret: process.env["SESSION_SECRET"] || "fallback-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    // Idle timeout, not a fixed window: `rolling: true` re-issues the cookie
    // (and touches the store's expiry) on every response, so an actively-used
    // session keeps sliding forward while an abandoned one — e.g. a stolen,
    // unlocked device nobody's touching anymore — actually expires. This is
    // the mitigation for the brief's "device theft while unlocked" scenario
    // that logout-all (routes/auth.ts) doesn't cover: logout-all requires
    // someone to notice and act; this expires on its own.
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: IDLE_TIMEOUT_MS,
    },
  }),
);

// Absolute session cap, independent of idle-timeout sliding: a continuously
// active session (including one being kept "warm" by an attacker replaying
// a stolen cookie) is still forced to re-authenticate after
// ABSOLUTE_SESSION_MAX_MS, full stop. Idle timeout alone can't catch this
// case, since ongoing activity — legitimate or not — keeps resetting it.
app.use((req, res, next) => {
  if (req.session.userId && req.session.absoluteExpiresAt && Date.now() > req.session.absoluteExpiresAt) {
    req.session.destroy(() => {
      res.status(401).json({ error: "Session expired — please log in again" });
    });
    return;
  }
  next();
});

app.use("/api", router);

export default app;
