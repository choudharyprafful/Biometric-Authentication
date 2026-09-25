/**
 * Subscription abuse controls (brief: Payments, "prevent subscription abuse"; docs/04 R-PAY-3,
 * R-PAY-6, R-PAY-9): what a processor event may do to a payment, and what reversing a
 * subscription payment does to the account's plan.
 *
 * The plan an account is on is derived from its payments rather than trusted once set: after any
 * refund, chargeback or dispute outcome, the account gets the plan of its latest subscription
 * payment that still stands, or free. Before this, refunding a subscription left the paid plan in
 * place, so subscribe -> refund -> keep the plan was free service, repeatable at will.
 */
import { and, count, desc, eq, gte, isNotNull } from "drizzle-orm";
import { db, paymentsTable, securityLogsTable, usersTable } from "@workspace/db";
import { logEvent } from "./auditLog";
import type { SecurityAlert } from "./securityAlerting";

export type PaymentStatus = "pending" | "completed" | "failed" | "refunded" | "disputed" | "charged_back";
export type PlanId = "free" | "plus" | "pro" | "team";
export type WebhookEventType =
  | "payment.completed"
  | "payment.failed"
  | "payment.refunded"
  | "payment.disputed"
  | "payment.dispute_won"
  | "payment.dispute_lost";

/** One self-service subscription refund per account per 365 days; staff can refund beyond it. */
export const SELF_SERVICE_SUBSCRIPTION_REFUNDS_PER_YEAR = 1;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const TRANSITIONS: Record<WebhookEventType, { from: readonly PaymentStatus[]; to: PaymentStatus }> = {
  "payment.completed": { from: ["pending"], to: "completed" },
  "payment.failed": { from: ["pending"], to: "failed" },
  "payment.refunded": { from: ["completed"], to: "refunded" },
  "payment.disputed": { from: ["completed"], to: "disputed" },
  "payment.dispute_won": { from: ["disputed"], to: "completed" },
  "payment.dispute_lost": { from: ["disputed"], to: "charged_back" },
};

export type WebhookDecision =
  | { kind: "apply"; to: PaymentStatus }
  // A chargeback on money already refunded: the cardholder would be paid twice.
  | { kind: "double_recovery" }
  | { kind: "ignore"; reason: string };

/**
 * What a processor event does to a payment in `status`. Anything outside the table is a replay or
 * out-of-order event and changes nothing: before this, any signed event set any status, so a
 * replayed "payment.completed" could turn a refunded payment back into a paid one.
 */
export function decideWebhookTransition(status: PaymentStatus, type: WebhookEventType): WebhookDecision {
  if (type === "payment.disputed" && status === "refunded") return { kind: "double_recovery" };
  const rule = TRANSITIONS[type];
  if (rule.from.includes(status)) return { kind: "apply", to: rule.to };
  return { kind: "ignore", reason: `${type} only applies to a ${rule.from.join(" or ")} payment; this one is ${status}` };
}

/** The plan of the account's latest subscription payment that still stands, or free. */
export async function effectivePlan(userId: number): Promise<PlanId> {
  const [latest] = await db
    .select({ planId: paymentsTable.planId })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.userId, userId), isNotNull(paymentsTable.planId), eq(paymentsTable.status, "completed")))
    .orderBy(desc(paymentsTable.createdAt), desc(paymentsTable.id))
    .limit(1);
  return latest?.planId ?? "free";
}

/** Puts the account on the plan its payments support. Call after a subscription payment changes status. */
export async function reconcileSubscription(userId: number, reason: string): Promise<PlanId | null> {
  const [user] = await db.select({ plan: usersTable.subscriptionPlan, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return null;
  const plan = await effectivePlan(userId);
  if (plan !== user.plan) {
    await db.update(usersTable).set({ subscriptionPlan: plan }).where(eq(usersTable.id, userId));
    await logEvent({ eventType: "SUBSCRIPTION_CHANGED", details: `Plan changed from ${user.plan} to ${plan}: ${reason}`, userId, userEmail: user.email });
  }
  return plan;
}

// Anything that can run a select: the shared pool or an open transaction.
type Executor = Pick<typeof db, "select">;

export async function subscriptionRefundsInLastYear(userId: number, executor: Executor = db): Promise<number> {
  const [row] = await executor
    .select({ n: count() })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.userId, userId), isNotNull(paymentsTable.planId), gte(paymentsTable.refundedAt, new Date(Date.now() - YEAR_MS))));
  return row?.n ?? 0;
}

/** Refuses new purchases until an admin clears it (DELETE /users/:id/payment-hold). */
export async function placePaymentHold(userId: number, reason: string): Promise<void> {
  const [user] = await db
    .update(usersTable)
    .set({ paymentHold: true })
    .where(and(eq(usersTable.id, userId), eq(usersTable.paymentHold, false)))
    .returning({ email: usersTable.email });
  if (user) await logEvent({ eventType: "PAYMENT_HOLD_PLACED", details: `Payment hold placed: ${reason}`, userId, userEmail: user.email });
}

/** Chargebacks opened, and accounts put on hold, in the last 24 hours. */
export async function computePaymentAbuseAlerts(): Promise<SecurityAlert[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tally = async (eventType: "PAYMENT_DISPUTED" | "PAYMENT_HOLD_PLACED") => {
    const [row] = await db
      .select({ n: count() })
      .from(securityLogsTable)
      .where(and(eq(securityLogsTable.eventType, eventType), gte(securityLogsTable.timestamp, since)));
    return row?.n ?? 0;
  };
  const [disputes, holds] = await Promise.all([tally("PAYMENT_DISPUTED"), tally("PAYMENT_HOLD_PLACED")]);
  const alerts: SecurityAlert[] = [];
  if (holds > 0) {
    alerts.push({
      id: "payment-holds",
      severity: "high",
      message: `${holds} account${holds === 1 ? "" : "s"} put on payment hold in the last 24 hours (lost chargeback, or a chargeback on an already-refunded payment)`,
      count: holds,
      windowMinutes: 24 * 60,
    });
  }
  if (disputes > 0) {
    alerts.push({
      id: "payment-disputes",
      severity: "medium",
      message: `${disputes} chargeback${disputes === 1 ? "" : "s"} opened in the last 24 hours`,
      count: disputes,
      windowMinutes: 24 * 60,
    });
  }
  return alerts;
}
