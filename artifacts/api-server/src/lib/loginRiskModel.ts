/**
 * Scores each login attempt against that same account's own prior login
 * history, already sitting in security_logs (ipAddress/userAgent/timestamp
 * on every LOGIN_SUCCESS row) — no new storage, no new PII, recomputed
 * fresh on every call.
 *
 * Deliberately NOT gated behind trainingConsentGiven, unlike
 * behaviorModel.ts: that flag gates a pooled, cross-user corpus, whereas
 * this model never pools across accounts — one account's history is
 * compared only against itself, to protect that same account, the same
 * purpose password hashing or rate limiting already serve without a
 * separate opt-in.
 *
 * "Impossible travel" here means exactly what's checked below — a
 * different source IP succeeding for the same account within a short
 * window — not real geographic distance/speed, since no GeoIP/ASN lookup
 * is available in this environment.
 *
 * The off-hours signal uses circular statistics because hours wrap around
 * a 24-hour clock (23:00 and 01:00 are two hours apart, not twenty-two —
 * a plain mean/stddev over the hour number gets this wrong). Each login
 * hour is treated as an angle around a circle; the "mean resultant length"
 * R (0 = scattered across the day, 1 = always the same hour) measures how
 * consistent the account's own pattern is, and the flagging threshold
 * adapts to it.
 */

import { and, eq, desc } from "drizzle-orm";
import { db, securityLogsTable } from "@workspace/db";

export type RiskLevel = "low" | "medium" | "high";

export interface LoginRiskAssessment {
  level: RiskLevel;
  reasons: string[];
  isNewIp: boolean;
  isNewDevice: boolean;
  priorLoginsConsidered: number;
}

// Query-cost bound, not anti-poisoning — no cross-user pooling here for
// one account's login volume to poison against.
const MAX_HISTORY_ROWS = 100;

// Below this, an account has no stable pattern to score against — every
// account's actual first login is trivially "a new IP, a new device,"
// which would be a guaranteed false positive on day one.
const MIN_HISTORY_FOR_SCORING = 3;

// The time-of-day check needs more samples than the other signals before
// its circular statistics are trustworthy — R from 3 logins is noisy in a
// way R from 8+ isn't.
const MIN_HISTORY_FOR_TIME_PATTERN = 8;

// Two different source IPs completing a login for the same account within
// this window is flagged regardless of geography — a coarse proxy, not
// real geo-velocity (see module comment above).
const RAPID_IP_CHANGE_WINDOW_MS = 10 * 60 * 1000;

// Below this concentration the account's own login-hour history is already
// scattered enough that a new hour isn't meaningfully surprising — only
// flag off-hours for accounts whose history shows a real pattern to deviate from.
const MIN_CONCENTRATION_FOR_TIME_CHECK = 0.4;

// A deviation must clear both a floor (so a highly consistent account
// isn't flagged for one ordinary hour's wobble) and a multiple of that
// account's own circular stddev (so the threshold scales with how tight
// the pattern actually is).
const OFF_HOURS_FLOOR_HOURS = 3;
const OFF_HOURS_STDDEV_MULTIPLIER = 2;

// Each signal contributes a weight rather than a flat "+1" — a rapid
// cross-IP change is a stronger tell (active concurrent access) than a
// single new device on an otherwise-familiar network.
const WEIGHT_NEW_IP = 1;
const WEIGHT_NEW_DEVICE = 1;
const WEIGHT_RAPID_IP_CHANGE = 1.5;
const WEIGHT_OFF_HOURS = 1;
const HIGH_RISK_THRESHOLD = 2;
const MEDIUM_RISK_THRESHOLD = 1;

function normalizeUserAgent(ua: string | null | undefined): string {
  return (ua ?? "unknown").trim().toLowerCase();
}

/** Hour-of-day as a fractional value in [0, 24) — minutes count, so
 *  14:30 is 14.5, not truncated to 14. */
function hourOfDay(date: Date): number {
  return date.getUTCHours() + date.getUTCMinutes() / 60;
}

interface CircularStats {
  meanHour: number;
  concentration: number; // R, in [0, 1]
  stdDevHours: number; // circular standard deviation, in hours
}

/** Standard circular (directional) statistics over a set of hour-of-day
 *  values, treating each as an angle on a 24-hour clock so 23:00 and
 *  01:00 correctly register as 2 hours apart, not 22. */
function computeCircularStats(hours: number[]): CircularStats {
  let sumCos = 0;
  let sumSin = 0;
  for (const hour of hours) {
    const angle = (hour / 24) * 2 * Math.PI;
    sumCos += Math.cos(angle);
    sumSin += Math.sin(angle);
  }
  const n = hours.length;
  const meanCos = sumCos / n;
  const meanSin = sumSin / n;
  const concentration = Math.hypot(meanCos, meanSin);
  const meanAngle = Math.atan2(meanSin, meanCos);
  const meanHour = ((meanAngle / (2 * Math.PI)) * 24 + 24) % 24;
  // sqrt(-2 ln R) is the standard circular-stddev formula; R can be
  // vanishingly small but never exactly 0 here since MIN_HISTORY_FOR_
  // TIME_PATTERN guarantees at least 8 samples, so ln(R) stays finite in
  // practice — still guarded defensively.
  const stdDevRadians = concentration > 0.0001 ? Math.sqrt(-2 * Math.log(concentration)) : Math.PI;
  const stdDevHours = (stdDevRadians / (2 * Math.PI)) * 24;
  return { meanHour, concentration, stdDevHours };
}

/** Shortest distance between two hour-of-day values around a 24-hour
 *  clock — e.g. 23:00 to 01:00 is 2 hours, not 22. */
function circularHourDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 24;
  return Math.min(diff, 24 - diff);
}

/** Scores a login attempt that has already passed the password check, using
 *  only this account's own LOGIN_SUCCESS history. Never throws — a caller
 *  mid-login should never fail the login because scoring itself broke. */
export async function assessLoginRisk(userId: number, currentIp: string, currentUserAgent: string | null | undefined): Promise<LoginRiskAssessment> {
  try {
    const history = await db
      .select({ ipAddress: securityLogsTable.ipAddress, userAgent: securityLogsTable.userAgent, timestamp: securityLogsTable.timestamp })
      .from(securityLogsTable)
      .where(and(eq(securityLogsTable.userId, userId), eq(securityLogsTable.eventType, "LOGIN_SUCCESS")))
      .orderBy(desc(securityLogsTable.timestamp))
      .limit(MAX_HISTORY_ROWS);

    if (history.length < MIN_HISTORY_FOR_SCORING) {
      return { level: "low", reasons: [], isNewIp: false, isNewDevice: false, priorLoginsConsidered: history.length };
    }

    const knownIps = new Set(history.map((h) => h.ipAddress).filter((ip): ip is string => ip !== null));
    const knownDevices = new Set(history.map((h) => normalizeUserAgent(h.userAgent)));

    const isNewIp = currentIp !== "unknown" && !knownIps.has(currentIp);
    const isNewDevice = !knownDevices.has(normalizeUserAgent(currentUserAgent));

    const recentCutoff = new Date(Date.now() - RAPID_IP_CHANGE_WINDOW_MS);
    const recentDifferentIp = history.some((h) => h.timestamp >= recentCutoff && h.ipAddress !== null && h.ipAddress !== currentIp);

    let isOffHours = false;
    if (history.length >= MIN_HISTORY_FOR_TIME_PATTERN) {
      const stats = computeCircularStats(history.map((h) => hourOfDay(h.timestamp)));
      if (stats.concentration >= MIN_CONCENTRATION_FOR_TIME_CHECK) {
        const distance = circularHourDistance(hourOfDay(new Date()), stats.meanHour);
        const threshold = Math.max(OFF_HOURS_FLOOR_HOURS, stats.stdDevHours * OFF_HOURS_STDDEV_MULTIPLIER);
        isOffHours = distance > threshold;
      }
    }

    const reasons: string[] = [];
    let weight = 0;
    if (isNewIp) {
      reasons.push("first login from this IP address for this account");
      weight += WEIGHT_NEW_IP;
    }
    if (isNewDevice) {
      reasons.push("first login from this browser/device for this account");
      weight += WEIGHT_NEW_DEVICE;
    }
    if (recentDifferentIp) {
      reasons.push(`a different IP address logged in successfully for this account within the last ${RAPID_IP_CHANGE_WINDOW_MS / 60000} minutes`);
      weight += WEIGHT_RAPID_IP_CHANGE;
    }
    if (isOffHours) {
      reasons.push("this login's time of day is well outside this account's usual pattern");
      weight += WEIGHT_OFF_HOURS;
    }

    let level: RiskLevel = "low";
    if (weight >= HIGH_RISK_THRESHOLD) level = "high";
    else if (weight >= MEDIUM_RISK_THRESHOLD) level = "medium";

    return { level, reasons, isNewIp, isNewDevice, priorLoginsConsidered: history.length };
  } catch {
    // Scoring must never be able to break the login path it's observing.
    return { level: "low", reasons: [], isNewIp: false, isNewDevice: false, priorLoginsConsidered: 0 };
  }
}
