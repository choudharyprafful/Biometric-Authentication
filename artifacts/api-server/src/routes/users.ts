import { Router, type IRouter, type RequestHandler } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, count, sql } from "drizzle-orm";
import { db, usersTable, passkeysTable, passwordResetTokensTable, uploadsTable, biometricKeysTable, sessionsTable } from "@workspace/db";
import {
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserParams,
  DeleteUserBody,
  EnrollFaceParams,
  EnrollFaceBody,
  EnrollFaceResponse,
  RemoveFaceParams,
  RemoveFaceResponse,
  ListUsersResponse,
  ResetUserMfaParams,
  ResetUserMfaResponse,
  ClearPaymentHoldParams,
  ClearPaymentHoldResponse,
  StaffResetPasswordParams,
  StaffResetPasswordResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { mapUser } from "../lib/mapUser";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { encryptJson } from "../lib/fileEncryption";
import { hashResetToken, RESET_TOKEN_TTL_MS } from "./auth";
import { devAuthLinksEnabled } from "../lib/devLinks";

const router: IRouter = Router();

type Role = "user" | "admin" | "security_analyst" | "it_support";

// it_support can view/help-recover users but not change roles, delete accounts, or see the audit log — those stay admin/security_analyst-only.
function canManageUsers(role: Role | undefined): boolean {
  return role === "admin" || role === "it_support";
}

function requireAuth(req: import("express").Request, res: import("express").Response): number | null {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return userId;
}

// Deleting your own account must always be possible, like withdrawing consent (docs/05): an account that
// hasn't enrolled MFA yet, or a minor awaiting a parent, can still erase itself, confirmed by password in
// the handler. Deleting someone else is an admin action, so the gates still apply there.
function unlessDeletingSelf(gate: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
    if (req.session.userId !== undefined && Number(rawId) === req.session.userId) return next();
    return gate(req, res, next);
  };
}

router.get("/users", requireParentConsent, requireMfaEnrolled, async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (!canManageUsers(sessionUser?.role)) {
    res.status(403).json({ error: "Admin or IT support access required" });
    return;
  }

  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  res.json(ListUsersResponse.parse(await Promise.all(users.map(mapUser))));
});

router.get("/users/:id", requireParentConsent, requireMfaEnrolled, async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = GetUserParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Users can only see themselves; admin and it_support can see anyone
  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (!canManageUsers(sessionUser?.role) && sessionUserId !== params.data.id) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(GetUserResponse.parse(await mapUser(user)));
});

router.patch("/users/:id", requireParentConsent, requireMfaEnrolled, async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = UpdateUserParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  const isAdmin = sessionUser?.role === "admin";

  const body = UpdateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Users can only update themselves, admins can update anyone
  if (!isAdmin && sessionUserId !== params.data.id) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (body.data.role && !isAdmin) {
    res.status(403).json({ error: "Only admins can change roles" });
    return;
  }

  const updates: Partial<{ name: string; role: Role }> = {};
  if (body.data.name) updates.name = body.data.name;
  if (body.data.role) updates.role = body.data.role;

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logEvent({ eventType: "USER_UPDATED", details: `User ${user.email} updated`, userId: sessionUserId, userEmail: user.email });
  res.json(UpdateUserResponse.parse(await mapUser(user)));
});

// Uploads and passkeys cascade-delete; payments keep userId null (records outlive the account); security_logs keep userId as originally written — not a live FK, since mutating a hash-chained row after the fact breaks its hash (docs/04_Threat_Model_Risk_Assessment.md, R-LOG-3).
router.delete("/users/:id", unlessDeletingSelf(requireParentConsent), unlessDeletingSelf(requireMfaEnrolled), async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = DeleteUserParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const isSelf = sessionUserId === params.data.id;
  const [sessionUser] = await db.select().from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (!isSelf && sessionUser?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  // A session cookie alone shouldn't be enough to destroy the account; not required when an admin deletes someone else's account, since it's not their password.
  if (isSelf) {
    const body = DeleteUserBody.safeParse(req.body ?? {});
    const password = body.success ? body.data.password : undefined;
    const passwordValid = password && (await bcrypt.compare(password, sessionUser?.passwordHash ?? ""));
    if (!passwordValid) {
      res.status(401).json({ error: "Incorrect password — re-enter your password to confirm account deletion" });
      return;
    }
  }

  // Captured before the delete since cascade-deleted rows are otherwise uncountable afterward. None of this is sensitive content — just the shape of what's being removed, so the audit trail records what was lost, not just that something was.
  const [[{ uploadCount }], [{ passkeyCount }], [{ biometricKeyCount }]] = await Promise.all([
    db.select({ uploadCount: count() }).from(uploadsTable).where(eq(uploadsTable.userId, params.data.id)),
    db.select({ passkeyCount: count() }).from(passkeysTable).where(eq(passkeysTable.userId, params.data.id)),
    db.select({ biometricKeyCount: count() }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, params.data.id)),
  ]);

  // Passkeys, phone keys and signed-in sessions go in the same transaction as the account. Until
  // 2026-09-26 the two key tables had no foreign key, so deleting an account left its keys behind
  // (and its sessions until they expired) while this event claimed they were cascade-removed.
  const user = await db.transaction(async (tx) => {
    await tx.delete(passkeysTable).where(eq(passkeysTable.userId, params.data.id));
    await tx.delete(biometricKeysTable).where(eq(biometricKeysTable.userId, params.data.id));
    await tx.delete(sessionsTable).where(sql`${sessionsTable.sess} ->> 'userId' = ${String(params.data.id)}`);
    const [deleted] = await tx.delete(usersTable).where(eq(usersTable.id, params.data.id)).returning();
    return deleted;
  });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const deletedSummary = `role=${user.role}, faceEnrolled=${user.faceEnrolled}, subscriptionPlan=${user.subscriptionPlan}, uploads=${uploadCount}, passkeys=${passkeyCount}, biometricKeys=${biometricKeyCount}`;
  await logEvent({
    eventType: "USER_DELETED",
    details: `${isSelf ? `User ${user.email} deleted their own account` : `User ${user.email} deleted by admin ${sessionUserId}`} — cascade-removed: ${deletedSummary}`,
    userId: sessionUserId,
  });

  if (isSelf) {
    req.session.destroy(() => {});
  }

  res.sendStatus(204);
});

router.post("/users/:id/enroll-face", requireParentConsent, async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = EnrollFaceParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (sessionUserId !== params.data.id) {
    res.status(403).json({ error: "You can only enroll your own face" });
    return;
  }

  const body = EnrollFaceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (!body.data.descriptor || body.data.descriptor.length !== 128) {
    res.status(400).json({ error: "Invalid face descriptor — expected 128 values" });
    return;
  }

  // Biometric consent is separate from registration consent — storing a
  // face template needs its own explicit opt-in.
  if (!body.data.consent) {
    res.status(400).json({ error: "Biometric consent is required to enroll a face" });
    return;
  }

  const encryptedDescriptor = encryptJson(body.data.descriptor);
  const [user] = await db.update(usersTable).set({
    faceDescriptorCiphertext: encryptedDescriptor.ciphertext,
    faceDescriptorIv: encryptedDescriptor.iv,
    faceDescriptorAuthTag: encryptedDescriptor.authTag,
    faceEnrolled: true,
    biometricConsentGiven: true,
    biometricConsentAt: new Date(),
  }).where(eq(usersTable.id, params.data.id)).returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logEvent({ eventType: "FACE_ENROLLED", details: `Face biometric enrolled for ${user.email}`, userId: user.id, userEmail: user.email });
  res.json(EnrollFaceResponse.parse(await mapUser(user)));
});

router.delete("/users/:id/face", async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = RemoveFaceParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (sessionUserId !== params.data.id && sessionUser?.role !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Withdrawing consent deletes the data immediately — no "consent withdrawn but data retained" state.
  const [user] = await db.update(usersTable).set({
    faceDescriptorCiphertext: null,
    faceDescriptorIv: null,
    faceDescriptorAuthTag: null,
    faceEnrolled: false,
    biometricConsentGiven: false,
    biometricConsentAt: null,
  }).where(eq(usersTable.id, params.data.id)).returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logEvent({ eventType: "FACE_REMOVED", details: `Face enrollment removed (biometric consent withdrawn) for ${user.email}`, userId: sessionUserId, userEmail: user.email });
  res.json(RemoveFaceResponse.parse(await mapUser(user)));
});

// An admin decision, not IT support's: the hold follows a lost chargeback (lib/paymentLifecycle.ts).
router.delete("/users/:id/payment-hold", requireParentConsent, requireMfaEnrolled, async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = ClearPaymentHoldParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sessionUser] = await db.select({ role: usersTable.role, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (sessionUser?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const [before] = await db.select({ paymentHold: usersTable.paymentHold }).from(usersTable).where(eq(usersTable.id, params.data.id));
  const [user] = await db.update(usersTable).set({ paymentHold: false }).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (before?.paymentHold) {
    await logEvent({ eventType: "PAYMENT_HOLD_CLEARED", details: `Payment hold cleared for ${user.email} by admin ${sessionUser.email}`, userId: sessionUserId, userEmail: sessionUser.email });
  }
  res.json(ClearPaymentHoldResponse.parse(await mapUser(user)));
});

router.post("/users/:id/reset-mfa", requireParentConsent, requireMfaEnrolled, async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = ResetUserMfaParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (!canManageUsers(sessionUser?.role)) {
    res.status(403).json({ error: "Admin or IT support access required" });
    return;
  }

  const [user] = await db.update(usersTable).set({
    faceDescriptorCiphertext: null,
    faceDescriptorIv: null,
    faceDescriptorAuthTag: null,
    faceEnrolled: false,
    biometricConsentGiven: false,
    biometricConsentAt: null,
  }).where(eq(usersTable.id, params.data.id)).returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await db.delete(passkeysTable).where(eq(passkeysTable.userId, user.id));

  await logEvent({
    eventType: "MFA_RESET_BY_STAFF",
    details: `Face + passkey enrollment cleared for ${user.email} by ${sessionUser?.role} ${sessionUserId} — account routed back through enrollment`,
    userId: sessionUserId,
    userEmail: user.email,
  });
  res.json(ResetUserMfaResponse.parse(await mapUser(user)));
});

// Same token mechanism as /auth/forgot-password, triggered by staff instead of self.
router.post("/users/:id/reset-password", requireParentConsent, requireMfaEnrolled, async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = StaffResetPasswordParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (!canManageUsers(sessionUser?.role)) {
    res.status(403).json({ error: "Admin or IT support access required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash: hashResetToken(rawToken),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  await logEvent({
    eventType: "PASSWORD_RESET_REQUESTED",
    details: `Password reset issued for ${user.email} by ${sessionUser?.role} ${sessionUserId} (staff-initiated, not self-requested)`,
    userId: sessionUserId,
    userEmail: user.email,
  });

  // No email provider configured — handed back directly in local development only, instead of being silently unreachable (see lib/devLinks.ts).
  const devResetLink = devAuthLinksEnabled() ? `/reset-password?token=${rawToken}` : null;

  res.json(StaffResetPasswordResponse.parse({
    message: `Password reset link issued for ${user.email}.`,
    devResetLink,
  }));
});

export default router;
