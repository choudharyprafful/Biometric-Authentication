import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { uploadsTable } from "./uploads";
import { usersTable } from "./users";

/**
 * Consent requests to someone in a file who has their own SecureAI account (Team 2's Bystander
 * Consent Policy, section 4, first row: "the one case where genuine, specific consent is actually
 * obtainable"; User Data Case Studies, item 2). The uploader gives the person's email address; an
 * account with that confirmed address sees the request and answers each use separately. The
 * uploader sees "waiting" until then, whether or not such an account exists, so the request can't be
 * used to find out who has an account. The rules that read the answers are in
 * api-server/src/lib/dataProvenance.ts (assessPeopleRules).
 */
export const bystanderConsentRequestsTable = pgTable(
  "bystander_consent_requests",
  {
    id: serial("id").primaryKey(),
    uploadId: integer("upload_id")
      .notNull()
      .references(() => uploadsTable.id, { onDelete: "cascade" }),
    // The address the uploader gave, lower-cased. Matched against confirmed account addresses when
    // read, so it also reaches someone who signs up later.
    subjectEmail: text("subject_email").notNull(),
    // Each use answered on its own: null until answered. personalisation = the uploader's own
    // topic profile; sharedTraining = anything shared across accounts (nothing does today; the
    // answer is kept so anything that ever does has to honour it).
    personalisation: boolean("personalisation"),
    sharedTraining: boolean("shared_training"),
    // Whoever answered. Deleting that account deletes the answer with it, which leaves the file
    // unusable again until someone else agrees.
    answeredByUserId: integer("answered_by_user_id").references(
      () => usersTable.id,
      { onDelete: "cascade" },
    ),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bystander_consent_requests_one_per_person").on(
      t.uploadId,
      t.subjectEmail,
    ),
  ],
);

export type BystanderConsentRequest =
  typeof bystanderConsentRequestsTable.$inferSelect;
