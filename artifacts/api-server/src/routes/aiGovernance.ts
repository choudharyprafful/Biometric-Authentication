import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetAiSystemsResponse,
  SetAiSystemStateParams,
  SetAiSystemStateBody,
  SetAiSystemStateResponse,
  SubmitAiChallengeBody,
  SubmitAiChallengeResponse,
  ListAiChallengesResponse,
  ListMyAiChallengesResponse,
  ResolveAiChallengeParams,
  ResolveAiChallengeBody,
  ResolveAiChallengeResponse,
  GetAiOversightResponse,
} from "@workspace/api-zod";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { getClientIp } from "../lib/clientIp";
import { AI_SYSTEMS, ACCOUNTABLE_OWNER } from "../lib/aiSystems";
import {
  aiSystemStates,
  setAiSystemEnabled,
  submitChallenge,
  listChallenges,
  resolveChallenge,
  aiMonitoring,
  ChallengeNotFoundError,
  ChallengeAlreadyResolvedError,
  type Actor,
} from "../lib/aiGovernance";

const router: IRouter = Router();

type Role = "user" | "admin" | "security_analyst" | "it_support";

// Returns the signed-in account as an audit-log actor, or answers 401/403 and returns null.
async function actorFor(req: Request, res: Response, roles?: Role[]): Promise<Actor | null> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  const [user] = await db.select({ email: usersTable.email, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "Session invalid" });
    return null;
  }
  if (roles && !roles.includes(user.role as Role)) {
    res.status(403).json({ error: roles.length === 1 ? "Administrators only" : "Security analysts and administrators only" });
    return null;
  }
  return { userId, email: user.email, ip: getClientIp(req), userAgent: req.headers["user-agent"] };
}

const STAFF: Role[] = ["security_analyst", "admin"];
const staffGates = [requireParentConsent, requireMfaEnrolled];
const challengeRateLimit = requestRateLimit("ai-challenge", 5, 60 * 60 * 1000);
const staffRateLimit = requestRateLimit("ai-governance-staff", 60, 5 * 60 * 1000);

// Public: the transparency page works before sign-in. Who switched a system off, and why, stays in the staff view.
router.get("/ai/systems", async (_req, res): Promise<void> => {
  const states = await aiSystemStates();
  res.json(GetAiSystemsResponse.parse({
    accountableOwner: ACCOUNTABLE_OWNER,
    systems: AI_SYSTEMS.map((s) => ({ ...s, knownLimits: [...s.knownLimits], riskRefs: [...s.riskRefs], enabled: states.get(s.id)!.enabled, stateChangedAt: states.get(s.id)!.changedAt })),
  }));
});

router.put("/ai/systems/:id/state", ...staffGates, staffRateLimit, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res, ["admin"]);
  if (!actor) return;
  const params = SetAiSystemStateParams.safeParse(req.params);
  const body = SetAiSystemStateBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Give a system id, enabled true/false, and a reason of 10–500 characters" });
    return;
  }
  const system = AI_SYSTEMS.find((s) => s.id === params.data.id)!;
  if (!system.switchable) {
    res.status(400).json({ error: `${system.name} cannot be switched off: ${system.switchNote}` });
    return;
  }
  await setAiSystemEnabled(system.id, body.data.enabled, body.data.reason.trim(), actor);
  const state = (await aiSystemStates()).get(system.id)!;
  res.json(SetAiSystemStateResponse.parse({ id: system.id, name: system.name, switchable: system.switchable, switchNote: system.switchNote, ...state }));
});

// Deliberately not behind requireMfaEnrolled or requireParentConsent: someone the face model fails, or a
// minor awaiting a parent, must still be able to challenge a decision (same reasoning as consent withdrawal).
router.post("/ai/challenges", challengeRateLimit, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actor) return;
  const body = SubmitAiChallengeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Choose the AI system, describe the decision in 10–1,000 characters, and keep any reference to letters, numbers and basic punctuation" });
    return;
  }
  const id = await submitChallenge(body.data.systemId, body.data.reference?.trim() || null, body.data.message.trim(), actor);
  const created = (await listChallenges(actor.userId)).find((c) => c.id === id)!;
  res.status(201).json(SubmitAiChallengeResponse.parse(created));
});

router.get("/ai/challenges/mine", async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actor) return;
  res.json(ListMyAiChallengesResponse.parse(await listChallenges(actor.userId)));
});

router.get("/ai/challenges", ...staffGates, staffRateLimit, async (req, res): Promise<void> => {
  if (!(await actorFor(req, res, STAFF))) return;
  res.json(ListAiChallengesResponse.parse(await listChallenges()));
});

router.post("/ai/challenges/:id/resolve", ...staffGates, staffRateLimit, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res, STAFF);
  if (!actor) return;
  const params = ResolveAiChallengeParams.safeParse({ id: Number(req.params["id"]) });
  const body = ResolveAiChallengeBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Give an outcome (upheld or not-upheld) and a note of 5–1,000 characters" });
    return;
  }
  try {
    await resolveChallenge(params.data.id, body.data.outcome, body.data.note.trim(), actor);
  } catch (err) {
    if (err instanceof ChallengeNotFoundError) {
      res.status(404).json({ error: "No such challenge" });
      return;
    }
    if (err instanceof ChallengeAlreadyResolvedError) {
      res.status(409).json({ error: "This challenge has already been resolved" });
      return;
    }
    throw err;
  }
  const resolved = (await listChallenges()).find((c) => c.id === params.data.id)!;
  res.json(ResolveAiChallengeResponse.parse(resolved));
});

router.get("/ai/oversight", ...staffGates, staffRateLimit, async (req, res): Promise<void> => {
  if (!(await actorFor(req, res, STAFF))) return;
  const [states, outcomes, challenges] = await Promise.all([aiSystemStates(), aiMonitoring(), listChallenges()]);
  res.json(GetAiOversightResponse.parse({
    systems: AI_SYSTEMS.map((s) => ({ id: s.id, name: s.name, switchable: s.switchable, switchNote: s.switchNote, ...states.get(s.id)! })),
    outcomes,
    openChallenges: challenges.filter((c) => c.status === "open").length,
  }));
});

export default router;
