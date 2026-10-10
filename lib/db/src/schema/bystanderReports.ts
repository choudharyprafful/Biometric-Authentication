import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Reports from people who appear in someone else's upload (Team 2's Bystander Consent Policy, section
 * 6; docs/08 section 5h). The person reporting needs no account. Staff match the report to an upload,
 * pause the file while they review it, tell the uploader, and record the outcome (section 7).
 */
export const bystanderReportsTable = pgTable("bystander_reports", {
  id: serial("id").primaryKey(),
  // How to reach the person reporting, and who they are to the content.
  reporterEmail: text("reporter_email").notNull(),
  reporterName: text("reporter_name"),
  relationship: text("relationship", {
    enum: ["self", "parent-or-guardian"],
  }).notNull(),
  request: text("request", { enum: ["review", "removal"] }).notNull(),
  contentDescription: text("content_description").notNull(),
  // Whatever the person knows about who uploaded it: a name, an email, where they saw it.
  uploaderHint: text("uploader_hint"),
  // open → paused (matched to an upload, which is paused and its uploader told) → removed,
  // not-upheld or no-match.
  status: text("status", {
    enum: ["open", "paused", "removed", "not-upheld", "no-match"],
  })
    .notNull()
    .default("open"),
  // Copies, not foreign keys: the record must outlive the file and the account.
  uploadId: integer("upload_id"),
  uploaderEmail: text("uploader_email"),
  staffNote: text("staff_note"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  handledByEmail: text("handled_by_email"),
});

export type BystanderReport = typeof bystanderReportsTable.$inferSelect;
