import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, usersTable, biometricKeysTable } from "@workspace/db";
import { logEvent } from "../lib/auditLog";
import { mapUser } from "../lib/mapUser";
import { MFA_CHALLENGE_TTL_MS } from "./auth";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { checkAndRecordRequest } from "../lib/rateLimit";
import { ABSOLUTE_SESSION_MAX_MS } from "../lib/sessionPolicy";
import { enforceSessionLimit } from "../lib/sessionLimit";
import { getClientIp } from "../lib/clientIp";

const router: IRouter = Router();

// publicKey/signature are base64 strings react-native-biometrics hands back directly. Bounds below are generous relative to a real RSA-2048 DER public key (~392 base64 chars) or signature (~344 base64 chars).
const deviceNameSchema = z.string().trim().min(1).max(100).optional();
const RegisterKeyBody = z.object({ publicKey: z.string().min(1).max(4096), signature: z.string().min(1).max(4096), deviceName: deviceNameSchema });
const LoginVerifyKeyBody = z.object({ signature: z.string().min(1).max(4096) });
const RedeemLinkCodeBody = z.object({ code: z.string().min(1).max(64), publicKey: z.string().min(1).max(4096), signature: z.string().min(1).max(4096), deviceName: deviceNameSchema });

// Registering a key involves a real signature-verification round trip — throttle it per account, same reasoning as passkeyRegisterRateLimit.
const biometricRegisterRateLimit = requestRateLimit("biometric-key-register", 15, 5 * 60 * 1000);

// Cross-device linking lets an already-MFA'd session bootstrap a NEW device's biometric key without that device satisfying MFA on its own first — otherwise an account enrolled only on web could never sign in on mobile (no face-capture UI, and no biometric key yet for that account).

const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_CODE_REDEEM_MAX_ATTEMPTS_PER_IP = 10;
const LINK_CODE_REDEEM_WINDOW_MS = 5 * 60 * 1000;

interface PendingLinkCode {
  userId: number;
  expiresAt: number;
}

// In-memory, single-process — acceptable since codes are short-lived and single-use; a restart just invalidates codes in flight, same tradeoff the session store already makes for dev.
const pendingLinkCodes = new Map<string, PendingLinkCode>();

function generateLinkCode(): string {
  return crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars, ~40 bits of entropy
}

const linkCodeCreateRateLimit = requestRateLimit("biometric-key-link-create", 10, 10 * 60 * 1000);

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

async function pendingMfaValid(req: Request, res: import("express").Response): Promise<boolean> {
  if (!req.session.mfaIssuedAt || Date.now() - req.session.mfaIssuedAt > MFA_CHALLENGE_TTL_MS) {
    try {
      await destroySession(req);
    } catch {
      res.status(500).json({ error: "Could not invalidate the expired challenge — please try again" });
      return false;
    }
    res.status(401).json({ error: "Verification window expired — please log in again" });
    return false;
  }
  return true;
}

// RSA-SHA256 (PKCS#1 v1.5) — react-native-biometrics' documented signing scheme for Android Keystore-backed keys. publicKeyB64 is raw base64 DER (SubjectPublicKeyInfo) from createKeys(), not PEM.
function verifyBiometricSignature(publicKeyB64: string, payload: string, signatureB64: string): boolean {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    return crypto.verify("RSA-SHA256", Buffer.from(payload, "utf8"), publicKey, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// Enrollment routes below require a fully authenticated session.
router.post("/auth/biometric-key/register-challenge", requireParentConsent, async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const challenge = crypto.randomBytes(32).toString("base64url");
  req.session.webauthnChallenge = challenge; // same session slot passkeys.ts uses
  try {
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not store challenge" });
    return;
  }
  res.json({ challenge });
});

router.post("/auth/biometric-key/register", requireParentConsent, biometricRegisterRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId;
  const expectedChallenge = req.session.webauthnChallenge;
  if (!userId || !expectedChallenge) {
    res.status(401).json({ error: "No pending biometric key registration" });
    return;
  }
  delete req.session.webauthnChallenge;

  const parsedBody = RegisterKeyBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Missing public key or signature" });
    return;
  }
  const body = parsedBody.data;

  // Proves possession of the private key — the phone signed our challenge with the brand-new Keystore key before we ever trust its public half.
  if (!verifyBiometricSignature(body.publicKey, expectedChallenge, body.signature)) {
    await saveSession(req).catch(() => {});
    res.status(400).json({ error: "Signature verification failed" });
    return;
  }

  await db.insert(biometricKeysTable).values({
    userId,
    publicKey: body.publicKey,
    deviceName: body.deviceName ?? null,
  });
  await saveSession(req).catch(() => {});

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  await logEvent({
    eventType: "PASSKEY_ENROLLED",
    details: `Device biometric key enrolled${body.deviceName ? ` (${body.deviceName})` : ""} for ${user?.email ?? userId}`,
    userId,
    userEmail: user?.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.status(201).json({ verified: true });
});

// Login second-factor routes below require the pending-MFA session from password login.
router.post("/auth/biometric-key/login-options", async (req, res): Promise<void> => {
  const pendingUserId = req.session.pendingUserId;
  if (!pendingUserId) {
    res.status(401).json({ error: "No pending login" });
    return;
  }
  if (!(await pendingMfaValid(req, res))) return;

  const keys = await db.select().from(biometricKeysTable).where(eq(biometricKeysTable.userId, pendingUserId));
  if (keys.length === 0) {
    res.status(404).json({ error: "No biometric keys enrolled" });
    return;
  }

  const challenge = crypto.randomBytes(32).toString("base64url");
  req.session.webauthnChallenge = challenge;
  try {
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not store challenge" });
    return;
  }
  res.json({ challenge });
});

router.post("/auth/biometric-key/login-verify", async (req, res): Promise<void> => {
  const pendingUserId = req.session.pendingUserId;
  const expectedChallenge = req.session.webauthnChallenge;
  const ip = getClientIp(req);
  if (!pendingUserId || !expectedChallenge) {
    res.status(401).json({ error: "No pending login" });
    return;
  }
  if (!(await pendingMfaValid(req, res))) return;
  delete req.session.webauthnChallenge;

  const parsedBody = LoginVerifyKeyBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Missing signature" });
    return;
  }
  const body = parsedBody.data;

  const keys = await db.select().from(biometricKeysTable).where(eq(biometricKeysTable.userId, pendingUserId));
  // A device only ever has one key, but iterate in case of re-enrollment.
  const matched = keys.find((k) => verifyBiometricSignature(k.publicKey, expectedChallenge, body.signature));

  if (!matched) {
    await logEvent({ eventType: "LOGIN_PASSKEY_FAILED", details: "Biometric key login: signature did not verify against any enrolled key", userId: pendingUserId, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Biometric key verification failed" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, pendingUserId));
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  await db.update(biometricKeysTable).set({ lastUsedAt: new Date() }).where(eq(biometricKeysTable.id, matched.id));

  try {
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.absoluteExpiresAt = Date.now() + ABSOLUTE_SESSION_MAX_MS;
    delete req.session.pendingUserId;
    delete req.session.tempToken;
    delete req.session.mfaIssuedAt;
    delete req.session.mfaAttempts;
    delete req.session.webauthnChallenge;
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not establish an authenticated session" });
    return;
  }

  await enforceSessionLimit(req, user);

  await logEvent({ eventType: "LOGIN_PASSKEY_SUCCESS", details: `Biometric key MFA passed for ${user.email} — device-held key signed the server challenge`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json({ verified: true, user: await mapUser(user) });
});

// Requires a fully-authenticated session (already past this account's MFA via face, passkey, or biometric key) — that's the entire security basis for the unauthenticated redeem step below.
router.post("/auth/biometric-key/create-link-code", requireParentConsent, linkCodeCreateRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const code = generateLinkCode();
  pendingLinkCodes.set(code, { userId, expiresAt: Date.now() + LINK_CODE_TTL_MS });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  await logEvent({
    eventType: "DEVICE_LINK_CODE_CREATED",
    details: `Device link code generated for ${user?.email ?? userId}`,
    userId,
    userEmail: user?.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.json({ code, expiresAt: Date.now() + LINK_CODE_TTL_MS });
});

// Deliberately unauthenticated — this is the bootstrap step a brand-new device calls. Security rests on the code being short-lived, single-use, ~40 bits of entropy, IP-rate-limited, and only mintable by a session that already passed full MFA.
router.post("/auth/biometric-key/redeem-link-code", async (req, res): Promise<void> => {
  const ip = getClientIp(req);
  const reservation = checkAndRecordRequest(`link-redeem-ip:${ip}`, LINK_CODE_REDEEM_MAX_ATTEMPTS_PER_IP, LINK_CODE_REDEEM_WINDOW_MS);
  if (!reservation.allowed) {
    res.setHeader("Retry-After", String(reservation.retryAfterSeconds ?? 60));
    await logEvent({ eventType: "RATE_LIMIT_HIT", details: "Rate limit hit for device link code redemption", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(429).json({ error: "Too many attempts — please slow down and try again shortly." });
    return;
  }

  const parsedBody = RedeemLinkCodeBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Missing code, public key, or signature" });
    return;
  }
  const body = parsedBody.data;
  const code = body.code.trim().toUpperCase();

  const entry = pendingLinkCodes.get(code);
  if (!entry || entry.expiresAt < Date.now()) {
    pendingLinkCodes.delete(code);
    await logEvent({ eventType: "DEVICE_LINK_REDEEMED", details: "Device link redemption failed — invalid or expired code", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }
  pendingLinkCodes.delete(code); // single-use regardless of outcome below

  // The code itself is the signed payload — random and already consumed above, so there's no separate challenge/replay window to close.
  if (!verifyBiometricSignature(body.publicKey, code, body.signature)) {
    await logEvent({ eventType: "DEVICE_LINK_REDEEMED", details: "Device link redemption failed — signature did not verify", userId: entry.userId, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(400).json({ error: "Signature verification failed" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, entry.userId));
  if (!user) {
    res.status(400).json({ error: "Account no longer exists" });
    return;
  }

  await db.insert(biometricKeysTable).values({
    userId: user.id,
    publicKey: body.publicKey,
    deviceName: body.deviceName ?? null,
  });

  try {
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.absoluteExpiresAt = Date.now() + ABSOLUTE_SESSION_MAX_MS;
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not establish an authenticated session" });
    return;
  }

  await enforceSessionLimit(req, user);

  await logEvent({
    eventType: "DEVICE_LINK_REDEEMED",
    details: `New device linked and biometric key enrolled for ${user.email}${body.deviceName ? ` (${body.deviceName})` : ""}`,
    userId: user.id,
    userEmail: user.email,
    ipAddress: ip,
    userAgent: req.headers["user-agent"],
  });

  res.status(201).json({ verified: true, user: await mapUser(user) });
});

export default router;
