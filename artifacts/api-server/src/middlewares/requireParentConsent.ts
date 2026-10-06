import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// A DB read per request, not a session-cached flag, deliberately: consent
// is granted by a DIFFERENT actor (the parent, in their own browser) than
// the session being gated, so a value cached at registration time would go
// stale the moment a parent approves. A pending-consent account still gets
// a session (see auth.ts) so it can check /auth/me and log out; only
// everything else behind this middleware is blocked.
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
      parentGuardianEmail: usersTable.parentGuardianEmail,
      parentConsentGiven: usersTable.parentConsentGiven,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  if (user.parentGuardianEmail !== null && !user.parentConsentGiven) {
    res.status(403).json({
      error:
        "Parent/guardian consent is required before this account can be used",
      code: "PARENT_CONSENT_REQUIRED",
    });
    return;
  }

  next();
}
