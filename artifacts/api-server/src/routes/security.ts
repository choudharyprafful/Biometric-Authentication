import { Router, type IRouter } from "express";
import { desc, gte, lte, eq, and, ilike, count, isNotNull, type SQL } from "drizzle-orm";
import { db, securityLogsTable, threatsTable, usersTable } from "@workspace/db";
import {
  ListSecurityLogsQueryParams,
  ListSecurityLogsResponse,
  ListThreatsResponse,
  GetSecurityDashboardResponse,
  VerifyLogIntegrityResponse,
} from "@workspace/api-zod";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { verifyLogChain } from "../lib/auditLog";

const router: IRouter = Router();
router.use(requireMfaEnrolled);

// Audit log visibility (logs, chain verification, the dashboard's log feed)
// is exclusive to security_analyst — deliberately NOT admin too. This is a
// separation-of-duties choice: the accounts with the authority to take
// actions (admins — user management, role changes, deletion) shouldn't
// also be the ones who control visibility into the audit trail of those
// actions, or the audit trail stops being a meaningful check on admin
// behavior specifically. security_analyst has no user-management authority
// (routes/users.ts checks specifically for "admin", not this helper), and
// admin has no log visibility — the two roles are deliberately disjoint,
// not admin-plus-something.
function canSeeAuditLogs(role: string | undefined): boolean {
  return role === "security_analyst";
}

const ALERT_WINDOW_MINUTES = 15;
const RATE_LIMIT_SPIKE_THRESHOLD = 3; // 3+ RATE_LIMIT_HIT events from one IP in the window
const LOGIN_FAILURE_SPIKE_THRESHOLD = 5; // 5+ LOGIN_FAILED events from one IP in the window

interface SecurityAlert {
  id: string;
  severity: "medium" | "high";
  message: string;
  count: number;
  windowMinutes: number;
}

// The signal (RATE_LIMIT_HIT / LOGIN_FAILED events) already exists and is
// queryable via /security/logs — this closes the brief's actual ask
// (§5.5: suspicious activity should be a *visible* signal, not just a
// filterable one) by surfacing it proactively on the dashboard instead of
// requiring a security_analyst to go looking. No new storage: recomputed
// from security_logs on every dashboard request, same pattern as the other
// dashboard counters above.
async function computeActiveAlerts(): Promise<SecurityAlert[]> {
  const since = new Date(Date.now() - ALERT_WINDOW_MINUTES * 60 * 1000);

  const rateLimitByIp = await db
    .select({ ipAddress: securityLogsTable.ipAddress, count: count() })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.eventType, "RATE_LIMIT_HIT"), gte(securityLogsTable.timestamp, since), isNotNull(securityLogsTable.ipAddress)))
    .groupBy(securityLogsTable.ipAddress);

  const loginFailuresByIp = await db
    .select({ ipAddress: securityLogsTable.ipAddress, count: count() })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.eventType, "LOGIN_FAILED"), gte(securityLogsTable.timestamp, since), isNotNull(securityLogsTable.ipAddress)))
    .groupBy(securityLogsTable.ipAddress);

  const alerts: SecurityAlert[] = [];

  for (const row of rateLimitByIp) {
    if (row.ipAddress && row.count >= RATE_LIMIT_SPIKE_THRESHOLD) {
      alerts.push({
        id: `rate-limit-spike:${row.ipAddress}`,
        severity: row.count >= RATE_LIMIT_SPIKE_THRESHOLD * 2 ? "high" : "medium",
        message: `${row.count} rate-limit hits from ${row.ipAddress} in the last ${ALERT_WINDOW_MINUTES} minutes`,
        count: row.count,
        windowMinutes: ALERT_WINDOW_MINUTES,
      });
    }
  }

  for (const row of loginFailuresByIp) {
    if (row.ipAddress && row.count >= LOGIN_FAILURE_SPIKE_THRESHOLD) {
      alerts.push({
        id: `login-failure-spike:${row.ipAddress}`,
        severity: row.count >= LOGIN_FAILURE_SPIKE_THRESHOLD * 2 ? "high" : "medium",
        message: `${row.count} failed logins from ${row.ipAddress} in the last ${ALERT_WINDOW_MINUTES} minutes — possible credential stuffing`,
        count: row.count,
        windowMinutes: ALERT_WINDOW_MINUTES,
      });
    }
  }

  return alerts.sort((a, b) => b.count - a.count);
}

// GET /security/dashboard
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

  // Event-level log detail is security_analyst-only (see canSeeAuditLogs) —
  // everyone else, including admin, gets the telemetry counts above but no
  // event-level detail (other users' IPs/emails are not "their own data").
  const recentLogs = canSeeLogs
    ? await db.select().from(securityLogsTable).orderBy(desc(securityLogsTable.timestamp)).limit(10)
    : [];
  const activeAlerts = canSeeLogs ? await computeActiveAlerts() : [];

  res.json(GetSecurityDashboardResponse.parse({
    totalUsers: Number(totalUsersResult?.count ?? 0),
    faceEnrolledUsers: Number(faceEnrolledResult?.count ?? 0),
    activeSessionsCount: 1, // Simplified: current session
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

// Wazuh-style multi-field filtering — every field is optional and combined
// with AND. Previously `eventType` was declared in the OpenAPI spec and
// sent by the frontend but never actually read here at all — the filter
// dropdown looked wired up end-to-end and silently did nothing.
// userEmail/ipAddress are case-insensitive partial matches (an analyst
// searching "45.33" or a partial email shouldn't need the exact string);
// fromDate/toDate bound a time range.
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

// GET /security/logs — security_analyst only.
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

// GET /security/logs/verify — security_analyst only. Recomputes the whole
// hash chain; O(n) over the log table, fine at demo scale, not something
// to poll often.
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

// GET /security/threats
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
