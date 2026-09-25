import { Router, type IRouter } from "express";
import { GetAiSecurityReportResponse } from "@workspace/api-zod";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { runLiveModelValidation } from "../lib/aiSecurityValidation";
// Written by artifacts/ai-model/ai_security_report.py from the team's Python PoCs; CI fails if it is stale.
import pocReport from "../lib/aiPocReport.json";

const router: IRouter = Router();
// Path-scoped: every router is mounted without a prefix, so an unscoped gate here would also run on requests meant for routers mounted after this one.
router.use("/ai-security", requireParentConsent, requireMfaEnrolled);

// The validation is synthetic and fast, but it trains the model six times per call, so it gets the same kind of per-account cap as the model endpoint itself.
const reportRateLimit = requestRateLimit("ai-security-report", 20, 5 * 60 * 1000);

router.get("/ai-security/report", reportRateLimit, (_req, res): void => {
  res.json(GetAiSecurityReportResponse.parse({ live: runLiveModelValidation(), poc: pocReport }));
});

export default router;
