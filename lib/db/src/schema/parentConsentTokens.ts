import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Minted once, automatically, at registration time for an under-threshold
// account (not requested later like a password reset — there's no "resend"
// flow in this PoC). A 7-day TTL, deliberately much longer than the
// password-reset token's 30 minutes: a parent/guardian confirming their
// child's account isn't a time-pressured security action, it's something
// they'll get to when they see the email.
export const parentConsentTokensTable = pgTable("parent_consent_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // Only a SHA-256 hash of the token is stored — the raw token is a bearer
  // credential and only ever exists in the (emailed, or dev-mode returned) link.
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertParentConsentTokenSchema = createInsertSchema(
  parentConsentTokensTable,
).omit({ id: true, createdAt: true });
export type InsertParentConsentToken = z.infer<
  typeof insertParentConsentTokenSchema
>;
export type ParentConsentToken = typeof parentConsentTokensTable.$inferSelect;
