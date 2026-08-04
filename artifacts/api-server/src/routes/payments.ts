import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, paymentsTable, usersTable } from "@workspace/db";
import {
  CreatePaymentBody,
  CreatePaymentResponse,
  GetPaymentParams,
  GetPaymentResponse,
  ListPaymentsResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";

const router: IRouter = Router();

function mapPayment(p: typeof paymentsTable.$inferSelect) {
  return {
    id: p.id,
    userId: p.userId,
    userEmail: p.userEmail ?? null,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    description: p.description,
    providerToken: p.providerToken,
    createdAt: p.createdAt.toISOString(),
  };
}

// GET /payments
router.get("/payments", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
  const isAdmin = sessionUser?.role === "admin";

  const payments = isAdmin
    ? await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt))
    : await db.select().from(paymentsTable).where(eq(paymentsTable.userId, req.session.userId)).orderBy(desc(paymentsTable.createdAt));

  res.json(ListPaymentsResponse.parse(payments.map(mapPayment)));
});

// POST /payments
router.post("/payments", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, req.session.userId));

  // Stripe-style: generate a provider token — raw card data never touches our server
  const providerToken = `tok_${crypto.randomUUID().replace(/-/g, "").substring(0, 24)}`;

  const [payment] = await db.insert(paymentsTable).values({
    userId: req.session.userId,
    userEmail: user?.email ?? null,
    amount: parsed.data.amount,
    currency: parsed.data.currency.toUpperCase(),
    description: parsed.data.description,
    providerToken,
    status: "completed", // Simulated — always succeeds in demo
  }).returning();

  if (!payment) {
    res.status(500).json({ error: "Failed to create payment" });
    return;
  }

  await logEvent({
    eventType: "PAYMENT_CREATED",
    details: `Payment of ${parsed.data.amount} ${parsed.data.currency} created (token: ${providerToken.substring(0, 12)}...)`,
    userId: req.session.userId,
    userEmail: user?.email,
  });

  res.status(201).json(CreatePaymentResponse.parse(mapPayment(payment)));
});

// GET /payments/:id
router.get("/payments/:id", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

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

  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (payment.userId !== req.session.userId && sessionUser?.role !== "admin") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json(GetPaymentResponse.parse(mapPayment(payment)));
});

export default router;
