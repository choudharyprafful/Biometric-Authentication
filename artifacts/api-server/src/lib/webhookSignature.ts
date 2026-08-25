import crypto from "node:crypto";

/**
 * HMAC-SHA256 webhook signature verification, Stripe-style: the payload is
 * signed together with a timestamp (`${timestamp}.${rawBody}`), and a stale
 * timestamp is rejected even with a valid signature — this is what stops a
 * captured, genuinely-signed webhook from being replayed later.
 *
 * There's no real external payment provider behind this demo, so nothing
 * ever calls this in production — it exists to demonstrate the control the
 * brief asks for ("validate payment webhooks"). WEBHOOK_SECRET would be the
 * shared secret issued by the real provider in an actual integration.
 */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes

function resolveWebhookSecret(): string {
  return process.env["WEBHOOK_SECRET"] || "fallback-dev-webhook-secret-change-in-prod";
}

export function signWebhookPayload(rawBody: string, timestamp: number): string {
  return crypto.createHmac("sha256", resolveWebhookSecret()).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined, timestampHeader: string | undefined): boolean {
  if (!signatureHeader || !timestampHeader) return false;

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() - timestamp) > MAX_TIMESTAMP_SKEW_MS) return false; // stale or future — reject (anti-replay)

  const expected = signWebhookPayload(rawBody, timestamp);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
