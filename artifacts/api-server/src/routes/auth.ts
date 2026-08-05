import { Router, type IRouter, type Request } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  RegisterUserBody,
  RegisterUserResponse,
  LoginUserBody,
  LoginUserResponse,
  FaceVerifyBody,
  FaceVerifyResponse,
  GetCurrentUserResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { isFaceMatch } from "../lib/faceUtils";

const router: IRouter = Router();

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
  res.json(GetCurrentUserResponse.parse(mapUser(user)));
});

// POST /auth/register
router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { email, name, password } = parsed.data;

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
  }).returning();

  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  try {
    await regenerateSession(req);
    req.session.userId = user.id;
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
    user: mapUser(user),
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

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (!user) {
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

  if (user.faceEnrolled) {
    // Step 1 complete — face verification required
    const tempToken = crypto.randomUUID();
    try {
      await regenerateSession(req);
      req.session.pendingUserId = user.id;
      req.session.tempToken = tempToken;
      delete req.session.userId;
      await saveSession(req);
    } catch {
      res.status(500).json({ error: "Could not begin biometric verification" });
      return;
    }

    await logEvent({ eventType: "LOGIN_SUCCESS", details: `Password verified for ${email}; awaiting face MFA`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

    res.json(LoginUserResponse.parse({
      requiresFaceVerification: true,
      tempToken,
      user: mapUser(user),
    }));
  } else {
    // No face enrolled — full session immediately
    try {
      await regenerateSession(req);
      req.session.userId = user.id;
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
      tempToken: null,
      user: mapUser(user),
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

  if (!req.session.pendingUserId || !req.session.tempToken || req.session.tempToken !== tempToken) {
    await logEvent({ eventType: "LOGIN_FACE_FAILED", details: "Face verify: invalid or expired temp token", ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Invalid or expired verification token" });
    return;
  }

  const userId = req.session.pendingUserId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  if (!user || !user.faceEnrolled || !user.faceDescriptor) {
    res.status(401).json({ error: "User face not enrolled" });
    return;
  }

  const storedDescriptor = user.faceDescriptor as number[];
  const match = isFaceMatch(descriptor, storedDescriptor);

  if (!match) {
    await logEvent({ eventType: "LOGIN_FACE_FAILED", details: `Face verification failed for ${user.email}`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });
    res.status(401).json({ error: "Face verification failed — please try again" });
    return;
  }

  try {
    await regenerateSession(req);
    req.session.userId = user.id;
    delete req.session.pendingUserId;
    delete req.session.tempToken;
    await saveSession(req);
  } catch {
    res.status(500).json({ error: "Could not establish an authenticated session" });
    return;
  }

  await logEvent({ eventType: "LOGIN_FACE_SUCCESS", details: `Biometric MFA passed for ${user.email}`, userId: user.id, userEmail: user.email, ipAddress: ip, userAgent: req.headers["user-agent"] });

  res.json(FaceVerifyResponse.parse({
    user: mapUser(user),
    token: "authenticated",
  }));
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

export default router;
