import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable, passkeysTable, passwordResetTokensTable } from "@workspace/db";
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
  StaffResetPasswordParams,
  StaffResetPasswordResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { encryptJson } from "../lib/fileEncryption";
import { hashResetToken, RESET_TOKEN_TTL_MS } from "./auth";

const router: IRouter = Router();

type Role = "user" | "admin" | "security_analyst" | "it_support";

// it_support can view/help-recover users but not change roles, delete
// accounts, or see the audit log — those stay admin/security_analyst-only.
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
    subscriptionPlan: user.subscriptionPlan,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}

// GET /users
router.get("/users", requireMfaEnrolled, async (req, res): Promise<void> => {
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

// GET /users/:id
router.get("/users/:id", requireMfaEnrolled, async (req, res): Promise<void> => {
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

// PATCH /users/:id
router.patch("/users/:id", requireMfaEnrolled, async (req, res): Promise<void> => {
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

  // Only admins can change roles
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

// DELETE /users/:id — self-service or admin removal. Uploads and passkeys
// cascade-delete; payments keep userId set to null (records outlive the
// account); security_logs keep userId as originally written — not a live
// FK, since mutating a hash-chained row after the fact breaks its hash
// (see docs/04_Threat_Model_Risk_Assessment.md, R-LOG-3).
router.delete("/users/:id", requireMfaEnrolled, async (req, res): Promise<void> => {
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

  // Self-deletion requires re-entering the password — a session cookie
  // alone shouldn't be enough to destroy the account. Not required when an
  // admin deletes someone else's account, since it's not their password.
  if (isSelf) {
    const body = DeleteUserBody.safeParse(req.body ?? {});
    const password = body.success ? body.data.password : undefined;
    const passwordValid = password && (await bcrypt.compare(password, sessionUser?.passwordHash ?? ""));
    if (!passwordValid) {
      res.status(401).json({ error: "Incorrect password — re-enter your password to confirm account deletion" });
      return;
    }
  }

  const [user] = await db.delete(usersTable).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logEvent({
    eventType: "USER_DELETED",
    details: isSelf ? `User ${user.email} deleted their own account` : `User ${user.email} deleted by admin ${sessionUserId}`,
    userId: sessionUserId,
  });

  if (isSelf) {
    req.session.destroy(() => {});
  }

  res.sendStatus(204);
});

// POST /users/:id/enroll-face
router.post("/users/:id/enroll-face", async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = EnrollFaceParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Can only enroll own face
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

// DELETE /users/:id/face
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

  // Withdrawing consent deletes the data immediately — no "consent
  // withdrawn but data retained" state.
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

// POST /users/:id/reset-mfa — admin/it_support only. Clears both the face
// descriptor and every enrolled passkey in one call, routing the user back
// through /enroll on next login.
router.post("/users/:id/reset-mfa", requireMfaEnrolled, async (req, res): Promise<void> => {
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

// POST /users/:id/reset-password — admin/it_support only. Same token
// mechanism as /auth/forgot-password, triggered by staff instead of self.
router.post("/users/:id/reset-password", requireMfaEnrolled, async (req, res): Promise<void> => {
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

  // Same demo constraint as self-service forgot-password: no email provider
  // configured, so the link is handed back directly outside production
  // instead of being silently unreachable.
  const devResetLink = process.env["NODE_ENV"] !== "production" ? `/reset-password?token=${rawToken}` : null;

  res.json(StaffResetPasswordResponse.parse({
    message: `Password reset link issued for ${user.email}.`,
    devResetLink,
  }));
});

export default router;
