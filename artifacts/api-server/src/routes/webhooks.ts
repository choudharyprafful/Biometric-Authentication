import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentsTable } from "@workspace/db";
import { PaymentWebhookBody, PaymentWebhookResponse } from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { verifyWebhookSignature } from "../lib/webhookSignature";

/**
 * Server-to-server webhook endpoints — no browser session, so they must be
 * mounted in their own router registered before any other router that
 * applies a blanket `router.use(someAuthMiddleware)` (e.g. security.ts).
 * That kind of path-less `.use()` acts as a catch-all gate for every
 * request that falls through to it, not just that router's own routes —
 * mounting this router first means webhook requests never reach it.
 * Trust here comes entirely from the HMAC signature, not a cookie.
 */
const router: IRouter = Router();

// POST /payments/webhook
router.post("/payments/webhook", async (req, res): Promise<void> => {
  const signature = req.headers["x-webhook-signature"];
  const timestamp = req.headers["x-webhook-timestamp"];
  const rawBody = req.rawBody ? req.rawBody.toString("utf8") : "";

  const valid = verifyWebhookSignature(
    rawBody,
    typeof signature === "string" ? signature : undefined,
    typeof timestamp === "string" ? timestamp : undefined,
  );
  if (!valid) {
    await logEvent({ eventType: "PAYMENT_WEBHOOK_REJECTED", details: "Payment webhook rejected — invalid, missing, or stale signature" });
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const parsed = PaymentWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, parsed.data.paymentId));
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const statusByType = {
    "payment.completed": "completed",
    "payment.failed": "failed",
    "payment.refunded": "refunded",
  } as const;
  const newStatus = statusByType[parsed.data.type];

  await db.update(paymentsTable).set({ status: newStatus }).where(eq(paymentsTable.id, payment.id));
  await logEvent({
    eventType: "PAYMENT_WEBHOOK_RECEIVED",
    details: `Webhook ${parsed.data.type} applied to payment ${payment.id} (status -> ${newStatus})`,
    userId: payment.userId,
    userEmail: payment.userEmail,
  });

  res.status(200).json(PaymentWebhookResponse.parse({ received: true }));
});

export default router;
