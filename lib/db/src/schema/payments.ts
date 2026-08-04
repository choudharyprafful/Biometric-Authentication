import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  userEmail: text("user_email"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status", { enum: ["pending", "completed", "failed", "refunded"] }).notNull().default("pending"),
  description: text("description").notNull(),
  providerToken: text("provider_token").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, providerToken: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
