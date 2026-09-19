import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// Minor accounts must have recorded parental consent before they can
// access protected upload functionality. Adult accounts are unaffected.
export async function requireParentConsent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session.userId;

  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select({
      isMinor: usersTable.isMinor,
      parentConsentGiven: usersTable.parentConsentGiven,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  if (user.isMinor && !user.parentConsentGiven) {
    res.status(403).json({
      error: "Parental consent is required",
      code: "PARENT_CONSENT_REQUIRED",
    });
    return;
  }

  next();
}