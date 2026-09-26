/**
 * The privacy policy version the app shows. Its text is in artifacts/secureai/src/lib/privacyPolicy.ts,
 * and scripts/check-privacy-policy-version.mjs fails CI if the two versions differ, so nobody is
 * recorded as having been shown a version whose text they didn't see.
 *
 * Who was shown which version is kept as PRIVACY_POLICY_ACKNOWLEDGED audit events rather than a
 * column: the record is then tamper-evident, and a new version needs no database change.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, securityLogsTable } from "@workspace/db";

export const PRIVACY_POLICY_VERSION = "2026-09-26.2";

export function acknowledgementDetails(version: string, via: "registration" | "notice"): string {
  return `version=${version}; via=${via}`;
}

const VERSION_IN_DETAILS = /^version=([^;]+);/;

export async function privacyPolicyStatus(userId: number): Promise<{
  currentVersion: string;
  acknowledgedVersion: string | null;
  acknowledgedAt: string | null;
}> {
  const [last] = await db
    .select({ details: securityLogsTable.details, timestamp: securityLogsTable.timestamp })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.userId, userId), eq(securityLogsTable.eventType, "PRIVACY_POLICY_ACKNOWLEDGED")))
    .orderBy(desc(securityLogsTable.timestamp))
    .limit(1);
  return {
    currentVersion: PRIVACY_POLICY_VERSION,
    acknowledgedVersion: last ? (VERSION_IN_DETAILS.exec(last.details)?.[1] ?? null) : null,
    acknowledgedAt: last ? last.timestamp.toISOString() : null,
  };
}
