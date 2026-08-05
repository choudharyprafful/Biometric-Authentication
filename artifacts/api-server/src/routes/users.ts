import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserParams,
  EnrollFaceParams,
  EnrollFaceBody,
  EnrollFaceResponse,
  RemoveFaceParams,
  RemoveFaceResponse,
  ListUsersResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";

const router: IRouter = Router();

function requireAuth(req: import("express").Request, res: import("express").Response): number | null {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return userId;
}

function mapUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    faceEnrolled: user.faceEnrolled,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}

// GET /users
router.get("/users", async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (sessionUser?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  res.json(ListUsersResponse.parse(users.map(mapUser)));
});

// GET /users/:id
router.get("/users/:id", async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = GetUserParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Users can only see themselves, admins can see anyone
  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (sessionUser?.role !== "admin" && sessionUserId !== params.data.id) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(GetUserResponse.parse(mapUser(user)));
});

// PATCH /users/:id
router.patch("/users/:id", async (req, res): Promise<void> => {
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

  const updates: Partial<{ name: string; role: "user" | "admin" }> = {};
  if (body.data.name) updates.name = body.data.name;
  if (body.data.role) updates.role = body.data.role;

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logEvent({ eventType: "USER_UPDATED", details: `User ${user.email} updated`, userId: sessionUserId, userEmail: user.email });
  res.json(UpdateUserResponse.parse(mapUser(user)));
});

// DELETE /users/:id
router.delete("/users/:id", async (req, res): Promise<void> => {
  const sessionUserId = requireAuth(req, res);
  if (!sessionUserId) return;

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, sessionUserId));
  if (sessionUser?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = DeleteUserParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db.delete(usersTable).where(eq(usersTable.id, params.data.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logEvent({ eventType: "USER_DELETED", details: `User ${user.email} deleted by admin ${sessionUserId}`, userId: sessionUserId });
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

  const [user] = await db.update(usersTable).set({
    faceDescriptor: body.data.descriptor,
    faceEnrolled: true,
  }).where(eq(usersTable.id, params.data.id)).returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logEvent({ eventType: "FACE_ENROLLED", details: `Face biometric enrolled for ${user.email}`, userId: user.id, userEmail: user.email });
  res.json(EnrollFaceResponse.parse(mapUser(user)));
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

  const [user] = await db.update(usersTable).set({
    faceDescriptor: null,
    faceEnrolled: false,
  }).where(eq(usersTable.id, params.data.id)).returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logEvent({ eventType: "FACE_REMOVED", details: `Face enrollment removed for ${user.email}`, userId: sessionUserId, userEmail: user.email });
  res.json(RemoveFaceResponse.parse(mapUser(user)));
});

export default router;
