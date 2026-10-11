import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Minted at sign-up, and again when the account holder asks for a new link (which retires the
// earlier ones). 24 hours: long enough to find the email, short enough that an old link lying in
// an inbox stops working. Removed with the account, and by the hourly token purge once used or
// expired.
export const emailVerificationTokensTable = pgTable(
  "email_verification_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Only a SHA-256 hash is stored; the raw token only exists in the emailed (or dev-mode
    // returned) link.
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const insertEmailVerificationTokenSchema = createInsertSchema(
  emailVerificationTokensTable,
).omit({ id: true, createdAt: true });
export type InsertEmailVerificationToken = z.infer<
  typeof insertEmailVerificationTokenSchema
>;
export type EmailVerificationToken =
  typeof emailVerificationTokensTable.$inferSelect;
