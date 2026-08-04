import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const securityLogsTable = pgTable("security_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userEmail: text("user_email"),
  eventType: text("event_type").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  details: text("details").notNull().default(""),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSecurityLogSchema = createInsertSchema(securityLogsTable).omit({ id: true, timestamp: true });
export type InsertSecurityLog = z.infer<typeof insertSecurityLogSchema>;
export type SecurityLog = typeof securityLogsTable.$inferSelect;
