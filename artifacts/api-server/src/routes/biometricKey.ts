import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, passkeysTable, biometricKeysTable } from "@workspace/db";
import { logEvent } from "../lib/auditLog";
import { MFA_CHALLENGE_TTL_MS } from "./auth";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { checkAndRecordRequest } from "../lib/rateLimit";
import { ABSOLUTE_SESSION_MAX_MS } from "../lib/sessionPolicy";

const router: IRouter = Router();

// Registering a key involves a real signature-verification round trip —
// throttle it per account, same reasoning as passkeyRegisterRateLimit.
const biometricRegisterRateLimit = requestRateLimit("biometric-key-register", 15, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Cross-device linking — lets an already-MFA'd session (e.g. web, with face
// or a passkey enrolled) bootstrap a NEW device's biometric key without that
// new device needing to satisfy MFA on its own first. Without this, an
// account enrolled only on web can never sign in on mobile, since mobile has
// no face-capture UI and (by definition) doesn't have a biometric key for
// that account yet — an unbreakable chicken-and-egg problem otherwise.
// ---------------------------------------------------------------------------

const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_CODE_REDEEM_MAX_ATTEMPTS_PER_IP = 10;
const LINK_CODE_REDEEM_WINDOW_MS = 5 * 60 * 1000;

interface PendingLinkCode {
  userId: number;
  expiresAt: number;
}

// In-memory, single-process — acceptable because codes are short-lived (5
// min) and single-use; a server restart just invalidates any codes in
// flight, same tradeoff the session store already makes for dev.
const pendingLinkCodes = new Map<string, PendingLinkCode>();

function generateLinkCode(): string {
  return crypto.randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars, ~40 bits of entropy
}

const linkCodeCreateRateLimit = requestRateLimit("biometric-key-link-create", 10, 10 * 60 * 1000);

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

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

async function mapUser(user: typeof usersTable.$inferSelect) {
  const [passkeys, keys] = await Promise.all([
    db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, user.id)).limit(1),
    db.select({ id: biometricKeysTable.id }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, user.id)).limit(1),
  ]);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    faceEnrolled: user.faceEnrolled,
    passkeyEnrolled: passkeys.length > 0 || keys.length > 0,
    dataConsentGiven: user.dataConsentGiven,
    biometricConsentGiven: user.biometricConsentGiven,
    subscriptionPlan: user.subscriptionPlan,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}

/** Verify an RSA-SHA256 (PKCS#1 v1.5) signature — react-native-biometrics'
 *  documented signing scheme for Android Keystore-backed keys. `publicKeyB64`
 *  is the raw base64 DER (SubjectPublicKeyInfo) the library returns from
 *  createKeys(), not PEM — converted here via the DER/SPKI import form. */
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

// ---------------------------------------------------------------------------
// Enrollment (requires a fully authenticated session)
// ---------------------------------------------------------------------------

// POST /auth/biometric-key/register-challenge
router.post("/auth/biometric-key/register-challenge", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const challenge = crypto.randomBytes(32).toString("base64url");
  req.session.webauthnChallenge = challenge; // reuses the same session slot passkeys.ts uses
  try {
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not store challenge" });
    return;
  }
  res.json({ challenge });
});

// POST /auth/biometric-key/register
router.post("/auth/biometric-key/register", biometricRegisterRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId;
  const expectedChallenge = req.session.webauthnChallenge;
  if (!userId || !expectedChallenge) {
    res.status(401).json({ error: "No pending biometric key registration" });
    return;
  }
  delete req.session.webauthnChallenge;

  const body = req.body as { publicKey?: string; signature?: string; deviceName?: string };
  if (!body?.publicKey || !body.signature) {
    res.status(400).json({ error: "Missing public key or signature" });
    return;
  }

  // Proves possession of the private key the enrollment claims to hold —
  // the phone just signed our own challenge with the brand-new Keystore
  // key, before we ever trust its public half.
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

// ---------------------------------------------------------------------------
// Login second factor (requires the pending-MFA session from password login)
// ---------------------------------------------------------------------------

// POST /auth/biometric-key/login-options
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

// POST /auth/biometric-key/login-verify
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

  const body = req.body as { signature?: string };
  if (!body?.signature) {
    res.status(400).json({ error: "Missing signature" });
    return;
  }

  const keys = await db.select().from(biometricKeysTable).where(eq(biometricKeysTable.userId, pendingUserId));
  // A device only ever has one key, but iterate in case of re-enrollment —
  // whichever key's public half matches the signature is the one that signed it.
  const matched = keys.find((k) => verifyBiometricSignature(k.publicKey, expectedChallenge, body.signature as string));

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

  await logEvent({ eventType: "LOGIN_PASSKEY_SUCCESS", details: `Biometric key MFA passed for ${user.email} — device-held key signed the server challenge`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json({ verified: true, user: await mapUser(user) });
});

// ---------------------------------------------------------------------------
// Cross-device linking endpoints
// ---------------------------------------------------------------------------

// POST /auth/biometric-key/create-link-code
// Requires a fully-authenticated session (already past this account's MFA
// by whatever means it enrolled — face, passkey, or an existing biometric
// key). That's the entire security basis for the unauthenticated redeem
// step below: only someone who already proved they own the account can mint
// a code for it.
router.post("/auth/biometric-key/create-link-code", linkCodeCreateRateLimit, async (req, res): Promise<void> => {
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

// POST /auth/biometric-key/redeem-link-code
// Deliberately unauthenticated — this IS the bootstrap step a brand-new
// device calls. Security rests on the code being short-lived, single-use,
// ~40 bits of entropy, IP-rate-limited here, and only ever mintable by a
// session that already passed full MFA (the endpoint above).
router.post("/auth/biometric-key/redeem-link-code", async (req, res): Promise<void> => {
  const ip = getClientIp(req);
  const reservation = checkAndRecordRequest(`link-redeem-ip:${ip}`, LINK_CODE_REDEEM_MAX_ATTEMPTS_PER_IP, LINK_CODE_REDEEM_WINDOW_MS);
  if (!reservation.allowed) {
    res.setHeader("Retry-After", String(reservation.retryAfterSeconds ?? 60));
    await logEvent({ eventType: "RATE_LIMIT_HIT", details: "Rate limit hit for device link code redemption", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(429).json({ error: "Too many attempts — please slow down and try again shortly." });
    return;
  }

  const body = req.body as { code?: string; publicKey?: string; signature?: string; deviceName?: string };
  const code = body?.code?.trim().toUpperCase();
  if (!code || !body.publicKey || !body.signature) {
    res.status(400).json({ error: "Missing code, public key, or signature" });
    return;
  }

  const entry = pendingLinkCodes.get(code);
  if (!entry || entry.expiresAt < Date.now()) {
    pendingLinkCodes.delete(code);
    await logEvent({ eventType: "DEVICE_LINK_REDEEMED", details: "Device link redemption failed — invalid or expired code", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(400).json({ error: "Invalid or expired code" });
    return;
  }
  pendingLinkCodes.delete(code); // single-use regardless of outcome below

  // The code itself is the signed payload — it's random and was just
  // consumed above, so there's no separate challenge/replay window to close.
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
