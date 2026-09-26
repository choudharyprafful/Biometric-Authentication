import { Router, type IRouter } from "express";
import healthRouter from "./health";
import webhooksRouter from "./webhooks";
import authRouter from "./auth";
import passkeysRouter from "./passkeys";
import biometricKeyRouter from "./biometricKey";
import usersRouter from "./users";
import securityRouter from "./security";
import paymentsRouter from "./payments";
import uploadsRouter from "./uploads";
import behaviorRouter from "./behavior";
import contentProfileRouter from "./contentProfile";
import aiSecurityRouter from "./aiSecurity";
import aiGovernanceRouter from "./aiGovernance";
import privacyRouter from "./privacy";

const router: IRouter = Router();

// Routers are mounted without a prefix, so a router-level gate must be path-scoped (router.use("/payments", gate)); a path-less router.use would run on every request that passes through, including the unauthenticated webhook and the consent-withdrawal routes mounted later.
router.use(healthRouter);
router.use(webhooksRouter);
router.use(authRouter);
router.use(passkeysRouter);
router.use(biometricKeyRouter);
router.use(usersRouter);
router.use(securityRouter);
router.use(paymentsRouter);
router.use(uploadsRouter);
router.use(behaviorRouter);
router.use(contentProfileRouter);
router.use(aiSecurityRouter);
router.use(aiGovernanceRouter);
router.use(privacyRouter);

export default router;
