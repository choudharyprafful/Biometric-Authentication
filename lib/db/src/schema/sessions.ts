import { index, json, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent Express sessions used by connect-pg-simple.
 * The table structure intentionally matches that package's default "session"
 * store contract so session reads and writes remain database-backed.
 */
export const sessionsTable = pgTable(
  "session",
  {
    sid: text("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { withTimezone: false }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);