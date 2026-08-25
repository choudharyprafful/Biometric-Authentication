import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, passkeysTable, biometricKeysTable, passwordResetTokensTable, sessionsTable } from "@workspace/db";
import {
  RegisterUserBody,
  RegisterUserResponse,
  LoginUserBody,
  LoginUserResponse,
  FaceVerifyBody,
  FaceVerifyResponse,
  GetCurrentUserResponse,
  ForgotPasswordBody,
  ForgotPasswordResponse,
  VerifyResetTokenBody,
  VerifyResetTokenResponse,
  ResetPasswordWithFaceBody,
  ResetPasswordWithFaceResponse,
  LogoutAllDevicesResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { isFaceMatch } from "../lib/faceUtils";
import { decryptJson } from "../lib/fileEncryption";
import { checkAndRecordRequest, releaseAttempt, clearAttempts } from "../lib/rateLimit";
import { ABSOLUTE_SESSION_MAX_MS } from "../lib/sessionPolicy";

const router: IRouter = Router();

// Used to burn comparable time on a "user not found" login so response
// timing can't be used to enumerate registered emails (CWE-208).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-for-constant-time-comparison", 12);

// Face MFA hardening: challenges expire and allow a limited number of attempts.
export const MFA_CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESET_MAX_ATTEMPTS = 5;

// Credential-stuffing / brute-force defense on the password login step.
// Per-account cap stops targeted brute force; the looser per-IP cap stops
// a single source rotating through many stolen email:password pairs.
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 5;
const LOGIN_MAX_ATTEMPTS_PER_IP = 20;

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
const MFA_MAX_ATTEMPTS = 3;
const FACE_DESCRIPTOR_LENGTH = 128;

function clearPendingMfa(req: Request): void {
  delete req.session.pendingUserId;
  delete req.session.tempToken;
  delete req.session.mfaIssuedAt;
  delete req.session.mfaAttempts;
}

// Destroy the server-side session entirely — guarantees a pending MFA
// challenge cannot be reused even if a later save were to fail.
function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

// Serialize face-verify per session so concurrent requests cannot race the
// attempt counter (single-process server, so an in-memory lock suffices).
const activeFaceVerifications = new Set<string>();

function isValidDescriptor(descriptor: number[]): boolean {
  return (
    descriptor.length === FACE_DESCRIPTOR_LENGTH &&
    descriptor.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

// Regenerate the session ID to prevent session fixation when privileges change.
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function mapUser(user: typeof usersTable.$inferSelect) {
  const [passkeys, biometricKeys] = await Promise.all([
    db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, user.id)).limit(1),
    db.select({ id: biometricKeysTable.id }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, user.id)).limit(1),
  ]);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    faceEnrolled: user.faceEnrolled,
    passkeyEnrolled: passkeys.length > 0 || biometricKeys.length > 0,
    dataConsentGiven: user.dataConsentGiven,
    biometricConsentGiven: user.biometricConsentGiven,
    subscriptionPlan: user.subscriptionPlan,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}

// GET /auth/me
router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Session invalid" });
    return;
  }
  res.json(GetCurrentUserResponse.parse(await mapUser(user)));
});

// POST /auth/register
router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, name, password, dataConsent } = parsed.data;

  if (!dataConsent) {
    res.status(400).json({ error: "Data-processing consent is required to register" });
    return;
  }

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (existing.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(),
    name,
    passwordHash,
    role: "user",
    dataConsentGiven: true,
    dataConsentAt: new Date(),
  }).returning();

  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

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
    eventType: "REGISTER",
    details: `New user registered: ${email}`,
    userId: user.id,
    userEmail: user.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.status(201).json(RegisterUserResponse.parse({
    user: await mapUser(user),
    token: "authenticated",
  }));
});

// POST /auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, password } = parsed.data;
  const ip = getClientIp(req);
  const normalizedEmail = email.toLowerCase();
  const ipKey = `login-ip:${ip}`;
  const emailKey = `login-email:${normalizedEmail}`;

  // Reserve atomically before any async work (DB lookup, bcrypt compare),
  // otherwise concurrent requests can all pass the check before any of
  // them records — see rateLimit.ts. A successful login releases its own
  // reservation below.
  const ipReservation = checkAndRecordRequest(ipKey, LOGIN_MAX_ATTEMPTS_PER_IP, LOGIN_RATE_WINDOW_MS);
  const emailReservation = checkAndRecordRequest(emailKey, LOGIN_MAX_ATTEMPTS_PER_ACCOUNT, LOGIN_RATE_WINDOW_MS);
  if (!ipReservation.allowed || !emailReservation.allowed) {
    const retryAfterSeconds = Math.max(ipReservation.retryAfterSeconds ?? 0, emailReservation.retryAfterSeconds ?? 0);
    await logEvent({ eventType: "RATE_LIMIT_HIT", details: `Login rate limit hit for ${email} (${!emailReservation.allowed ? "account" : "IP"} threshold)`, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ error: "Too many failed login attempts — please try again later" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));
  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH); // burn timing-equivalent work — see DUMMY_PASSWORD_HASH comment
    await logEvent({ eventType: "LOGIN_FAILED", details: `Failed login attempt for ${email} — user not found`, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    await logEvent({ eventType: "LOGIN_FAILED", details: `Failed login for ${email} — wrong password`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Correct password: release this attempt's IP reservation (other
  // accounts' failures against the same IP stay counted) and fully clear
  // the per-account counter.
  releaseAttempt(ipKey);
  clearAttempts(emailKey);

  const [userPasskeys, userBiometricKeys] = await Promise.all([
    db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, user.id)),
    db.select({ id: biometricKeysTable.id }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, user.id)),
  ]);
  const hasPasskey = userPasskeys.length > 0 || userBiometricKeys.length > 0;

  if (user.faceEnrolled || hasPasskey) {
    // Step 1 complete — a second factor (face scan and/or passkey) is required
    const tempToken = crypto.randomUUID();
    try {
      await regenerateSession(req);
      req.session.pendingUserId = user.id;
      req.session.tempToken = tempToken;
      req.session.mfaIssuedAt = Date.now();
      req.session.mfaAttempts = 0;
      delete req.session.userId;
      await saveSession(req);
    } catch {
      res.status(500).json({ error: "Could not begin biometric verification" });
      return;
    }

    await logEvent({ eventType: "LOGIN_SUCCESS", details: `Password verified for ${email}; awaiting MFA (${[user.faceEnrolled ? "face" : null, hasPasskey ? "passkey" : null].filter(Boolean).join(", ")})`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

    res.json(LoginUserResponse.parse({
      requiresFaceVerification: true,
      faceAvailable: user.faceEnrolled,
      passkeyAvailable: hasPasskey,
      tempToken,
      user: await mapUser(user),
    }));
  } else {
    // No face enrolled — full session immediately
    try {
      await regenerateSession(req);
      req.session.userId = user.id;
      req.session.absoluteExpiresAt = Date.now() + ABSOLUTE_SESSION_MAX_MS;
      delete req.session.pendingUserId;
      delete req.session.tempToken;
      await saveSession(req);
    } catch {
      res.status(500).json({ error: "Could not establish an authenticated session" });
      return;
    }

    await logEvent({ eventType: "LOGIN_SUCCESS", details: `Login successful for ${email} (no face MFA)`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

    res.json(LoginUserResponse.parse({
      requiresFaceVerification: false,
      faceAvailable: false,
      passkeyAvailable: false,
      tempToken: null,
      user: await mapUser(user),
    }));
  }
});

// POST /auth/face-verify
router.post("/auth/face-verify", async (req, res): Promise<void> => {
  const parsed = FaceVerifyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { descriptor, tempToken } = parsed.data;
  const ip = getClientIp(req);

  // Serialize verification attempts per session (prevents attempt-counter races)
  const sessionId = req.session.id;
  if (activeFaceVerifications.has(sessionId)) {
    res.status(429).json({ error: "Verification already in progress" });
    return;
  }
  activeFaceVerifications.add(sessionId);

  try {
  if (!req.session.pendingUserId || !req.session.tempToken || req.session.tempToken !== tempToken) {
    await logEvent({ eventType: "LOGIN_FACE_FAILED", details: "Face verify: invalid or expired temp token", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Invalid or expired verification token" });
    return;
  }

  // Challenge expiry — the face scan must happen shortly after password login
  if (!req.session.mfaIssuedAt || Date.now() - req.session.mfaIssuedAt > MFA_CHALLENGE_TTL_MS) {
    try {
      await destroySession(req);
    } catch {
      res.status(500).json({ error: "Could not invalidate the expired challenge — please try again" });
      return;
    }
    await logEvent({ eventType: "LOGIN_FACE_FAILED", details: "Face verify: challenge expired", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Verification window expired — please log in again" });
    return;
  }

  // Strict server-side descriptor validation (reject malformed/forged payloads)
  if (!isValidDescriptor(descriptor)) {
    await logEvent({ eventType: "LOGIN_FACE_FAILED", details: "Face verify: malformed descriptor rejected", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(400).json({ error: "Invalid face data" });
    return;
  }

  const userId = req.session.pendingUserId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  if (!user || !user.faceEnrolled || !user.faceDescriptorCiphertext || !user.faceDescriptorIv || !user.faceDescriptorAuthTag) {
    // Face MFA cannot complete — but the challenge may still be completable
    // with a passkey or biometric key, so only destroy the session when
    // neither exists.
    const [userPasskeys, userBiometricKeys] = user
      ? await Promise.all([
          db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, user.id)),
          db.select({ id: biometricKeysTable.id }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, user.id)),
        ])
      : [[], []];
    if (userPasskeys.length > 0 || userBiometricKeys.length > 0) {
      res.status(400).json({ error: "Face not enrolled — use your device passkey instead" });
      return;
    }
    // This challenge can never complete — invalidate it
    await destroySession(req).catch(() => {});
    res.status(401).json({ error: "User face not enrolled" });
    return;
  }

  const storedDescriptor = decryptJson<number[]>({
    ciphertext: user.faceDescriptorCiphertext,
    iv: user.faceDescriptorIv,
    authTag: user.faceDescriptorAuthTag,
  });
  const match = isFaceMatch(descriptor, storedDescriptor);

  if (!match) {
    const attempts = (req.session.mfaAttempts ?? 0) + 1;
    req.session.mfaAttempts = attempts;

    if (attempts >= MFA_MAX_ATTEMPTS) {
      // Too many failed scans — destroy the session so the challenge cannot be reused
      try {
        await destroySession(req);
      } catch {
        res.status(500).json({ error: "Could not invalidate the challenge — please try again" });
        return;
      }
      await logEvent({ eventType: "LOGIN_FACE_FAILED", details: `Face verification locked for ${user.email} after ${attempts} failed attempts`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });
      res.status(401).json({ error: "Too many failed scans — please log in again" });
      return;
    }

    try {
      await saveSession(req);
    } catch {
      res.status(500).json({ error: "Could not record the failed attempt — please try again" });
      return;
    }
    await logEvent({ eventType: "LOGIN_FACE_FAILED", details: `Face verification failed for ${user.email} (attempt ${attempts}/${MFA_MAX_ATTEMPTS})`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: `Face verification failed — ${MFA_MAX_ATTEMPTS - attempts} attempt(s) remaining` });
    return;
  }

  try {
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.absoluteExpiresAt = Date.now() + ABSOLUTE_SESSION_MAX_MS;
    clearPendingMfa(req);
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not establish an authenticated session" });
    return;
  }

  await logEvent({ eventType: "LOGIN_FACE_SUCCESS", details: `Biometric MFA passed for ${user.email}`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json(FaceVerifyResponse.parse({
    user: await mapUser(user),
    token: "authenticated",
  }));
  } finally {
    activeFaceVerifications.delete(sessionId);
  }
});

// POST /auth/forgot-password
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email } = parsed.data;
  const ip = getClientIp(req);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));

  // Same response whether or not the account exists — don't let this
  // endpoint be used to enumerate registered emails.
  let devResetLink: string | null = null;
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });

    const link = `/reset-password?token=${rawToken}`;
    await logEvent({ eventType: "PASSWORD_RESET_REQUESTED", details: `Password reset requested for ${email}`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

    // No email provider is configured for this demo — in production this
    // link would be emailed, never returned over the API. Outside
    // production we hand it back directly so the flow is clickable.
    if (process.env["NODE_ENV"] !== "production") {
      devResetLink = link;
    }
  }

  res.json(ForgotPasswordResponse.parse({
    message: "If that email is registered, a password reset link has been issued.",
    devResetLink,
  }));
});

/** Loads a reset-token record by its raw token, only if still usable
 *  (exists, unused, unexpired, under the attempt cap). */
export async function loadUsableResetToken(token: string) {
  const [record] = await db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, hashResetToken(token)));
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now() || record.attempts >= RESET_MAX_ATTEMPTS) {
    return null;
  }
  return record;
}

// POST /auth/reset-password/verify — a reset link alone never changes the
// password; this only reports which second factor (face/passkey) the
// frontend should collect next, mirroring login MFA rather than trusting
// mere possession of the link.
router.post("/auth/reset-password/verify", async (req, res): Promise<void> => {
  const parsed = VerifyResetTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const record = await loadUsableResetToken(parsed.data.token);
  if (!record) {
    res.status(400).json({ error: "Invalid or expired reset link" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, record.userId));
  const userPasskeys = await db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, record.userId));

  res.json(VerifyResetTokenResponse.parse({
    faceAvailable: user?.faceEnrolled ?? false,
    passkeyAvailable: userPasskeys.length > 0,
  }));
});

// POST /auth/reset-password/face — completes the reset only if a live face
// scan matches the account's enrolled descriptor. Attempts are capped on
// the token itself (mirrors the login face-MFA attempt limit).
router.post("/auth/reset-password/face", async (req, res): Promise<void> => {
  const parsed = ResetPasswordWithFaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { token, descriptor, newPassword } = parsed.data;
  const ip = getClientIp(req);

  const record = await loadUsableResetToken(token);
  if (!record) {
    res.status(400).json({ error: "Invalid or expired reset link" });
    return;
  }

  if (!isValidDescriptor(descriptor)) {
    res.status(400).json({ error: "Invalid face data" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, record.userId));
  if (!user || !user.faceEnrolled || !user.faceDescriptorCiphertext || !user.faceDescriptorIv || !user.faceDescriptorAuthTag) {
    res.status(400).json({ error: "No face enrolled for this account" });
    return;
  }

  const storedDescriptor = decryptJson<number[]>({
    ciphertext: user.faceDescriptorCiphertext,
    iv: user.faceDescriptorIv,
    authTag: user.faceDescriptorAuthTag,
  });
  const match = isFaceMatch(descriptor, storedDescriptor);
  if (!match) {
    const attempts = record.attempts + 1;
    await db.update(passwordResetTokensTable).set({ attempts }).where(eq(passwordResetTokensTable.id, record.id));
    await logEvent({ eventType: "PASSWORD_RESET_FACE_FAILED", details: `Reset face verification failed for ${user.email} (attempt ${attempts}/${RESET_MAX_ATTEMPTS})`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: `Face did not match — ${RESET_MAX_ATTEMPTS - attempts} attempt(s) remaining` });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
  // Consume the token immediately — a reset link is single-use.
  await db.update(passwordResetTokensTable).set({ usedAt: new Date() }).where(eq(passwordResetTokensTable.id, record.id));

  await logEvent({ eventType: "PASSWORD_RESET_COMPLETED", details: `Password reset completed for ${user.email} (face-verified)`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json(ResetPasswordWithFaceResponse.parse({ success: true }));
});

// POST /auth/logout
router.post("/auth/logout", (req, res): void => {
  const userId = req.session.userId;
  req.session.destroy(() => {});
  if (userId) {
    logEvent({ eventType: "LOGOUT", details: `User ${userId} logged out`, userId });
  }
  res.sendStatus(204);
});

// POST /auth/logout-all — deletes every persisted session row for this
// account, so a stolen device can be locked out from another device
// without needing a password change.
router.post("/auth/logout-all", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const deleted = await db
    .delete(sessionsTable)
    .where(sql`${sessionsTable.sess} ->> 'userId' = ${String(userId)}`)
    .returning({ sid: sessionsTable.sid });

  const ip = getClientIp(req);
  await logEvent({
    eventType: "LOGOUT_ALL",
    details: `User ${userId} signed out of all devices (${deleted.length} session(s) terminated)`,
    userId,
    ipAddress: ip,
    userAgent: req.headers["user-agent"],
  });

  // Own session row is already deleted above; this clears the cookie side.
  req.session.destroy(() => {});
  res.json(LogoutAllDevicesResponse.parse({ terminatedSessions: deleted.length }));
});

export default router;
