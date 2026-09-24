/**
 * Two independent signals, computed fresh from security_logs on every call:
 *
 * 1. Failure-spike: N+ LOGIN_FACE_FAILED events for one account within the
 *    window.
 *
 * 2. Threshold-probing: among an account's recent LOGIN_FACE_FAILED rows,
 *    N+ have a match distance clustered in a narrow band just above
 *    FACE_MATCH_THRESHOLD rather than spread randomly above it. A genuine
 *    different person's face produces distances scattered well above
 *    threshold; a deliberate spoof/adversarial-input attack iterating
 *    toward the boundary produces distances clustered close to it — a
 *    statistical tell on the comparison's own output, not a separately
 *    trained spoof classifier.
 *
 * Distance is read back out of the "dist=" token logged in
 * LOGIN_FACE_FAILED's details string (see routes/auth.ts) — parsed
 * defensively; a row whose details don't carry a parseable distance is
 * simply excluded from signal 2, never treated as an error.
 */

import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db, securityLogsTable } from "@workspace/db";
import { FACE_MATCH_THRESHOLD } from "./faceUtils";
import type { SecurityAlert } from "./securityAlerting";

const ALERT_WINDOW_MINUTES = 15;
const FACE_FAILURE_SPIKE_THRESHOLD = 4; // 4+ LOGIN_FACE_FAILED for one account in the window
const PROBING_MIN_ATTEMPTS = 4; // needs at least this many parsed-distance failures to judge clustering
const PROBING_BAND_WIDTH = 0.08; // distances within this band above threshold count as "clustered"

function parseDistance(details: string): number | null {
  const match = /dist=([0-9]*\.?[0-9]+)/.exec(details);
  if (!match || !match[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export async function computeFaceVerificationAlerts(): Promise<SecurityAlert[]> {
  const since = new Date(Date.now() - ALERT_WINDOW_MINUTES * 60 * 1000);

  const rows = await db
    .select({ userId: securityLogsTable.userId, userEmail: securityLogsTable.userEmail, details: securityLogsTable.details })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.eventType, "LOGIN_FACE_FAILED"), gte(securityLogsTable.timestamp, since), isNotNull(securityLogsTable.userId)));

  const byUser = new Map<number, { email: string | null; distances: number[]; count: number }>();
  for (const row of rows) {
    if (row.userId === null) continue;
    const entry = byUser.get(row.userId) ?? { email: row.userEmail, distances: [], count: 0 };
    entry.count += 1;
    const distance = parseDistance(row.details);
    if (distance !== null) entry.distances.push(distance);
    byUser.set(row.userId, entry);
  }

  const alerts: SecurityAlert[] = [];

  for (const [userId, entry] of byUser) {
    const who = entry.email ?? `user #${userId}`;

    if (entry.count >= FACE_FAILURE_SPIKE_THRESHOLD) {
      alerts.push({
        id: `face-failure-spike:${userId}`,
        severity: entry.count >= FACE_FAILURE_SPIKE_THRESHOLD * 2 ? "high" : "medium",
        message: `${entry.count} failed face-verification attempts for ${who} in the last ${ALERT_WINDOW_MINUTES} minutes`,
        count: entry.count,
        windowMinutes: ALERT_WINDOW_MINUTES,
      });
    }

    if (entry.distances.length >= PROBING_MIN_ATTEMPTS) {
      const clustered = entry.distances.filter((d) => d >= FACE_MATCH_THRESHOLD && d < FACE_MATCH_THRESHOLD + PROBING_BAND_WIDTH).length;
      if (clustered >= PROBING_MIN_ATTEMPTS) {
        alerts.push({
          id: `face-threshold-probing:${userId}`,
          severity: "high",
          message: `${clustered} face-verification attempts for ${who} clustered just above the match threshold — possible spoofing/probing attempt rather than ordinary mismatches`,
          count: clustered,
          windowMinutes: ALERT_WINDOW_MINUTES,
        });
      }
    }
  }

  return alerts;
}
