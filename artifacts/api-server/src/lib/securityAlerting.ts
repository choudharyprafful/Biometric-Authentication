/**
 * Pushes suspicious-activity alerts to an external channel instead of
 * waiting for someone to look at the dashboard. Email was deliberately not
 * used as that channel: no real SMTP/email-API provider is configured in
 * this environment, so a security-alert email would need a credential this
 * project has never had. A generic outgoing webhook needs only a URL, and
 * is the same integration point Slack, Discord, PagerDuty, and a plain
 * custom endpoint all already accept.
 */

import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { db, securityLogsTable } from "@workspace/db";
import { logEvent } from "./auditLog";
import { logger } from "./logger";
import { computeFaceVerificationAlerts } from "./faceVerificationAnomaly";
import { computeUploadAnomalyAlerts } from "./uploadAnomalyDetector";
import { computeAccountSharingAlerts } from "./sessionLimit";
import { computePaymentAbuseAlerts } from "./paymentLifecycle";

const ALERT_WINDOW_MINUTES = 15;
const RATE_LIMIT_SPIKE_THRESHOLD = 3;
const LOGIN_FAILURE_SPIKE_THRESHOLD = 5;

export interface SecurityAlert {
  id: string;
  severity: "medium" | "high";
  message: string;
  count: number;
  windowMinutes: number;
}

/**
 * Any upload refused because ClamAV didn't answer means nobody can upload,
 * so one is enough to raise it. It's an outage, not an attack.
 */
async function computeScannerAlerts(since: Date): Promise<SecurityAlert[]> {
  const [row] = await db
    .select({ count: count() })
    .from(securityLogsTable)
    .where(and(eq(securityLogsTable.eventType, "UPLOAD_SCAN_UNAVAILABLE"), gte(securityLogsTable.timestamp, since)));
  if (!row || row.count === 0) return [];
  return [{
    id: "upload-scanner-unavailable",
    severity: "high",
    message: `${row.count} upload${row.count === 1 ? "" : "s"} refused in the last ${ALERT_WINDOW_MINUTES} minutes because the virus scanner (ClamAV) didn't answer`,
    count: row.count,
    windowMinutes: ALERT_WINDOW_MINUTES,
  }];
}

/** Recomputed fresh from security_logs on every call — no cached alert state. */
export async function computeActiveAlerts(): Promise<SecurityAlert[]> {
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

  const groups = await Promise.all([
    computeScannerAlerts(since),
    computeFaceVerificationAlerts(),
    computeUploadAnomalyAlerts(),
    computeAccountSharingAlerts(),
    computePaymentAbuseAlerts(),
  ]);
  alerts.push(...groups.flat());

  return alerts.sort((a, b) => b.count - a.count);
}

export interface WebhookDeliveryResult {
  attempted: boolean;
  delivered: boolean;
  error: string | null;
}

const WEBHOOK_TIMEOUT_MS = 5000;

/** `text` and `content` are both included so a Slack-style receiver
 *  (`text`) and a Discord-style one (`content`) each pick up their own
 *  expected field from the same payload. Returns attempted:false (not an
 *  error) when no URL is configured — "nothing to do," not a failure. */
export async function deliverWebhook(alert: SecurityAlert): Promise<WebhookDeliveryResult> {
  const url = process.env["SECURITY_ALERT_WEBHOOK_URL"];
  if (!url) return { attempted: false, delivered: false, error: null };

  const line = `[SecureAI] ${alert.severity.toUpperCase()} — ${alert.message}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: line, content: line, alert }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    return { attempted: true, delivered: res.ok, error: res.ok ? null : `webhook endpoint returned HTTP ${res.status}` };
  } catch (err) {
    return { attempted: true, delivered: false, error: err instanceof Error ? err.message : "unknown error" };
  }
}

// Re-notifying every polling cycle for an ongoing spike would be noise —
// an alert id is only re-pushed after this much time since it was last
// delivered. In-memory only: a process restart forgetting the cooldown is
// an acceptable trade-off since detection itself is recomputed from
// durable data regardless.
const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;
const lastNotifiedAt = new Map<string, number>();

/** Only "high" severity pages out — "medium" stays visible on the
 *  dashboard but doesn't notify anyone. */
async function checkAndNotifyHighSeverityAlerts(): Promise<void> {
  const alerts = await computeActiveAlerts();
  const now = Date.now();

  for (const alert of alerts) {
    if (alert.severity !== "high") continue;
    const last = lastNotifiedAt.get(alert.id);
    if (last && now - last < NOTIFY_COOLDOWN_MS) continue;

    const result = await deliverWebhook(alert);
    if (!result.attempted) continue; // no webhook configured — nothing more to do this cycle

    lastNotifiedAt.set(alert.id, now);
    if (!result.delivered) {
      logger.warn({ alertId: alert.id, error: result.error }, "Security alert webhook delivery failed");
    }

    await logEvent({
      eventType: "SECURITY_ALERT_NOTIFIED",
      details: `${alert.message} — webhook delivery ${result.delivered ? "succeeded" : `failed (${result.error})`}`,
    });
  }
}

// Poll-based rather than event-driven off logEvent() itself, to keep the
// hash-chain-critical audit-log write path untouched by this. Overridable
// for testing without a real 2-minute wait.
const ALERT_POLL_INTERVAL_MS = Number(process.env["SECURITY_ALERT_POLL_INTERVAL_MS"] ?? 2 * 60 * 1000);

/** unref() so it never blocks shutdown. */
export function startSecurityAlertingJob(): void {
  checkAndNotifyHighSeverityAlerts().catch((err) => logger.warn({ err }, "Security alerting: initial check failed"));

  setInterval(() => {
    checkAndNotifyHighSeverityAlerts().catch((err) => logger.warn({ err }, "Security alerting: scheduled check failed"));
  }, ALERT_POLL_INTERVAL_MS).unref();
}
