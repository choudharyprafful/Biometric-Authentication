import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, passkeysTable, biometricKeysTable } from "@workspace/db";
import { SetContentPersonalizationConsentBody, SetContentPersonalizationConsentResponse, GetContentProfileResponse } from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { buildContentProfile } from "../lib/contentPersonalizationModel";
import { getClientIp } from "../lib/clientIp";

const router: IRouter = Router();

async function mapUser(user: typeof usersTable.$inferSelect) {
  const [passkeys, biometricKeys] = await Promise.all([
    db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, user.id)).limit(1),
    db.select({ id: biometricKeysTable.id }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, user.id)).limit(1),
  ]);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    faceEnrolled: user.faceEnrolled,
    passkeyEnrolled: passkeys.length > 0 || biometricKeys.length > 0,
    dataConsentGiven: user.dataConsentGiven,
    biometricConsentGiven: user.biometricConsentGiven,
    parentConsentPending: user.parentGuardianEmail !== null && !user.parentConsentGiven,
    trainingConsentGiven: user.trainingConsentGiven,
    contentPersonalizationConsentGiven: user.contentPersonalizationConsentGiven,
    subscriptionPlan: user.subscriptionPlan,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}

// Same no-MFA-gate reasoning as POST /users/me/training-consent (routes/behavior.ts) — withdrawal must always be reachable even by an otherwise-gated account.
router.post("/users/me/content-personalization-consent", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = SetContentPersonalizationConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }

  const { consent } = parsed.data;
  await db.update(usersTable).set({
    contentPersonalizationConsentGiven: consent,
    contentPersonalizationConsentAt: consent ? new Date() : null,
  }).where(eq(usersTable.id, userId));

  await logEvent({
    eventType: consent ? "CONTENT_PERSONALIZATION_CONSENT_GIVEN" : "CONTENT_PERSONALIZATION_CONSENT_WITHDRAWN",
    details: `${consent ? "Granted" : "Withdrew"} consent for ${user.email}'s own uploaded text content to be read for a private personalization profile`,
    userId,
    userEmail: user.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  res.json(SetContentPersonalizationConsentResponse.parse(await mapUser(updated!)));
});

// Same protection shape as GET /behavior/suggested-action (brief §8) — arguably more warranted here, since this is the one endpoint that reads decrypted upload content server-side.
const contentProfileRateLimit = requestRateLimit("content-profile", 30, 5 * 60 * 1000);

router.get("/users/me/content-profile", requireParentConsent, requireMfaEnrolled, contentProfileRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;

  const profile = await buildContentProfile(userId);

  await logQuery(req, userId, `${profile.keywords.length} keyword(s) from ${profile.documentsConsidered} document(s)`);
  res.json(GetContentProfileResponse.parse({
    keywords: profile.keywords,
    documentsConsidered: profile.documentsConsidered,
  }));
});

async function logQuery(req: Request, userId: number, outcome: string): Promise<void> {
  await logEvent({
    eventType: "CONTENT_PROFILE_QUERIED",
    details: `GET /users/me/content-profile — ${outcome}`,
    userId,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
}

export default router;
