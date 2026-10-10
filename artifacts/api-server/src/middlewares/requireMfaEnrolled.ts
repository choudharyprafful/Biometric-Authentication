import type { NextFunction, Request, Response } from "express";
import { eq, count } from "drizzle-orm";
import {
  db,
  usersTable,
  passkeysTable,
  biometricKeysTable,
} from "@workspace/db";

// Blocks access until MFA enrollment is complete — face descriptor, passkey,
// or device biometric key, any one satisfies it. Not AND: a person chooses
// one at enrolment (on the phone app, fingerprint or face), and someone
// without a camera, or whom the face model fails, has only a key, so
// requiring both would permanently lock them out. Standard 2FA is password + one additional
// factor; requiring both here would be a third factor, stricter than what's
// actually asked for. The frontend already redirects unenrolled users to
// /enroll, but that's just UX — this is the server-side enforcement so a
// direct API call can't skip it.
export async function requireMfaEnrolled(
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
    .select({ faceEnrolled: usersTable.faceEnrolled })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  if (user.faceEnrolled) {
    next();
    return;
  }

  const [passkeyCount] = await db
    .select({ count: count() })
    .from(passkeysTable)
    .where(eq(passkeysTable.userId, userId));
  if (Number(passkeyCount?.count ?? 0) > 0) {
    next();
    return;
  }

  const [biometricKeyCount] = await db
    .select({ count: count() })
    .from(biometricKeysTable)
    .where(eq(biometricKeysTable.userId, userId));
  if (Number(biometricKeyCount?.count ?? 0) === 0) {
    res.status(403).json({
      error: "Face, passkey, or device biometric key enrollment required",
      code: "MFA_ENROLLMENT_REQUIRED",
    });
    return;
  }

  next();
}
