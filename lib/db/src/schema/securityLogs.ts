import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const securityLogsTable = pgTable("security_logs", {
  id: serial("id").primaryKey(),
  // Not a foreign key on purpose — an ON DELETE SET NULL would mutate this
  // row's content after its hash was computed, breaking the chain when a
  // user is deleted. userEmail below is the durable way to identify "who".
  userId: integer("user_id"),
  userEmail: text("user_email"),
  eventType: text("event_type").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  details: text("details").notNull().default(""),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  // hash = SHA-256(prevHash + row content). Editing, deleting, or
  // reordering a row breaks the chain, caught by GET /security/logs/verify.
  // Nullable since rows from before this existed aren't backfilled.
  prevHash: text("prev_hash"),
  hash: text("hash"),
});

export const insertSecurityLogSchema = createInsertSchema(securityLogsTable).omit({ id: true, timestamp: true });
export type InsertSecurityLog = z.infer<typeof insertSecurityLogSchema>;
export type SecurityLog = typeof securityLogsTable.$inferSelect;
