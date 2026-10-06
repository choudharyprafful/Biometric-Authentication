/**
 * Emails high-severity security alerts to the addresses in SECURITY_ALERT_EMAILS (comma-separated),
 * through the same SMTP account as the password-reset and breach-notice email (lib/mailer.ts). Kept
 * apart from lib/securityAlerting.ts, which needs the database, so alertEmail.verify.ts can test it
 * against a fake mail server alone.
 */
import { appUrl, isEmailConfigured, sendMail } from "./mailer";
import type { SecurityAlert } from "./securityAlerting";

export interface EmailDeliveryResult {
  attempted: boolean;
  recipients: number;
  delivered: number;
}

export function alertRecipients(): string[] {
  return (process.env["SECURITY_ALERT_EMAILS"] ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

// Alert messages can carry text staff typed (a breach title) and request data (an IP address);
// control characters are removed so nothing in them can start a new mail header line.
const oneLine = (text: string) =>
  text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

function raisedAt(): string {
  return new Date().toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    dateStyle: "long",
    timeStyle: "short",
  });
}

/** attempted:false when no recipient is set or email isn't configured: nothing to do, not a failure. */
export async function deliverAlertEmail(
  alert: SecurityAlert,
): Promise<EmailDeliveryResult> {
  const to = alertRecipients();
  if (to.length === 0 || !isEmailConfigured())
    return { attempted: false, recipients: to.length, delivered: 0 };

  const message = oneLine(alert.message);
  const subject = `[SecureAI] ${alert.severity.toUpperCase()} security alert: ${message.length > 120 ? `${message.slice(0, 117)}...` : message}`;
  const text = [
    "A high-severity security alert was raised on SecureAI.",
    "",
    message,
    "",
    `Raised: ${raisedAt()} (Sydney time)`,
    `Alert: ${oneLine(alert.id)}`,
    `Security dashboard: ${appUrl("/dashboard")}`,
    "",
    "While the alert stays active it is emailed again at most every 30 minutes.",
  ].join("\n");

  const sent = await Promise.all(
    to.map((address) => sendMail(address, subject, text)),
  );
  return {
    attempted: true,
    recipients: to.length,
    delivered: sent.filter(Boolean).length,
  };
}
