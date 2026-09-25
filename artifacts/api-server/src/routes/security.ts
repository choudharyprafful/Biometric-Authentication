import { Router, type IRouter } from "express";
import { desc, gte, lte, eq, and, ilike, count, sql, type SQL } from "drizzle-orm";
import { db, securityLogsTable, threatsTable, usersTable, sessionsTable } from "@workspace/db";
import {
  ListSecurityLogsQueryParams,
  ListSecurityLogsResponse,
  ListThreatsResponse,
  GetSecurityDashboardResponse,
  VerifyLogIntegrityResponse,
  RepairLogChainResponse,
  RestoreLogChainResponse,
  ListDeletionAuditResponse,
} from "@workspace/api-zod";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { verifyLogChain, repairLogChain, restoreLogChain, listDeletionAudit } from "../lib/auditLog";
import { computeActiveAlerts } from "../lib/securityAlerting";
import { getClientIp } from "../lib/clientIp";

const router: IRouter = Router();
// Path-scoped: every router is mounted without a prefix, so an unscoped gate here would also run on requests meant for routers mounted after this one.
router.use("/security", requireParentConsent, requireMfaEnrolled);

// Admin is a superset role, including audit-log visibility — a deliberate departure from an earlier separation-of-duties design that kept admin and security_analyst disjoint (docs/04_Threat_Model_Risk_Assessment.md, "Admin/security_analyst merge"). That control is no longer in effect.
function canSeeAuditLogs(role: string | undefined): boolean {
  return role === "security_analyst" || role === "admin";
}

// computeActiveAlerts() lives in lib/securityAlerting.ts, shared with the background push-notification job, so there's one detection implementation rather than a dashboard copy and a job copy that could silently drift apart.
router.get("/security/dashboard", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const canSeeLogs = canSeeAuditLogs(sessionUser?.role);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [totalUsersResult] = await db.select({ count: count() }).from(usersTable);
  const [faceEnrolledResult] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.faceEnrolled, true));
  const [loginAttemptsResult] = await db.select({ count: count() }).from(securityLogsTable).where(gte(securityLogsTable.timestamp, yesterday));
  const [failedLoginsResult] = await db.select({ count: count() }).from(securityLogsTable).where(
    eq(securityLogsTable.eventType, "LOGIN_FAILED")
  );
  const [threatsResult] = await db.select({ count: count() }).from(threatsTable).where(eq(threatsTable.status, "active"));
  // Signed-in sessions the server would still accept: not idle-expired, not a half-finished MFA challenge,
  // and inside the absolute lifetime the middleware in app.ts enforces.
  const [activeSessionsResult] = await db.select({ count: count() }).from(sessionsTable).where(and(
    sql`${sessionsTable.expire} > now()`,
    sql`${sessionsTable.sess} ->> 'userId' is not null`,
    sql`coalesce((${sessionsTable.sess} ->> 'absoluteExpiresAt')::bigint, ${Number.MAX_SAFE_INTEGER}) >= ${now.getTime()}`,
  ));

  // A plain "user" account gets the telemetry counts above but no event-level detail — other users' IPs/emails aren't "their own data".
  const recentLogs = canSeeLogs
    ? await db.select().from(securityLogsTable).orderBy(desc(securityLogsTable.timestamp)).limit(10)
    : [];
  const activeAlerts = canSeeLogs ? await computeActiveAlerts() : [];

  res.json(GetSecurityDashboardResponse.parse({
    totalUsers: Number(totalUsersResult?.count ?? 0),
    faceEnrolledUsers: Number(faceEnrolledResult?.count ?? 0),
    activeSessionsCount: Number(activeSessionsResult?.count ?? 0),
    loginAttempts24h: Number(loginAttemptsResult?.count ?? 0),
    failedLogins24h: Number(failedLoginsResult?.count ?? 0),
    threatsDetected: Number(threatsResult?.count ?? 0),
    activeAlerts,
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

// Every field is optional, combined with AND. userEmail/ipAddress use case-insensitive partial matches — an analyst searching "45.33" or a partial email shouldn't need the exact string.
function buildLogFilterConditions(query: ReturnType<typeof ListSecurityLogsQueryParams.safeParse>): SQL[] {
  const conditions: SQL[] = [];
  if (!query.success) return conditions;

  if (query.data.eventType) conditions.push(eq(securityLogsTable.eventType, query.data.eventType));
  if (query.data.userEmail) conditions.push(ilike(securityLogsTable.userEmail, `%${query.data.userEmail}%`));
  if (query.data.ipAddress) conditions.push(ilike(securityLogsTable.ipAddress, `%${query.data.ipAddress}%`));

  if (query.data.fromDate) {
    const from = new Date(query.data.fromDate);
    if (!Number.isNaN(from.getTime())) conditions.push(gte(securityLogsTable.timestamp, from));
  }
  if (query.data.toDate) {
    const to = new Date(query.data.toDate);
    if (!Number.isNaN(to.getTime())) conditions.push(lte(securityLogsTable.timestamp, to));
  }
  return conditions;
}

router.get("/security/logs", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!canSeeAuditLogs(sessionUser?.role)) {
    res.status(403).json({ error: "Security analyst access required" });
    return;
  }

  const query = ListSecurityLogsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 50) : 50;
  const offset = query.success ? (query.data.offset ?? 0) : 0;
  const conditions = buildLogFilterConditions(query);

  const logs = await db.select().from(securityLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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

// Recomputes the whole hash chain — O(n) over the log table, fine at demo scale but not something to poll often.
router.get("/security/logs/verify", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!canSeeAuditLogs(sessionUser?.role)) {
    res.status(403).json({ error: "Security analyst access required" });
    return;
  }

  const result = await verifyLogChain();
  res.json(VerifyLogIntegrityResponse.parse(result));
});

// A hash chain can prove a row was deleted/edited but can't recover it — this quarantines the untrustworthy tail rather than fabricate replacement content, and records the repair itself as a new, honest chain entry. No-op if already valid.
router.post("/security/logs/repair", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [sessionUser] = await db.select({ role: usersTable.role, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
  if (!canSeeAuditLogs(sessionUser?.role)) {
    res.status(403).json({ error: "Security analyst access required" });
    return;
  }

  const result = await repairLogChain({
    userId,
    userEmail: sessionUser?.email ?? null,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"] ?? null,
  });
  res.json(RepairLogChainResponse.parse(result));
});

// Re-inserts rows that were genuinely deleted (app-initiated or raw SQL alike), using the pre-delete snapshot captured by the security_logs_deletion_audit trigger — a real recovery since the snapshot is independent of the hash chain itself. No-op if already valid or if the break wasn't caused by a deletion.
router.post("/security/logs/restore", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [sessionUser] = await db.select({ role: usersTable.role, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
  if (!canSeeAuditLogs(sessionUser?.role)) {
    res.status(403).json({ error: "Security analyst access required" });
    return;
  }

  const result = await restoreLogChain({
    userId,
    userEmail: sessionUser?.email ?? null,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"] ?? null,
  });
  res.json(RestoreLogChainResponse.parse(result));
});

// Forensic view of every security_logs deletion the database trigger has captured, whether it happened through the app or a raw SQL client with DB credentials.
router.get("/security/logs/deletions", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!canSeeAuditLogs(sessionUser?.role)) {
    res.status(403).json({ error: "Security analyst access required" });
    return;
  }

  const entries = await listDeletionAudit();
  res.json(ListDeletionAuditResponse.parse(entries));
});

router.get("/security/threats", async (_req, res): Promise<void> => {
  const threats = await db.select().from(threatsTable).orderBy(desc(threatsTable.timestamp));

  res.json(ListThreatsResponse.parse(threats.map((t) => ({
    id: t.id,
    type: t.type,
    severity: t.severity,
    description: t.description,
    plainSummary: t.plainSummary ?? null,
    timestamp: t.timestamp.toISOString(),
    status: t.status,
    affectedUsers: t.affectedUsers ?? null,
  }))));
});

export default router;
