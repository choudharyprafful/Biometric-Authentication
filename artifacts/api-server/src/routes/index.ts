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

const router: IRouter = Router();

// webhooksRouter has no session/auth requirement (server-to-server, HMAC
// verified) and MUST be mounted before any router with a path-less
// `router.use(someMiddleware)` — e.g. security.ts's blanket MFA gate would
// otherwise intercept any request that doesn't match an earlier router,
// including this one, before it ever reaches its own handler.
router.use(healthRouter);
router.use(webhooksRouter);
router.use(authRouter);
router.use(passkeysRouter);
router.use(biometricKeyRouter);
router.use(usersRouter);
router.use(securityRouter);
router.use(paymentsRouter);
router.use(uploadsRouter);

export default router;
