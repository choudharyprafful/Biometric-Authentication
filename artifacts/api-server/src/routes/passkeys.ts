import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import { db, usersTable, passkeysTable, passwordResetTokensTable } from "@workspace/db";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { logEvent } from "../lib/auditLog";
import { MFA_CHALLENGE_TTL_MS, loadUsableResetToken } from "./auth";
import { ALLOWED_ORIGINS, isAllowedOrigin } from "../lib/allowedOrigins";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { ABSOLUTE_SESSION_MAX_MS } from "../lib/sessionPolicy";
import { getClientIp } from "../lib/clientIp";

// verifyRegistrationResponse/verifyAuthenticationResponse below do the real cryptographic verification of the WebAuthn response — Zod here only types the surrounding fields (bounded deviceName, primitive checks) before that call, so it doesn't duplicate or risk being stricter than the crypto check.
const WebAuthnResponseShape = z.looseObject({ id: z.string().min(1) });
const RegisterVerifyBody = z.object({ response: z.looseObject({}), deviceName: z.string().trim().min(1).max(100).optional() });
const LoginVerifyBody = z.object({ response: WebAuthnResponseShape });
const ResetPasskeyOptionsBody = z.object({ token: z.string().min(1) });
const ResetPasskeyVerifyBody = z.object({ response: WebAuthnResponseShape, newPassword: z.string().min(8) });

const router: IRouter = Router();

const RP_NAME = "SecureAI";

// Registering a passkey involves real WebAuthn attestation verification — throttle it per account so it can't be turned into a spam vector for unbounded passkey rows.
const passkeyRegisterRateLimit = requestRateLimit("passkey-register", 15, 5 * 60 * 1000);

// Validates against the same origin allowlist CORS enforces.
function getRp(req: Request): { rpID: string; origin: string } | null {
  const requestOrigin = req.headers.origin;
  if (typeof requestOrigin !== "string" || !isAllowedOrigin(requestOrigin)) return null;

  const exact = ALLOWED_ORIGINS.find((o) => o === requestOrigin);
  const hostname = exact ? new URL(exact).hostname : new URL(requestOrigin).hostname;
  return { rpID: hostname, origin: requestOrigin };
}

function requireRp(req: Request, res: import("express").Response): { rpID: string; origin: string } | null {
  const rp = getRp(req);
  if (!rp) {
    res.status(403).json({ error: "Origin not allowed for passkey operations" });
    return null;
  }
  return rp;
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

// Same pending-MFA TTL as face verification (auth.ts).
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

async function mapUser(user: typeof usersTable.$inferSelect) {
  const passkeys = await db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, user.id)).limit(1);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    faceEnrolled: user.faceEnrolled,
    passkeyEnrolled: passkeys.length > 0,
    dataConsentGiven: user.dataConsentGiven,
    biometricConsentGiven: user.biometricConsentGiven,
    parentConsentPending: user.parentGuardianEmail !== null && !user.parentConsentGiven,
    trainingConsentGiven: user.trainingConsentGiven,
    contentPersonalizationConsentGiven: user.contentPersonalizationConsentGiven,
    subscriptionPlan: user.subscriptionPlan,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}

// Enrollment routes below require a fully authenticated session.
router.post("/auth/passkey/register-options", requireParentConsent, async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  const rp = requireRp(req, res);
  if (!rp) return;
  const { rpID } = rp;
  const existing = await db.select().from(passkeysTable).where(eq(passkeysTable.userId, userId));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((pk) => ({ id: pk.credentialId })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required", // the biometric/PIN must unlock the key
    },
  });

  req.session.webauthnChallenge = options.challenge;
  try {
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not store challenge" });
    return;
  }
  res.json(options);
});

router.post("/auth/passkey/register-verify", requireParentConsent, passkeyRegisterRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId;
  const expectedChallenge = req.session.webauthnChallenge;
  if (!userId || !expectedChallenge) {
    res.status(401).json({ error: "No pending passkey registration" });
    return;
  }
  delete req.session.webauthnChallenge;

  const rp = requireRp(req, res);
  if (!rp) return;
  const { rpID, origin } = rp;
  const parsedBody = RegisterVerifyBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Missing WebAuthn response" });
    return;
  }
  const body = parsedBody.data;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as unknown as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    await saveSession(req).catch(() => {});
    res.status(400).json({ error: `Passkey verification failed: ${(e as Error).message}` });
    return;
  }

  if (!verification.verified || !verification.registrationInfo) {
    await saveSession(req).catch(() => {});
    res.status(400).json({ error: "Passkey could not be verified" });
    return;
  }

  const { credential } = verification.registrationInfo;
  await db.insert(passkeysTable).values({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceName: body.deviceName ?? null,
  });
  await saveSession(req).catch(() => {});

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  await logEvent({
    eventType: "PASSKEY_ENROLLED",
    details: `Passkey enrolled${body.deviceName ? ` (${body.deviceName})` : ""} for ${user?.email ?? userId}`,
    userId,
    userEmail: user?.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.status(201).json({ verified: true });
});

router.get("/auth/passkey/list", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const keys = await db.select().from(passkeysTable).where(eq(passkeysTable.userId, userId));
  res.json(
    keys.map((k) => ({
      id: k.id,
      deviceName: k.deviceName,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    })),
  );
});

router.delete("/auth/passkey/:id", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid passkey id" });
    return;
  }
  const [key] = await db.select().from(passkeysTable).where(eq(passkeysTable.id, id));
  if (!key || key.userId !== userId) {
    res.status(404).json({ error: "Passkey not found" });
    return;
  }
  await db.delete(passkeysTable).where(eq(passkeysTable.id, id));

  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
  await logEvent({
    eventType: "PASSKEY_REMOVED",
    details: `Passkey removed${key.deviceName ? ` (${key.deviceName})` : ""} for ${user?.email ?? userId}`,
    userId,
    userEmail: user?.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.sendStatus(204);
});

// Login second-factor routes below require the pending-MFA session from password login.
router.post("/auth/passkey/login-options", async (req, res): Promise<void> => {
  const pendingUserId = req.session.pendingUserId;
  if (!pendingUserId) {
    res.status(401).json({ error: "No pending login" });
    return;
  }
  if (!(await pendingMfaValid(req, res))) return;
  const rp = requireRp(req, res);
  if (!rp) return;
  const { rpID } = rp;

  const keys = await db.select().from(passkeysTable).where(eq(passkeysTable.userId, pendingUserId));
  if (keys.length === 0) {
    res.status(404).json({ error: "No passkeys enrolled" });
    return;
  }
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: keys.map((k) => ({ id: k.credentialId })),
  });

  req.session.webauthnChallenge = options.challenge;
  try {
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not store challenge" });
    return;
  }
  res.json(options);
});

router.post("/auth/passkey/login-verify", async (req, res): Promise<void> => {
  const pendingUserId = req.session.pendingUserId;
  const expectedChallenge = req.session.webauthnChallenge;
  const ip = getClientIp(req);
  if (!pendingUserId || !expectedChallenge) {
    res.status(401).json({ error: "No pending login" });
    return;
  }
  if (!(await pendingMfaValid(req, res))) return;
  delete req.session.webauthnChallenge;

  const parsedBody = LoginVerifyBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Missing WebAuthn response" });
    return;
  }
  const body = parsedBody.data;

  const [key] = await db
    .select()
    .from(passkeysTable)
    .where(eq(passkeysTable.credentialId, body.response.id));
  if (!key || key.userId !== pendingUserId) {
    await logEvent({ eventType: "LOGIN_PASSKEY_FAILED", details: "Passkey login: unknown credential", userId: pendingUserId, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Unknown passkey" });
    return;
  }

  const rp = requireRp(req, res);
  if (!rp) return;
  const { rpID, origin } = rp;
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response as unknown as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: key.credentialId,
        publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")),
        counter: key.counter,
        transports: (key.transports as import("@simplewebauthn/server").AuthenticatorTransportFuture[] | null) ?? undefined,
      },
    });
  } catch (e) {
    await logEvent({ eventType: "LOGIN_PASSKEY_FAILED", details: `Passkey login failed: ${(e as Error).message}`, userId: pendingUserId, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Passkey verification failed" });
    return;
  }

  if (!verification.verified) {
    await logEvent({ eventType: "LOGIN_PASSKEY_FAILED", details: "Passkey signature invalid", userId: pendingUserId, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Passkey verification failed" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, pendingUserId));
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  await db
    .update(passkeysTable)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeysTable.id, key.id));

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

  await logEvent({ eventType: "LOGIN_PASSKEY_SUCCESS", details: `Passkey MFA passed for ${user.email} — device-held key signed the server challenge`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json({ verified: true, user: await mapUser(user) });
});

// A reset link alone never changes the password — the account's passkey must also sign a fresh server challenge, same crypto-gated proof as login MFA (see auth.ts reset-password/face for the face-scan equivalent).
router.post("/auth/reset-password/passkey-options", async (req, res): Promise<void> => {
  const parsedBody = ResetPasskeyOptionsBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Missing reset token" });
    return;
  }
  const body = parsedBody.data;

  const record = await loadUsableResetToken(body.token);
  if (!record) {
    res.status(400).json({ error: "Invalid or expired reset link" });
    return;
  }

  const rp = requireRp(req, res);
  if (!rp) return;
  const { rpID } = rp;

  const keys = await db.select().from(passkeysTable).where(eq(passkeysTable.userId, record.userId));
  if (keys.length === 0) {
    res.status(404).json({ error: "No passkeys enrolled for this account" });
    return;
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: keys.map((k) => ({ id: k.credentialId })),
  });

  req.session.webauthnChallenge = options.challenge;
  req.session.resetToken = body.token;
  try {
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not store challenge" });
    return;
  }
  res.json(options);
});

router.post("/auth/reset-password/passkey-verify", async (req, res): Promise<void> => {
  const resetToken = req.session.resetToken;
  const expectedChallenge = req.session.webauthnChallenge;
  const ip = getClientIp(req);
  if (!resetToken || !expectedChallenge) {
    res.status(401).json({ error: "No pending reset" });
    return;
  }
  delete req.session.webauthnChallenge;
  delete req.session.resetToken;

  const record = await loadUsableResetToken(resetToken);
  if (!record) {
    res.status(400).json({ error: "Invalid or expired reset link" });
    return;
  }

  const parsedBody = ResetPasskeyVerifyBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Missing passkey response or new password" });
    return;
  }
  const body = parsedBody.data;

  const [key] = await db.select().from(passkeysTable).where(eq(passkeysTable.credentialId, body.response.id));
  if (!key || key.userId !== record.userId) {
    await logEvent({ eventType: "PASSWORD_RESET_PASSKEY_FAILED", details: "Reset passkey verify: unknown credential", userId: record.userId, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Unknown passkey" });
    return;
  }

  const rp = requireRp(req, res);
  if (!rp) return;
  const { rpID, origin } = rp;
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response as unknown as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: key.credentialId,
        publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")),
        counter: key.counter,
        transports: (key.transports as import("@simplewebauthn/server").AuthenticatorTransportFuture[] | null) ?? undefined,
      },
    });
  } catch (e) {
    await logEvent({ eventType: "PASSWORD_RESET_PASSKEY_FAILED", details: `Reset passkey verify failed: ${(e as Error).message}`, userId: record.userId, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Passkey verification failed" });
    return;
  }

  if (!verification.verified) {
    await logEvent({ eventType: "PASSWORD_RESET_PASSKEY_FAILED", details: "Reset passkey signature invalid", userId: record.userId, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Passkey verification failed" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, record.userId));
  if (!user) {
    res.status(400).json({ error: "Account no longer exists" });
    return;
  }

  await db.update(passkeysTable).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(passkeysTable.id, key.id));

  const passwordHash = await bcrypt.hash(body.newPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
  // Consume the token immediately — a reset link is single-use.
  await db.update(passwordResetTokensTable).set({ usedAt: new Date() }).where(eq(passwordResetTokensTable.id, record.id));

  await logEvent({ eventType: "PASSWORD_RESET_COMPLETED", details: `Password reset completed for ${user.email} (passkey-verified)`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json({ success: true });
});

export default router;
