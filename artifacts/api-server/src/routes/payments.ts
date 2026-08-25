import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, paymentsTable, usersTable } from "@workspace/db";
import {
  CreatePaymentBody,
  CreatePaymentResponse,
  GetPaymentParams,
  GetPaymentResponse,
  ListPaymentsResponse,
  ListPlansResponse,
  SubscribeBody,
  SubscribeResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { encryptFile, decryptFile } from "../lib/fileEncryption";
import { PLANS, isPlanId } from "../lib/plans";

const router: IRouter = Router();
router.use(requireMfaEnrolled);

// Payment creation is the one action here with real (simulated) financial
// meaning — throttle it independently of the subscription duplicate-guard,
// which only stops re-subscribing to the *same* plan, not rapid-fire calls
// in general.
const paymentRateLimit = requestRateLimit("payment", 15, 5 * 60 * 1000);

function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const providerToken = decryptFile({
    ciphertext: p.providerTokenCiphertext,
    iv: p.providerTokenIv,
    authTag: p.providerTokenAuthTag,
  }).toString("utf8");

  return {
    id: p.id,
    userId: p.userId,
    userEmail: p.userEmail ?? null,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    description: p.description,
    providerToken,
    createdAt: p.createdAt.toISOString(),
  };
}

// GET /payments/plans — fixed, server-defined catalog (no auth-specific data)
router.get("/payments/plans", async (_req, res): Promise<void> => {
  res.json(ListPlansResponse.parse(Object.values(PLANS)));
});

// POST /payments/subscribe — the client sends a planId only; the price is
// always looked up server-side from PLANS, never trusted from the request.
router.post("/payments/subscribe", paymentRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const parsed = SubscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!isPlanId(parsed.data.planId)) {
    res.status(400).json({ error: "Unknown plan" });
    return;
  }
  const plan = PLANS[parsed.data.planId];

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (user?.subscriptionPlan === plan.id) {
    res.status(400).json({ error: `Already subscribed to ${plan.name}` });
    return;
  }

  const providerToken = `tok_${crypto.randomUUID().replace(/-/g, "").substring(0, 24)}`;
  const encryptedToken = encryptFile(Buffer.from(providerToken, "utf8"));

  const [payment] = await db.insert(paymentsTable).values({
    userId,
    userEmail: user?.email ?? null,
    amount: plan.amount,
    currency: plan.currency,
    description: plan.description,
    providerTokenCiphertext: encryptedToken.ciphertext,
    providerTokenIv: encryptedToken.iv,
    providerTokenAuthTag: encryptedToken.authTag,
    status: "completed", // Simulated — always succeeds in demo
  }).returning();

  if (!payment) {
    res.status(500).json({ error: "Failed to create subscription payment" });
    return;
  }

  await db.update(usersTable).set({ subscriptionPlan: plan.id }).where(eq(usersTable.id, userId));

  await logEvent({
    eventType: "SUBSCRIPTION_CHANGED",
    details: `Subscribed to ${plan.name} (${plan.amount} ${plan.currency}/${plan.interval})`,
    userId,
    userEmail: user?.email,
  });

  res.status(201).json(SubscribeResponse.parse({
    payment: mapPayment(payment),
    subscriptionPlan: plan.id,
  }));
});

// GET /payments
router.get("/payments", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const isAdmin = sessionUser?.role === "admin";

  const payments = isAdmin
    ? await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt))
    : await db.select().from(paymentsTable).where(eq(paymentsTable.userId, userId)).orderBy(desc(paymentsTable.createdAt));

  res.json(ListPaymentsResponse.parse(payments.map(mapPayment)));
});

// POST /payments
router.post("/payments", paymentRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));

  // Stripe-style: generate a provider token — raw card data never touches our server
  const providerToken = `tok_${crypto.randomUUID().replace(/-/g, "").substring(0, 24)}`;
  const encryptedToken = encryptFile(Buffer.from(providerToken, "utf8"));

  const [payment] = await db.insert(paymentsTable).values({
    userId,
    userEmail: user?.email ?? null,
    amount: parsed.data.amount,
    currency: parsed.data.currency.toUpperCase(),
    description: parsed.data.description,
    providerTokenCiphertext: encryptedToken.ciphertext,
    providerTokenIv: encryptedToken.iv,
    providerTokenAuthTag: encryptedToken.authTag,
    status: "completed", // Simulated — always succeeds in demo
  }).returning();

  if (!payment) {
    res.status(500).json({ error: "Failed to create payment" });
    return;
  }

  await logEvent({
    eventType: "PAYMENT_CREATED",
    details: `Payment of ${parsed.data.amount} ${parsed.data.currency} created (token: ${providerToken.substring(0, 12)}...)`,
    userId,
    userEmail: user?.email,
  });

  res.status(201).json(CreatePaymentResponse.parse(mapPayment(payment)));
});

// GET /payments/:id
router.get("/payments/:id", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = GetPaymentParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, params.data.id));
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (payment.userId !== userId && sessionUser?.role !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json(GetPaymentResponse.parse(mapPayment(payment)));
});

export default router;
