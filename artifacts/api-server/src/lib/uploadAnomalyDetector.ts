/**
 * Flags an abnormal upload rate per account. This does not protect
 * behaviorModel.ts's training corpus — that model trains only on
 * audit-log event types, never upload content — so an upload flood can't
 * poison it. What it defends is the upload pipeline itself: a sudden
 * burst is the signature of automated content-flooding or a
 * compromised/scripted account, a gap the existing rate limiter doesn't
 * surface to an analyst — requestRateLimit (uploads.ts) blocks the 21st
 * request in 5 minutes but alerts no one about an account steadily
 * uploading right up against that ceiling.
 */

import { gte } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";
import type { SecurityAlert } from "./securityAlerting";

const ALERT_WINDOW_MINUTES = 15;
const UPLOAD_RATE_SPIKE_THRESHOLD = 10; // 10+ uploads by one account in the window

export async function computeUploadAnomalyAlerts(): Promise<SecurityAlert[]> {
  const since = new Date(Date.now() - ALERT_WINDOW_MINUTES * 60 * 1000);

  const recent = await db
    .select({ userId: uploadsTable.userId })
    .from(uploadsTable)
    .where(gte(uploadsTable.createdAt, since));

  if (recent.length === 0) return [];

  const countByUser = new Map<number, number>();
  for (const row of recent) {
    countByUser.set(row.userId, (countByUser.get(row.userId) ?? 0) + 1);
  }

  const alerts: SecurityAlert[] = [];
  for (const [userId, count] of countByUser) {
    if (count < UPLOAD_RATE_SPIKE_THRESHOLD) continue;
    alerts.push({
      id: `upload-rate-spike:${userId}`,
      severity: count >= UPLOAD_RATE_SPIKE_THRESHOLD * 2 ? "high" : "medium",
      message: `User #${userId} uploaded ${count} files in the last ${ALERT_WINDOW_MINUTES} minutes — possible automated flooding`,
      count,
      windowMinutes: ALERT_WINDOW_MINUTES,
    });
  }

  return alerts;
}
