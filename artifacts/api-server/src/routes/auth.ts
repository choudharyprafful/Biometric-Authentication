import { Router, type IRouter, type Request } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, passkeysTable, biometricKeysTable, passwordResetTokensTable, parentConsentTokensTable, sessionsTable } from "@workspace/db";
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
  VerifyParentConsentBody,
  VerifyParentConsentResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { mapUser } from "../lib/mapUser";
import { faceMatchDistance, FACE_MATCH_THRESHOLD } from "../lib/faceUtils";
import { decryptJson } from "../lib/fileEncryption";
import { checkAndRecordRequest, releaseAttempt, clearAttempts } from "../lib/rateLimit";
import { enforceSessionLimit } from "../lib/sessionLimit";
import { PRIVACY_POLICY_VERSION, acknowledgementDetails } from "../lib/privacyPolicy";
import { ABSOLUTE_SESSION_MAX_MS } from "../lib/sessionPolicy";
import { assessLoginRisk, type LoginRiskCode } from "../lib/loginRiskModel";
import { isAiSystemEnabled } from "../lib/aiGovernance";

const LOGIN_RISK_WORDING: Record<LoginRiskCode, string> = {
  new_network: "a network this account has not signed in from before",
  new_device: "a browser or device this account has not used before",
  rapid_network_change: "a different network shortly after another sign-in",
  unusual_time: "an unusual time of day for this account",
};
import { devAuthLinksEnabled } from "../lib/devLinks";
import { sendMail, appUrl } from "../lib/mailer";
import { getClientIp } from "../lib/clientIp";

const router: IRouter = Router();

// Burns comparable time on a "user not found" login so response timing can't be used to enumerate registered emails (CWE-208).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-for-constant-time-comparison", 12);

export const MFA_CHALLENGE_TTL_MS = 2 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

// Self-reported age, not ID-verified (docs/05_Consent_and_Deletion_Design.md). Threshold is Team 2's policy call (docs/08_Requests_to_Team2.md).
const MINOR_CONSENT_AGE_THRESHOLD = 18;
// Not a time-pressured security action like a password reset, hence much longer TTL than RESET_TOKEN_TTL_MS.
const PARENT_CONSENT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Server-side only — never trust a client-reported "is adult" claim.
function computeAge(dateOfBirthIso: string): number {
  const dob = new Date(dateOfBirthIso);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

// Per-account cap stops targeted brute force; the looser per-IP cap stops a single source rotating through many stolen email:password pairs.
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 5;
const LOGIN_MAX_ATTEMPTS_PER_IP = 20;

// Registration is anonymous (no account to key by yet), so it's keyed by IP like the login IP cap, but looser since a shared IP (office, campus, NAT) can mean many legitimate one-time signups.
const REGISTER_RATE_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX_ATTEMPTS_PER_IP = 10;

// Closes the residual gap R-AUTH-6 stated openly: the reset TTL and attempt cap bounded how guessable an issued token was, but nothing bounded how MANY could be issued. Each request does real work (token generation, a DB insert, an audit write, and now an SMTP send), and an unbounded flood also means an unbounded volume of reset mail to a victim's inbox. Per-account is the tighter cap since that's the thing being targeted; per-IP is looser for the same shared-NAT reason registration is.
const RESET_REQUEST_RATE_WINDOW_MS = 60 * 60 * 1000;
const RESET_REQUEST_MAX_PER_ACCOUNT = 5;
const RESET_REQUEST_MAX_PER_IP = 20;

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

// Guarantees a pending MFA challenge cannot be reused even if a later save were to fail.
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

// Serializes face-verify per session so concurrent requests can't race the attempt counter (single-process server, so an in-memory lock suffices).
const activeFaceVerifications = new Set<string>();

function isValidDescriptor(descriptor: number[]): boolean {
  return (
    descriptor.length === FACE_DESCRIPTOR_LENGTH &&
    descriptor.every((v) => typeof v === "number" && Number.isFinite(v))
  );
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

router.post("/auth/register", async (req, res): Promise<void> => {
  const ip = getClientIp(req);
  const ipReservation = checkAndRecordRequest(`register:ip:${ip}`, REGISTER_MAX_ATTEMPTS_PER_IP, REGISTER_RATE_WINDOW_MS);
  if (!ipReservation.allowed) {
    await logEvent({ eventType: "RATE_LIMIT_HIT", details: "Registration rate limit hit (IP threshold)", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.set("Retry-After", String(ipReservation.retryAfterSeconds ?? 3600));
    res.status(429).json({ error: "Too many registration attempts from this network — please try again later" });
    return;
  }

  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, name, password, dataConsent, dateOfBirth, parentGuardianEmail, trainingConsent, privacyPolicyVersion } = parsed.data;

  if (!dataConsent) {
    res.status(400).json({ error: "Data-processing consent is required to register" });
    return;
  }

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime()) || dob.getTime() > Date.now()) {
    res.status(400).json({ error: "Date of birth is missing or not a valid date" });
    return;
  }
  const age = computeAge(dateOfBirth);
  if (age < 0 || age > 130) {
    res.status(400).json({ error: "Date of birth is not plausible" });
    return;
  }
  const isMinor = age < MINOR_CONSENT_AGE_THRESHOLD;
  if (isMinor && !parentGuardianEmail?.trim()) {
    res.status(400).json({ error: `A parent/guardian email is required to register under age ${MINOR_CONSENT_AGE_THRESHOLD}` });
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
    dateOfBirth,
    parentGuardianEmail: isMinor ? parentGuardianEmail!.trim().toLowerCase() : null,
    parentConsentGiven: false,
    // Opt-in, unlike dataConsent above — separate flag from dataConsentGiven (see lib/db/src/schema/users.ts).
    trainingConsentGiven: trainingConsent === true,
    trainingConsentAt: trainingConsent === true ? new Date() : null,
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
    details: `New user registered: ${email}${isMinor ? ` (minor — age ${age}, parental consent pending from ${user.parentGuardianEmail})` : ""}`,
    userId: user.id,
    userEmail: user.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  // Only the current version counts: an older or missing one (e.g. an older mobile build) means the
  // person is asked to review the policy after signing in instead.
  if (privacyPolicyVersion === PRIVACY_POLICY_VERSION) {
    await logEvent({
      eventType: "PRIVACY_POLICY_ACKNOWLEDGED",
      details: acknowledgementDetails(PRIVACY_POLICY_VERSION, "registration"),
      userId: user.id,
      userEmail: user.email,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
  }

  // Same audit event as the settings toggle (routes/behavior.ts) — keeps the trail consistent regardless of which screen granted it.
  if (trainingConsent === true) {
    await logEvent({
      eventType: "TRAINING_CONSENT_GIVEN",
      details: `Granted at registration for ${email}`,
      userId: user.id,
      userEmail: user.email,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
  }

  // No email provider configured — in production this would be emailed to the parent/guardian, never returned over the API.
  let devParentConsentLink: string | null = null;
  if (isMinor) {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    await db.insert(parentConsentTokensTable).values({
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + PARENT_CONSENT_TOKEN_TTL_MS),
    });
    const link = `/parent-consent?token=${rawToken}`;
    await logEvent({
      eventType: "MINOR_REGISTRATION_PENDING_CONSENT",
      details: `Registration for ${email} is pending parental consent from ${user.parentGuardianEmail}`,
      userId: user.id,
      userEmail: user.email,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    if (devAuthLinksEnabled()) {
      devParentConsentLink = link;
    }
    await sendMail(
      user.parentGuardianEmail!,
      "Parental consent required — SecureAI",
      `${email} has registered for a SecureAI account and needs your consent as parent/guardian before it can be used.\n\nConfirm here: ${appUrl(link)}\n\nThis link expires in 7 days.`,
    );
  }

  res.status(201).json(RegisterUserResponse.parse({
    user: await mapUser(user),
    token: "authenticated",
    devParentConsentLink,
  }));
});

router.post("/auth/parent-consent/verify", async (req, res): Promise<void> => {
  const parsed = VerifyParentConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { token } = parsed.data;
  const ip = getClientIp(req);
  const tokenHash = hashResetToken(token);

  const [record] = await db.select().from(parentConsentTokensTable).where(eq(parentConsentTokensTable.tokenHash, tokenHash));
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "Invalid or expired consent link" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, record.userId));
  if (!user) {
    res.status(400).json({ error: "Account no longer exists" });
    return;
  }

  await db.update(usersTable).set({ parentConsentGiven: true, parentConsentAt: new Date() }).where(eq(usersTable.id, user.id));
  await db.update(parentConsentTokensTable).set({ usedAt: new Date() }).where(eq(parentConsentTokensTable.id, record.id));

  await logEvent({
    eventType: "PARENT_CONSENT_GRANTED",
    details: `Parent/guardian consent confirmed for ${user.email} (by ${user.parentGuardianEmail})`,
    userId: user.id,
    userEmail: user.email,
    ipAddress: ip,
    userAgent: req.headers["user-agent"],
  });

  res.json(VerifyParentConsentResponse.parse({ verified: true, childEmail: user.email }));
});

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

  // Reserved atomically before any async work, otherwise concurrent requests could all pass the check before any of them records (see rateLimit.ts).
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
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH); // burn timing-equivalent work (see DUMMY_PASSWORD_HASH)
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

  // Release this attempt's IP reservation (other accounts' failures against the same IP still count) and fully clear the per-account counter.
  releaseAttempt(ipKey);
  clearAttempts(emailKey);

  // Runs on every successful password check, whether or not a second factor follows, so risk is captured at the moment it's knowable, not only for accounts without MFA.
  // An administrator's off switch (lib/aiGovernance.ts): no scoring, no warning, no flag.
  const riskAssessment = (await isAiSystemEnabled("login-risk"))
    ? await assessLoginRisk(user.id, ip, req.headers["user-agent"])
    : { level: "low" as const, reasons: [], codes: [] };
  if (riskAssessment.level !== "low") {
    await logEvent({
      eventType: "LOGIN_RISK_FLAGGED",
      details: `Login risk ${riskAssessment.level} for ${email}: ${riskAssessment.reasons.join("; ")}`,
      userId: user.id,
      userEmail: user.email,
      ipAddress: ip,
      userAgent: req.headers["user-agent"],
    });
  }
  // Says what the automated check saw (Team 2: transparency and explainability), in the account owner's
  // terms. The signals are about the owner's own sign-ins, so naming them tells an attacker nothing new.
  const securityNotice = riskAssessment.level === "high"
    ? `Automated sign-in check: this sign-in came from ${riskAssessment.codes.map((c) => LOGIN_RISK_WORDING[c]).join(", and ")}. If this wasn't you, reset your password now. If it was you, you can ignore this, or challenge the check on the How SecureAI uses AI page.`
    : null;

  const [userPasskeys, userBiometricKeys] = await Promise.all([
    db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, user.id)),
    db.select({ id: biometricKeysTable.id }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, user.id)),
  ]);
  const hasPasskey = userPasskeys.length > 0 || userBiometricKeys.length > 0;

  if (user.faceEnrolled || hasPasskey) {
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
      securityNotice,
    }));
  } else {
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

    await enforceSessionLimit(req, user);

    await logEvent({ eventType: "LOGIN_SUCCESS", details: `Login successful for ${email} (no face MFA)`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

    res.json(LoginUserResponse.parse({
      requiresFaceVerification: false,
      faceAvailable: false,
      passkeyAvailable: false,
      tempToken: null,
      user: await mapUser(user),
      securityNotice,
    }));
  }
});

router.post("/auth/face-verify", async (req, res): Promise<void> => {
  const parsed = FaceVerifyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { descriptor, tempToken } = parsed.data;
  const ip = getClientIp(req);

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

  if (!isValidDescriptor(descriptor)) {
    await logEvent({ eventType: "LOGIN_FACE_FAILED", details: "Face verify: malformed descriptor rejected", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(400).json({ error: "Invalid face data" });
    return;
  }

  const userId = req.session.pendingUserId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  if (!user || !user.faceEnrolled || !user.faceDescriptorCiphertext || !user.faceDescriptorIv || !user.faceDescriptorAuthTag) {
    // Face MFA can't complete, but the challenge may still be completable via passkey/biometric key, so only destroy the session when neither exists.
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
    await destroySession(req).catch(() => {});
    res.status(401).json({ error: "User face not enrolled" });
    return;
  }

  const storedDescriptor = decryptJson<number[]>({
    ciphertext: user.faceDescriptorCiphertext,
    iv: user.faceDescriptorIv,
    authTag: user.faceDescriptorAuthTag,
  });
  // Reused for the audit-log line below — faceVerificationAnomaly.ts parses "dist=" back out of FAILED rows to distinguish a wildly-off mismatch from a probing/spoofing pattern clustered just above threshold.
  const distance = faceMatchDistance(descriptor, storedDescriptor);
  const match = distance < FACE_MATCH_THRESHOLD;

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
      await logEvent({ eventType: "LOGIN_FACE_FAILED", details: `Face verification locked for ${user.email} after ${attempts} failed attempts (dist=${distance.toFixed(4)})`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });
      res.status(401).json({ error: "Too many failed scans — please log in again" });
      return;
    }

    try {
      await saveSession(req);
    } catch {
      res.status(500).json({ error: "Could not record the failed attempt — please try again" });
      return;
    }
    await logEvent({ eventType: "LOGIN_FACE_FAILED", details: `Face verification failed for ${user.email} (attempt ${attempts}/${MFA_MAX_ATTEMPTS}, dist=${distance.toFixed(4)})`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });
    // Says an AI model made the call and what to do instead; never the match distance, which would help an attacker probing the threshold.
    res.status(401).json({ error: `The face-matching model did not recognise this scan as your enrolled face. Face the camera in even light and try again, or use your passkey instead — ${MFA_MAX_ATTEMPTS - attempts} attempt(s) remaining` });
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

  await enforceSessionLimit(req, user);

  await logEvent({ eventType: "LOGIN_FACE_SUCCESS", details: `Biometric MFA passed for ${user.email} (dist=${distance.toFixed(4)})`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json(FaceVerifyResponse.parse({
    user: await mapUser(user),
    token: "authenticated",
  }));
  } finally {
    activeFaceVerifications.delete(sessionId);
  }
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email } = parsed.data;
  const ip = getClientIp(req);
  const normalizedEmail = email.toLowerCase();

  // Keyed on the SUBMITTED email and checked BEFORE the user lookup, deliberately: keying on a found user (or checking after the lookup) would make a rate-limited response reachable only for addresses that actually exist, reintroducing by the back door exactly the enumeration the identical-response rule below exists to prevent. Keyed this way, a flood against a non-existent address is throttled identically to one against a real account.
  const resetIpReservation = checkAndRecordRequest(`reset-req:ip:${ip}`, RESET_REQUEST_MAX_PER_IP, RESET_REQUEST_RATE_WINDOW_MS);
  const resetEmailReservation = checkAndRecordRequest(`reset-req:email:${normalizedEmail}`, RESET_REQUEST_MAX_PER_ACCOUNT, RESET_REQUEST_RATE_WINDOW_MS);
  if (!resetIpReservation.allowed || !resetEmailReservation.allowed) {
    const retryAfterSeconds = Math.max(resetIpReservation.retryAfterSeconds ?? 0, resetEmailReservation.retryAfterSeconds ?? 0);
    await logEvent({ eventType: "RATE_LIMIT_HIT", details: `Password reset request rate limit hit for ${email} (${!resetEmailReservation.allowed ? "account" : "IP"} threshold)`, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ error: "Too many password reset requests — please try again later" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

  // Same response whether or not the account exists — prevents email enumeration.
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

    // devAuthLinksEnabled() is an allow-list, not a NODE_ENV check (see lib/devLinks.ts) — it only controls whether the link is ALSO returned over the API for local testing without a mail server.
    if (devAuthLinksEnabled()) {
      devResetLink = link;
    }
    await sendMail(
      user.email,
      "Reset your SecureAI password",
      `A password reset was requested for your account. This link expires in 30 minutes:\n\n${appUrl(link)}\n\nIf you didn't request this, you can safely ignore this email.`,
    );
  }

  res.json(ForgotPasswordResponse.parse({
    message: "If that email is registered, a password reset link has been issued.",
    devResetLink,
  }));
});

// "Usable": exists, unused, unexpired, and under the attempt cap.
export async function loadUsableResetToken(token: string) {
  const [record] = await db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, hashResetToken(token)));
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now() || record.attempts >= RESET_MAX_ATTEMPTS) {
    return null;
  }
  return record;
}

// A reset link alone never changes the password — this only reports which second factor (face/passkey) to collect next, mirroring login MFA rather than trusting mere possession of the link.
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

// Attempts are capped on the token itself (mirrors the login face-MFA attempt limit).
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
  const resetDistance = faceMatchDistance(descriptor, storedDescriptor);
  const match = resetDistance < FACE_MATCH_THRESHOLD;
  if (!match) {
    const attempts = record.attempts + 1;
    await db.update(passwordResetTokensTable).set({ attempts }).where(eq(passwordResetTokensTable.id, record.id));
    await logEvent({ eventType: "PASSWORD_RESET_FACE_FAILED", details: `Reset face verification failed for ${user.email} (attempt ${attempts}/${RESET_MAX_ATTEMPTS}, dist=${resetDistance.toFixed(4)})`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: `The face-matching model did not recognise this scan as your enrolled face. Try again in even light, or verify with your passkey instead — ${RESET_MAX_ATTEMPTS - attempts} attempt(s) remaining` });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));
  // Consume the token immediately — a reset link is single-use.
  await db.update(passwordResetTokensTable).set({ usedAt: new Date() }).where(eq(passwordResetTokensTable.id, record.id));

  await logEvent({ eventType: "PASSWORD_RESET_COMPLETED", details: `Password reset completed for ${user.email} (face-verified)`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json(ResetPasswordWithFaceResponse.parse({ success: true }));
});

router.post("/auth/logout", (req, res): void => {
  const userId = req.session.userId;
  req.session.destroy(() => {});
  if (userId) {
    logEvent({ eventType: "LOGOUT", details: `User ${userId} logged out`, userId });
  }
  res.sendStatus(204);
});

// Deletes every persisted session row for this account, so a stolen device can be locked out without needing a password change.
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
