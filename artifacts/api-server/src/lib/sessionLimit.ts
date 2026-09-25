/**
 * Account sharing (docs/04 R-PAY-4): one subscription used on many devices at once. Each account
 * may be signed in on a limited number of devices; a new sign-in beyond that signs out the oldest
 * session rather than refusing, so the owner can never be locked out by a device they no longer
 * have. Repeated sign-outs are the sharing signal, raised to staff as an alert.
 */
import type { Request } from "express";
import { and, count, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, securityLogsTable, sessionsTable } from "@workspace/db";
import { logEvent } from "./auditLog";
import { getClientIp } from "./clientIp";
import type { SecurityAlert } from "./securityAlerting";

export const MAX_SIGNED_IN_DEVICES = { free: 3, plus: 3, pro: 3, team: 10 } as const;
type Plan = keyof typeof MAX_SIGNED_IN_DEVICES;

// Sign-outs forced by the cap within a day before staff are told.
const SHARING_ALERT_THRESHOLD = 3;

/**
 * Call right after a sign-in has been saved. Signs out the account's oldest sessions so that, with
 * this one, it stays within its plan's device limit. Returns how many were signed out.
 */
export async function enforceSessionLimit(
  req: Request,
  user: { id: number; email: string; subscriptionPlan: Plan },
): Promise<number> {
  const limit = MAX_SIGNED_IN_DEVICES[user.subscriptionPlan] ?? MAX_SIGNED_IN_DEVICES.free;
  // Same "still signed in" test as the security dashboard: not idle-expired, past MFA, and inside
  // the absolute lifetime app.ts enforces. Oldest first: absoluteExpiresAt is fixed at sign-in.
  const absoluteExpiry = sql`coalesce((${sessionsTable.sess} ->> 'absoluteExpiresAt')::bigint, 0)`;
  const others = await db
    .select({ sid: sessionsTable.sid })
    .from(sessionsTable)
    .where(and(
      sql`${sessionsTable.expire} > now()`,
      sql`${sessionsTable.sess} ->> 'userId' = ${String(user.id)}`,
      sql`${absoluteExpiry} >= ${Date.now()}`,
      ne(sessionsTable.sid, req.sessionID),
    ))
    .orderBy(absoluteExpiry);

  const excess = others.length - (limit - 1);
  if (excess <= 0) return 0;
  await db.delete(sessionsTable).where(inArray(sessionsTable.sid, others.slice(0, excess).map((s) => s.sid)));
  await logEvent({
    eventType: "SESSION_LIMIT_ENFORCED",
    details: `Signed out ${excess} older session${excess === 1 ? "" : "s"}: the ${user.subscriptionPlan} plan allows ${limit} signed-in devices at once`,
    userId: user.id,
    userEmail: user.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
  return excess;
}

/** Accounts whose device limit forced several sign-outs in the last 24 hours. */
export async function computeAccountSharingAlerts(): Promise<SecurityAlert[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ userId: securityLogsTable.userId, email: securityLogsTable.userEmail, n: count() })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.eventType, "SESSION_LIMIT_ENFORCED"), gte(securityLogsTable.timestamp, since)))
    .groupBy(securityLogsTable.userId, securityLogsTable.userEmail);
  return rows
    .filter((r) => r.n >= SHARING_ALERT_THRESHOLD)
    .map((r) => ({
      id: `account-sharing:${r.userId}`,
      severity: "medium" as const,
      message: `Possible account sharing: ${r.email ?? `account ${r.userId}`} hit its device limit ${r.n} times in the last 24 hours`,
      count: r.n,
      windowMinutes: 24 * 60,
    }));
}
