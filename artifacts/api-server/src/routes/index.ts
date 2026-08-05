import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import passkeysRouter from "./passkeys";
import usersRouter from "./users";
import securityRouter from "./security";
import paymentsRouter from "./payments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(passkeysRouter);
router.use(usersRouter);
router.use(securityRouter);
router.use(paymentsRouter);

export default router;
