import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// R-PAY-5: one network address could register 10 throwaway accounts an hour, each a fresh free
// account for uploads and payments (card testing is the usual abuse). Only those two need a
// confirmed address; signing in, setting up MFA, and every privacy right (consent withdrawal,
// export, deletion) never wait for it. A DB read per request, like requireParentConsent: the link
// is usually opened in another browser or on another device, so a session-cached value would go stale.
export async function requireVerifiedEmail(
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
    .select({ emailVerified: usersTable.emailVerified })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  if (!user.emailVerified) {
    res.status(403).json({
      error:
        "Confirm your email address first: open the link we emailed you when you signed up. If it has expired, send a new one from your dashboard.",
      code: "EMAIL_VERIFICATION_REQUIRED",
    });
    return;
  }

  next();
}
