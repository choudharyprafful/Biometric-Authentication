import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";

// Augment express-session SessionData
declare module "express-session" {
  interface SessionData {
    userId?: number;
    pendingUserId?: number;
    tempToken?: string;
    /** Epoch ms when the MFA challenge was issued — used for expiry. */
    mfaIssuedAt?: number;
    /** Failed face-verification attempts for the current challenge. */
    mfaAttempts?: number;
    /** Pending WebAuthn challenge (registration or authentication). */
    webauthnChallenge?: string;
  }
}

const PgSession = ConnectPgSimple(session);

const app: Express = express();

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

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

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
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
    },
  }),
);

app.use("/api", router);

export default app;
