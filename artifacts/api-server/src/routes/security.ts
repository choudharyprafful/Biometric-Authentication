import { Router, type IRouter } from "express";
import { desc, gte, eq, count } from "drizzle-orm";
import { db, securityLogsTable, threatsTable, usersTable } from "@workspace/db";
import {
  ListSecurityLogsQueryParams,
  ListSecurityLogsResponse,
  ListThreatsResponse,
  GetSecurityDashboardResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /security/dashboard
router.get("/security/dashboard", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [totalUsersResult] = await db.select({ count: count() }).from(usersTable);
  const [faceEnrolledResult] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.faceEnrolled, true));
  const [loginAttemptsResult] = await db.select({ count: count() }).from(securityLogsTable).where(gte(securityLogsTable.timestamp, yesterday));
  const [failedLoginsResult] = await db.select({ count: count() }).from(securityLogsTable).where(
    eq(securityLogsTable.eventType, "LOGIN_FAILED")
  );
  const [threatsResult] = await db.select({ count: count() }).from(threatsTable).where(eq(threatsTable.status, "active"));

  const recentLogs = await db.select().from(securityLogsTable).orderBy(desc(securityLogsTable.timestamp)).limit(10);

  res.json(GetSecurityDashboardResponse.parse({
    totalUsers: Number(totalUsersResult?.count ?? 0),
    faceEnrolledUsers: Number(faceEnrolledResult?.count ?? 0),
    activeSessionsCount: 1, // Simplified: current session
    loginAttempts24h: Number(loginAttemptsResult?.count ?? 0),
    failedLogins24h: Number(failedLoginsResult?.count ?? 0),
    threatsDetected: Number(threatsResult?.count ?? 0),
    recentLogs: recentLogs.map((log) => ({
      id: log.id,
      userId: log.userId ?? null,
      userEmail: log.userEmail ?? null,
      eventType: log.eventType,
      ipAddress: log.ipAddress ?? null,
      userAgent: log.userAgent ?? null,
      details: log.details,
      timestamp: log.timestamp.toISOString(),
    })),
  }));
});

// GET /security/logs
router.get("/security/logs", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const query = ListSecurityLogsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 50) : 50;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const logs = await db.select().from(securityLogsTable)
    .orderBy(desc(securityLogsTable.timestamp))
    .limit(limit)
    .offset(offset);

  res.json(ListSecurityLogsResponse.parse(logs.map((log) => ({
    id: log.id,
    userId: log.userId ?? null,
    userEmail: log.userEmail ?? null,
    eventType: log.eventType,
    ipAddress: log.ipAddress ?? null,
    userAgent: log.userAgent ?? null,
    details: log.details,
    timestamp: log.timestamp.toISOString(),
  }))));
});

// GET /security/threats
router.get("/security/threats", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const threats = await db.select().from(threatsTable).orderBy(desc(threatsTable.timestamp));

  res.json(ListThreatsResponse.parse(threats.map((t) => ({
    id: t.id,
    type: t.type,
    severity: t.severity,
    description: t.description,
    timestamp: t.timestamp.toISOString(),
    status: t.status,
    affectedUsers: t.affectedUsers ?? null,
  }))));
});

export default router;
