import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  ListIncomingConsentRequestsResponse,
  AnswerConsentRequestParams,
  AnswerConsentRequestBody,
  AnswerConsentRequestResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { answerRequest, incomingRequests } from "../lib/bystanderConsent";
import { getClientIp } from "../lib/clientIp";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";

// Requests to this account from people who uploaded a file that shows it (lib/bystanderConsent.ts):
// Team 2's Bystander Consent Policy, section 4, first row. The person asked decides each use
// separately and can change the answer at any time.
const router: IRouter = Router();
// Path-scoped, like every router here (routes/index.ts).
router.use(
  "/bystander-consent-requests",
  requireParentConsent,
  requireMfaEnrolled,
);

const answerRateLimit = requestRateLimit(
  "bystander-consent-answer",
  30,
  5 * 60 * 1000,
);

async function currentUser(userId: number) {
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      emailVerified: usersTable.emailVerified,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user;
}

router.get("/bystander-consent-requests", async (req, res): Promise<void> => {
  const user = await currentUser(req.session.userId as number);
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }
  res.json(
    ListIncomingConsentRequestsResponse.parse(await incomingRequests(user)),
  );
});

router.post(
  "/bystander-consent-requests/:id/answer",
  answerRateLimit,
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params["id"])
      ? req.params["id"][0]
      : req.params["id"];
    const params = AnswerConsentRequestParams.safeParse({ id: Number(rawId) });
    if (!params.success) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const body = AnswerConsentRequestBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error: "Answer yes or no for each use",
      });
      return;
    }
    const user = await currentUser(req.session.userId as number);
    if (!user) {
      res.status(401).json({ error: "Session invalid" });
      return;
    }
    const answered = await answerRequest(user, params.data.id, body.data);
    if (!answered) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const says = (v: boolean) => (v ? "yes" : "no");
    await logEvent({
      eventType: "BYSTANDER_CONSENT_ANSWERED",
      details: `Request ${answered.id}: topic profile ${says(body.data.personalisation)}, shared training ${says(body.data.sharedTraining)}`,
      userId: user.id,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.json(AnswerConsentRequestResponse.parse(answered));
  },
);

export default router;
