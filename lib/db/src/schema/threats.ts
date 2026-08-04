import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const threatsTable = pgTable("threats", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  severity: text("severity", { enum: ["low", "medium", "high", "critical"] }).notNull(),
  description: text("description").notNull(),
  status: text("status", { enum: ["active", "mitigated", "resolved"] }).notNull().default("active"),
  affectedUsers: integer("affected_users"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const insertThreatSchema = createInsertSchema(threatsTable).omit({ id: true, timestamp: true });
export type InsertThreat = z.infer<typeof insertThreatSchema>;
export type Threat = typeof threatsTable.$inferSelect;
