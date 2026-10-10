import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Legal holds (docs/12_Data_Breach_Response_Plan.md section 3; privacy policy section 9). When a
 * government or law-enforcement request arrives, an administrator places a hold on the person it
 * names. While the hold is active, anything of theirs that would otherwise be deleted (by them, by
 * staff, or by the retention purge) is first copied into legal_hold_items. Releasing the hold
 * deletes the copies.
 */
export const legalHoldsTable = pgTable("legal_holds", {
  id: serial("id").primaryKey(),
  // Copies, not foreign keys: the hold must outlive the account. Security records often carry only
  // the account id, payment records only the email, so both are kept.
  subjectEmail: text("subject_email").notNull(),
  subjectUserId: integer("subject_user_id"),
  agency: text("agency").notNull(),
  reference: text("reference"),
  reason: text("reason").notNull(),
  placedByEmail: text("placed_by_email").notNull(),
  placedAt: timestamp("placed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedByEmail: text("released_by_email"),
  releaseReason: text("release_reason"),
});

/** One copy of one record, kept for a hold. Encrypted fields stay encrypted, as stored. */
export const legalHoldItemsTable = pgTable(
  "legal_hold_items",
  {
    id: serial("id").primaryKey(),
    holdId: integer("hold_id")
      .notNull()
      .references(() => legalHoldsTable.id, { onDelete: "cascade" }),
    // account, face-template, upload, passkey, phone-key, payment or security-record
    kind: text("kind").notNull(),
    sourceId: integer("source_id").notNull(),
    // placed (copied when the hold was placed), deleted (about to be deleted or replaced) or
    // retention (about to reach the end of its retention period)
    reason: text("reason").notNull(),
    data: jsonb("data").notNull(),
    // The same record unchanged is copied once; a changed one is copied again.
    dataSha256: text("data_sha256").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("legal_hold_items_one_copy").on(
      table.holdId,
      table.kind,
      table.sourceId,
      table.dataSha256,
    ),
  ],
);

export type LegalHold = typeof legalHoldsTable.$inferSelect;
export type LegalHoldItem = typeof legalHoldItemsTable.$inferSelect;
