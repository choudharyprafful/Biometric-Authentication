import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, passkeysTable, biometricKeysTable } from "@workspace/db";
import { SetTrainingConsentBody, SetTrainingConsentResponse, GetSuggestedActionResponse } from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { buildTrainingCorpus, train, predictNext, getRecentEventTypes } from "../lib/behaviorModel";

const router: IRouter = Router();

function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

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

// No requireMfaEnrolled/requireParentConsent gate deliberately: withdrawing consent must always be reachable even by an otherwise-gated account, same reasoning as biometric-consent withdrawal (DELETE /users/:id/face). Granting while gated is harmless since it only takes effect once the account can act at all.
router.post("/users/me/training-consent", async (req, res): Promise<void> => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = SetTrainingConsentBody.safeParse(req.body);
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
    trainingConsentGiven: consent,
    trainingConsentAt: consent ? new Date() : null,
  }).where(eq(usersTable.id, userId));

  await logEvent({
    eventType: consent ? "TRAINING_CONSENT_GIVEN" : "TRAINING_CONSENT_WITHDRAWN",
    details: `${consent ? "Granted" : "Withdrew"} consent for ${user.email}'s activity to contribute to the behavior model's training corpus`,
    userId,
    userEmail: user.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  res.json(SetTrainingConsentResponse.parse(await mapUser(updated!)));
});

// Model-extraction defense (brief §8) — this is the one model-serving endpoint in the project. There's no numeric/embedding output to scrape, just a discrete suggestion, so throttling query volume against repeated crafted-session-state queries is the applicable control here.
const suggestedActionRateLimit = requestRateLimit("behavior-suggested-action", 30, 5 * 60 * 1000);

router.get("/behavior/suggested-action", requireParentConsent, requireMfaEnrolled, suggestedActionRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;

  const { lastEvent, previousEvent } = await getRecentEventTypes(userId);
  if (!lastEvent) {
    await logQuery(req, userId, "no prior activity to predict from");
    res.json(GetSuggestedActionResponse.parse({ suggestion: null, distinctUsersSupporting: 0, modelTrainedFromUsers: 0, contextDepth: null }));
    return;
  }

  const corpus = await buildTrainingCorpus();
  const model = train(corpus);
  const prediction = predictNext(model, previousEvent, lastEvent);

  await logQuery(req, userId, prediction ? `suggested "${prediction.eventType}" (order-${prediction.contextDepth} context)` : "no prediction cleared the distinct-user threshold");
  res.json(GetSuggestedActionResponse.parse({
    suggestion: prediction?.eventType ?? null,
    distinctUsersSupporting: prediction?.distinctUsers ?? 0,
    modelTrainedFromUsers: model.usersIncluded,
    contextDepth: prediction?.contextDepth ?? null,
  }));
});

// Query monitoring, distinct from the rate limit above: that only logs once someone's already over threshold, this logs every query so a slow, under-the-limit extraction pattern is still visible. Deliberately not one of the queryable-by-behaviorModel event types — see behaviorModel.ts's META_EVENT_TYPES for why this must never feed back into the corpus it was generated by querying.
async function logQuery(req: Request, userId: number, outcome: string): Promise<void> {
  await logEvent({
    eventType: "BEHAVIOR_MODEL_QUERIED",
    details: `GET /behavior/suggested-action — ${outcome}`,
    userId,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
}

export default router;
