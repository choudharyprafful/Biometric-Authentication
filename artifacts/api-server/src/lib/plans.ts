/**
 * Canonical subscription catalog — prices live here, server-side, and
 * nowhere else. The client sends a planId only; it never supplies an
 * amount. This is what "prevent subscription abuse" (brief, Payments)
 * actually means in practice — otherwise a client could POST any price
 * it likes for a "Pro" subscription.
 */
export const PLANS = {
  plus: {
    id: "plus",
    name: "Plus",
    amount: 20,
    currency: "USD",
    interval: "month",
    description: "SecureAI Plus — monthly subscription",
    features: ["Priority threat monitoring", "90-day audit log retention", "Email alerts"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    amount: 60,
    currency: "USD",
    interval: "month",
    description: "SecureAI Pro — monthly subscription",
    features: ["Everything in Plus", "Full API access", "Advanced analytics", "Priority support"],
  },
  team: {
    id: "team",
    name: "Team",
    amount: 150,
    currency: "USD",
    interval: "month",
    description: "SecureAI Team — monthly subscription",
    features: ["Everything in Pro", "Multi-seat management", "SSO", "Dedicated support"],
  },
} as const;

export type PlanId = keyof typeof PLANS;

export function isPlanId(value: string): value is PlanId {
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}
