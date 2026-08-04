import { db, securityLogsTable } from "@workspace/db";

export type AuditEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGIN_FACE_SUCCESS"
  | "LOGIN_FACE_FAILED"
  | "LOGOUT"
  | "REGISTER"
  | "FACE_ENROLLED"
  | "FACE_REMOVED"
  | "USER_DELETED"
  | "USER_UPDATED"
  | "PAYMENT_CREATED"
  | "PAYMENT_FAILED"
  | "UNAUTHORIZED_ACCESS"
  | "RATE_LIMIT_HIT";

export async function logEvent(params: {
  eventType: AuditEventType;
  details: string;
  userId?: number | null;
  userEmail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await db.insert(securityLogsTable).values({
      eventType: params.eventType,
      details: params.details,
      userId: params.userId ?? null,
      userEmail: params.userEmail ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  } catch {
    // Never let audit logging crash the main flow
  }
}
