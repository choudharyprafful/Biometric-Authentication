import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, paymentsTable } from "@workspace/db";
import { PaymentWebhookBody, PaymentWebhookResponse } from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { verifyWebhookSignature } from "../lib/webhookSignature";
import { decideWebhookTransition, placePaymentHold, reconcileSubscription } from "../lib/paymentLifecycle";

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
  const { type, paymentId } = parsed.data;

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, paymentId));
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const who = { userId: payment.userId, userEmail: payment.userEmail };

  // Out-of-order and replayed events are acknowledged (2xx, so the processor stops retrying) but
  // change nothing. See lib/paymentLifecycle.ts for the allowed transitions.
  const decision = decideWebhookTransition(payment.status, type);
  if (decision.kind === "ignore") {
    await logEvent({ eventType: "PAYMENT_WEBHOOK_IGNORED", details: `Webhook ${type} for payment ${payment.id} not applied: ${decision.reason}`, ...who });
    res.status(200).json(PaymentWebhookResponse.parse({ received: true, applied: false }));
    return;
  }
  if (decision.kind === "double_recovery") {
    const refunded = payment.refundedAt ? ` on ${payment.refundedAt.toISOString().slice(0, 10)}` : "";
    await logEvent({ eventType: "PAYMENT_DISPUTED", details: `Chargeback opened on payment ${payment.id}, which was already refunded${refunded}: the cardholder would be paid twice. Contest it with the refund record.`, ...who });
    if (payment.userId) await placePaymentHold(payment.userId, `chargeback opened on already-refunded payment ${payment.id}`);
    res.status(200).json(PaymentWebhookResponse.parse({ received: true, applied: false }));
    return;
  }

  // Conditional on the status just read, so two concurrent events can't both transition it.
  const [updated] = await db
    .update(paymentsTable)
    .set({ status: decision.to, ...(decision.to === "refunded" ? { refundedAt: new Date() } : {}) })
    .where(and(eq(paymentsTable.id, payment.id), eq(paymentsTable.status, payment.status)))
    .returning();
  if (!updated) {
    await logEvent({ eventType: "PAYMENT_WEBHOOK_IGNORED", details: `Webhook ${type} for payment ${payment.id} not applied: its status changed while the event was being handled`, ...who });
    res.status(200).json(PaymentWebhookResponse.parse({ received: true, applied: false }));
    return;
  }

  await logEvent({ eventType: "PAYMENT_WEBHOOK_RECEIVED", details: `Webhook ${type} applied to payment ${payment.id} (status ${payment.status} -> ${updated.status})`, ...who });
  if (type === "payment.disputed") {
    await logEvent({ eventType: "PAYMENT_DISPUTED", details: `Chargeback opened on payment ${payment.id} (${payment.amount} ${payment.currency})${payment.planId ? "; its plan is suspended while the dispute is open" : ""}`, ...who });
  } else if (type === "payment.dispute_won") {
    await logEvent({ eventType: "PAYMENT_DISPUTE_WON", details: `Chargeback on payment ${payment.id} decided in the merchant's favour; payment stands`, ...who });
  } else if (type === "payment.dispute_lost" && payment.userId) {
    await logEvent({ eventType: "PAYMENT_CHARGED_BACK", details: `Chargeback on payment ${payment.id} lost; ${payment.amount} ${payment.currency} returned to the cardholder`, ...who });
    await placePaymentHold(payment.userId, `chargeback lost on payment ${payment.id}`);
  }
  if (updated.planId && updated.userId) await reconcileSubscription(updated.userId, `subscription payment ${updated.id}: ${type}`);

  res.status(200).json(PaymentWebhookResponse.parse({ received: true, applied: true }));
});

export default router;
