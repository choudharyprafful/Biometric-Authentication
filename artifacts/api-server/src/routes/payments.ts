import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
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
  RefundPaymentParams,
  RefundPaymentResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { encryptFile, decryptFile } from "../lib/fileEncryption";
import { PLANS, isPlanId } from "../lib/plans";
import { simulateProcessorDecision } from "../lib/paymentSimulation";

const router: IRouter = Router();
// Path-scoped: every router is mounted without a prefix, so an unscoped gate here would also run on requests meant for routers mounted after this one.
router.use("/payments", requireParentConsent, requireMfaEnrolled);

// Throttled independently of the subscription duplicate-guard, which only stops re-subscribing to the *same* plan, not rapid-fire calls in general.
const paymentRateLimit = requestRateLimit("payment", 15, 5 * 60 * 1000);

// Idempotency is enforced by the INSERT itself, not an upfront SELECT — a
// "check then insert" pattern has a TOCTOU race where concurrent requests
// with the same key can all pass the check before either commits, and the
// loser gets a raw unique-constraint error instead of the original payment.
// Catching that conflict and fetching the existing row closes the race by
// construction: there's no separate check-then-act window to lose.
function isIdempotencyKeyConflict(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } } | undefined)?.cause;
  return cause?.code === "23505" && cause?.constraint === "payments_idempotency_key_unique";
}

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
    declineCode: p.declineCode ?? null,
    declineMessage: p.declineMessage ?? null,
    providerToken,
    createdAt: p.createdAt.toISOString(),
  };
}

// Bounds only the self-service path — an admin can still refund an older payment. Matches the threat model's requirement (docs/04_Threat_Model_Risk_Assessment.md, R-PAY-3) for time-boxed + status-gated eligibility, not an unconditional refund button.
const SELF_SERVICE_REFUND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Fixed, server-defined catalog — no auth-specific data, so no session check.
router.get("/payments/plans", async (_req, res): Promise<void> => {
  res.json(ListPlansResponse.parse(Object.values(PLANS)));
});

// The client sends a planId only; the price is always looked up server-side from PLANS, never trusted from the request.
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

  const rawIdempotencyKey = req.headers["idempotency-key"];
  const idempotencyKey = typeof rawIdempotencyKey === "string" && rawIdempotencyKey.length > 0 ? rawIdempotencyKey : null;

  const providerToken = `tok_${crypto.randomUUID().replace(/-/g, "").substring(0, 24)}`;
  const encryptedToken = encryptFile(Buffer.from(providerToken, "utf8"));
  const decision = simulateProcessorDecision(parsed.data.cardLast4, plan.amount);

  let payment: typeof paymentsTable.$inferSelect | undefined;
  try {
    [payment] = await db.insert(paymentsTable).values({
      userId,
      userEmail: user?.email ?? null,
      amount: plan.amount,
      currency: plan.currency,
      description: plan.description,
      providerTokenCiphertext: encryptedToken.ciphertext,
      providerTokenIv: encryptedToken.iv,
      providerTokenAuthTag: encryptedToken.authTag,
      status: decision.status,
      declineCode: decision.declineCode,
      declineMessage: decision.declineMessage,
      idempotencyKey,
    }).returning();
  } catch (err) {
    if (idempotencyKey && isIdempotencyKeyConflict(err)) {
      // Scoped to the CALLING user, not just the key. The key column is
      // globally unique, so without this filter a caller who supplied a key
      // another account had already used would be handed that account's
      // payment back — userId, email, amount, status, and a decrypted
      // provider token. That is a cross-account disclosure reachable from a
      // request header, and the only thing standing in its way would be the
      // assumption that every client generates unguessable keys. Server-side
      // confidentiality cannot rest on client-side randomness.
      const [existing] = await db
        .select()
        .from(paymentsTable)
        .where(and(eq(paymentsTable.idempotencyKey, idempotencyKey), eq(paymentsTable.userId, userId)));
      if (existing) {
        await logEvent({ eventType: "PAYMENT_IDEMPOTENT_REPLAY", details: `Idempotency-Key race on /payments/subscribe — returned existing payment ${existing.id} instead of creating a duplicate`, userId, userEmail: user?.email });
        res.status(201).json(SubscribeResponse.parse({ payment: mapPayment(existing), subscriptionPlan: user?.subscriptionPlan ?? plan.id }));
        return;
      }
      // The key exists but belongs to someone else. Refuse without saying
      // whose it is, and log it: a client cannot legitimately collide with
      // another account's UUID by accident, so this is worth an analyst's
      // attention rather than a silent 500.
      await logEvent({ eventType: "UNAUTHORIZED_ACCESS", details: `Idempotency-Key on /payments/subscribe already belongs to a different account — refused`, userId, userEmail: user?.email });
      res.status(409).json({ error: "This Idempotency-Key has already been used. Use a new key for a new request." });
      return;
    }
    throw err;
  }

  if (!payment) {
    res.status(500).json({ error: "Failed to create subscription payment" });
    return;
  }

  if (decision.status === "failed") {
    await logEvent({
      eventType: "PAYMENT_FAILED",
      details: `Subscription payment for ${plan.name} declined (${decision.declineCode}): ${decision.declineMessage}`,
      userId,
      userEmail: user?.email,
    });
    res.status(402).json({ error: decision.declineMessage, declineCode: decision.declineCode, payment: mapPayment(payment) });
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

router.get("/payments", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [sessionUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  const isAdmin = sessionUser?.role === "admin";

  const payments = isAdmin
    ? await db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt))
    : await db.select().from(paymentsTable).where(eq(paymentsTable.userId, userId)).orderBy(desc(paymentsTable.createdAt));

  res.json(ListPaymentsResponse.parse(payments.map(mapPayment)));
});

router.post("/payments", paymentRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));

  // Idempotency-Key: a client retrying after a network blip gets back the original payment instead of a duplicate charge. Scoped globally via the column's unique constraint — client-generated keys are expected to be fresh UUIDs per attempt (see isIdempotencyKeyConflict above for why the constraint itself, not an upfront SELECT, enforces this).
  const rawIdempotencyKey = req.headers["idempotency-key"];
  const idempotencyKey = typeof rawIdempotencyKey === "string" && rawIdempotencyKey.length > 0 ? rawIdempotencyKey : null;

  // Raw card data never touches our server — only this generated provider token is stored.
  const providerToken = `tok_${crypto.randomUUID().replace(/-/g, "").substring(0, 24)}`;
  const encryptedToken = encryptFile(Buffer.from(providerToken, "utf8"));

  // cardLast4 is optional and never includes the full card number, expiry, or CVV.
  const decision = simulateProcessorDecision(parsed.data.cardLast4, parsed.data.amount);

  let payment: typeof paymentsTable.$inferSelect | undefined;
  try {
    [payment] = await db.insert(paymentsTable).values({
      userId,
      userEmail: user?.email ?? null,
      amount: parsed.data.amount,
      currency: parsed.data.currency.toUpperCase(),
      description: parsed.data.description,
      providerTokenCiphertext: encryptedToken.ciphertext,
      providerTokenIv: encryptedToken.iv,
      providerTokenAuthTag: encryptedToken.authTag,
      status: decision.status,
      declineCode: decision.declineCode,
      declineMessage: decision.declineMessage,
      idempotencyKey,
    }).returning();
  } catch (err) {
    if (idempotencyKey && isIdempotencyKeyConflict(err)) {
      // A concurrent insert by THIS user with this key already committed —
      // return that payment instead of the constraint error. The userId
      // filter is load-bearing, not defensive tidiness: see the matching
      // comment in /payments/subscribe above for why matching on the key
      // alone leaks another account's payment record.
      const [existing] = await db
        .select()
        .from(paymentsTable)
        .where(and(eq(paymentsTable.idempotencyKey, idempotencyKey), eq(paymentsTable.userId, userId)));
      if (existing) {
        await logEvent({ eventType: "PAYMENT_IDEMPOTENT_REPLAY", details: `Idempotency-Key race on /payments — returned existing payment ${existing.id} instead of creating a duplicate`, userId, userEmail: user?.email });
        res.status(201).json(CreatePaymentResponse.parse(mapPayment(existing)));
        return;
      }
      await logEvent({ eventType: "UNAUTHORIZED_ACCESS", details: `Idempotency-Key on /payments already belongs to a different account — refused`, userId, userEmail: user?.email });
      res.status(409).json({ error: "This Idempotency-Key has already been used. Use a new key for a new request." });
      return;
    }
    throw err;
  }

  if (!payment) {
    res.status(500).json({ error: "Failed to create payment" });
    return;
  }

  if (decision.status === "failed") {
    await logEvent({
      eventType: "PAYMENT_FAILED",
      details: `Payment of ${parsed.data.amount} ${parsed.data.currency} declined (${decision.declineCode}): ${decision.declineMessage}`,
      userId,
      userEmail: user?.email,
    });
    res.status(402).json({ error: decision.declineMessage, declineCode: decision.declineCode, payment: mapPayment(payment) });
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

// Self-service within a bounded window for the payment's own owner, or an admin at any time (see SELF_SERVICE_REFUND_WINDOW_MS above).
router.post("/payments/:id/refund", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = RefundPaymentParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, params.data.id));
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  const [sessionUser] = await db.select({ role: usersTable.role, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
  const isAdmin = sessionUser?.role === "admin";
  if (payment.userId !== userId && !isAdmin) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (payment.status !== "completed") {
    res.status(400).json({ error: `Only a completed payment can be refunded (current status: ${payment.status})` });
    return;
  }

  const ageMs = Date.now() - payment.createdAt.getTime();
  if (!isAdmin && ageMs > SELF_SERVICE_REFUND_WINDOW_MS) {
    res.status(400).json({ error: `This payment is outside the ${SELF_SERVICE_REFUND_WINDOW_MS / (24 * 60 * 60 * 1000)}-day self-service refund window — contact support` });
    return;
  }

  // The WHERE clause below, not the status check above, is what actually prevents a double refund: folding the status check into the UPDATE makes check-and-transition one atomic operation, so only the first of several concurrent requests can ever match status = "completed". No row returned means someone else's request already won; the lookup below is just to report an accurate message.
  const [updated] = await db
    .update(paymentsTable)
    .set({ status: "refunded" })
    .where(and(eq(paymentsTable.id, payment.id), eq(paymentsTable.status, "completed")))
    .returning();

  if (!updated) {
    const [current] = await db.select({ status: paymentsTable.status }).from(paymentsTable).where(eq(paymentsTable.id, payment.id));
    res.status(400).json({ error: `Only a completed payment can be refunded (current status: ${current?.status ?? "unknown"})` });
    return;
  }

  await logEvent({
    eventType: "PAYMENT_REFUNDED",
    details: `Payment ${payment.id} (${payment.amount} ${payment.currency}) refunded by ${isAdmin && payment.userId !== userId ? `admin (${sessionUser?.email})` : "the payment's own owner"}`,
    userId,
    userEmail: sessionUser?.email ?? payment.userEmail,
  });

  res.json(RefundPaymentResponse.parse(mapPayment(updated)));
});

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
