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
  status: text("status", { enum: ["pending", "completed", "failed", "refunded"] }).notNull().default("pending"),
  description: text("description").notNull(),
  // AES-256-GCM encrypted at rest (see lib/fileEncryption.ts).
  providerTokenCiphertext: text("provider_token_ciphertext").notNull(),
  providerTokenIv: text("provider_token_iv").notNull(),
  providerTokenAuthTag: text("provider_token_auth_tag").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, providerTokenCiphertext: true, providerTokenIv: true, providerTokenAuthTag: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
