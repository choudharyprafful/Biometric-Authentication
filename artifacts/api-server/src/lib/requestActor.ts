import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getClientIp } from "./clientIp";
import type { Actor } from "./aiGovernance";

export type Role = "user" | "admin" | "security_analyst" | "it_support";

// Returns the signed-in account as an audit-log actor, or answers 401/403 and returns null.
export async function actorFor(
  req: Request,
  res: Response,
  roles?: Role[],
): Promise<Actor | null> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  const [user] = await db
    .select({ email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return null;
  }
  if (roles && !roles.includes(user.role as Role)) {
    res.status(403).json({
      error:
        roles.length === 1
          ? "Administrators only"
          : "Security analysts and administrators only",
    });
    return null;
  }
  return {
    userId,
    email: user.email,
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"],
  };
}
