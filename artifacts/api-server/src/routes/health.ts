import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

const DB_CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Must reach the database: a check that doesn't reports healthy through a total database outage.
router.get("/healthz", async (_req, res) => {
  try {
    await withTimeout(pool.query("SELECT 1"), DB_CHECK_TIMEOUT_MS);
  } catch {
    res.status(503).json(HealthCheckResponse.parse({ status: "database unavailable" }));
    return;
  }
  res.json(HealthCheckResponse.parse({ status: "ok" }));
});

export default router;
