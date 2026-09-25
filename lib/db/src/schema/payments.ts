import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  // SET NULL, not CASCADE: payment records survive account deletion
  // (userEmail preserves who it was).
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userEmail: text("user_email"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  // disputed: the cardholder opened a chargeback; charged_back: the dispute was lost and the money
  // returned to them. Allowed transitions are in lib/paymentLifecycle.ts.
  status: text("status", { enum: ["pending", "completed", "failed", "refunded", "disputed", "charged_back"] }).notNull().default("pending"),
  // The plan this payment bought, for subscription payments only. After a refund or chargeback the
  // account is put on the plan of its latest subscription payment that still stands (see
  // lib/paymentLifecycle.ts); without this link a refunded subscription kept its paid tier.
  planId: text("plan_id", { enum: ["plus", "pro", "team"] }),
  // When a refund was granted; limits self-service subscription refunds per account per year.
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  description: text("description").notNull(),
  // Populated only when status = "failed" — see lib/paymentSimulation.ts.
  // Both null on every successful or still-pending payment.
  declineCode: text("decline_code"),
  declineMessage: text("decline_message"),
  // Client-generated, e.g. crypto.randomUUID() per purchase attempt.
  // Globally unique (not just per-user): a retried request with the same
  // key returns the ORIGINAL payment instead of creating a second charge
  // — see routes/payments.ts. Null for payments created before this
  // existed, or from any call that doesn't supply one.
  idempotencyKey: text("idempotency_key").unique(),
  // AES-256-GCM encrypted at rest (see lib/fileEncryption.ts).
  providerTokenCiphertext: text("provider_token_ciphertext").notNull(),
  providerTokenIv: text("provider_token_iv").notNull(),
  providerTokenAuthTag: text("provider_token_auth_tag").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, providerTokenCiphertext: true, providerTokenIv: true, providerTokenAuthTag: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
