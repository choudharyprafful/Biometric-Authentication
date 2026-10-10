import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const uploadsTable = pgTable("uploads", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileType: text("file_type", {
    enum: ["image", "video", "text", "audio"],
  }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  // AES-256-GCM ciphertext/iv/authTag, each base64-encoded. Plaintext file
  // bytes never touch the database — see lib/fileEncryption.ts.
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  // Where this file's content came from, per Team 2's Data Source
  // Acceptability Matrix (docs/09). Defaults to "unspecified", which is NOT
  // a matrix row and is NOT trainable — an upload that never declared an
  // origin (including every row predating this column) is excluded from
  // training rather than assumed to be the uploader's own work. The rules
  // that read this live in api-server/src/lib/dataProvenance.ts.
  contentSource: text("content_source", {
    enum: [
      "own_work",
      "third_party_individual",
      "published_work",
      "social_media",
      "incidental_third_party_ip",
      "unspecified",
    ],
  })
    .notNull()
    .default("unspecified"),
  // Team 2's Bystander Consent Policy (docs/08 section 5h): whether the file shows or names anyone
  // besides the uploader. Null = never asked (uploads before 2026-10-07, or an older phone app);
  // empty = no one else; otherwise who: "minor", "deceased", "reachable" (someone the uploader has
  // told, who doesn't object) and/or "unreachable" (someone they can't contact). The rules that read
  // it are in api-server/src/lib/dataProvenance.ts.
  bystanders: text("bystanders").array(),
  // The uploader's statement for a "reachable" person, kept with when it was made.
  bystanderStatement: text("bystander_statement"),
  bystandersDeclaredAt: timestamp("bystanders_declared_at", {
    withTimezone: true,
  }),
  // Set while a report from someone in the file is reviewed: the file is kept, and used by nothing.
  pausedForReviewAt: timestamp("paused_for_review_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertUploadSchema = createInsertSchema(uploadsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUpload = z.infer<typeof insertUploadSchema>;
export type Upload = typeof uploadsTable.$inferSelect;
