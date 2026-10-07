import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * The data breach register (docs/12_Data_Breach_Response_Plan.md). Under Australia's Notifiable
 * Data Breaches scheme a suspected breach must be assessed within 30 days, and if it is likely
 * to cause serious harm, the people affected and the OAIC must be told as soon as practicable.
 * Each step's date is recorded here so the deadlines can be checked and shown.
 */
export const dataBreachesTable = pgTable("data_breaches", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  // What happened, in words the people affected can understand.
  description: text("description").notNull(),
  dataInvolved: text("data_involved").notNull(),
  // What the people affected should do (e.g. change your password).
  userGuidance: text("user_guidance").notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
  containedAt: timestamp("contained_at", { withTimezone: true }),
  // "eligible" (likely to cause serious harm: notify) or "not-eligible"
  assessment: text("assessment"),
  assessmentNote: text("assessment_note"),
  assessedAt: timestamp("assessed_at", { withTimezone: true }),
  usersNotifiedAt: timestamp("users_notified_at", { withTimezone: true }),
  regulatorNotifiedAt: timestamp("regulator_notified_at", {
    withTimezone: true,
  }),
  regulatorReference: text("regulator_reference"),
  recordedByEmail: text("recorded_by_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One per person told about a breach: shown in the app until they confirm they've read it. */
export const dataBreachNoticesTable = pgTable(
  "data_breach_notices",
  {
    id: serial("id").primaryKey(),
    breachId: integer("breach_id")
      .notNull()
      .references(() => dataBreachesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    emailSent: boolean("email_sent").notNull().default(false),
    notifiedAt: timestamp("notified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("data_breach_notices_breach_user").on(
      table.breachId,
      table.userId,
    ),
  ],
);

export type DataBreach = typeof dataBreachesTable.$inferSelect;
export type DataBreachNotice = typeof dataBreachNoticesTable.$inferSelect;

/**
 * The written record of personal information disclosed to a government or law-enforcement agency
 * because the law required or authorised it (Australian Privacy Principle 6.5 requires this note,
 * and privacy policy section 9 promises it). Either the person was told, or the reason they
 * weren't is recorded: some orders forbid telling them.
 */
export const governmentDisclosuresTable = pgTable("government_disclosures", {
  id: serial("id").primaryKey(),
  agency: text("agency").notNull(),
  // The law, warrant, subpoena or court order that required or authorised the disclosure.
  legalBasis: text("legal_basis").notNull(),
  // "legal-demand" (required by law: APP 6.2(b)), "enforcement-request" (a written request from an
  // Australian enforcement body: APP 6.2(e)) or "emergency" (a serious threat to life, health or
  // safety, or a missing person: Privacy Act s 16A). Empty for records made before 2026-10-07.
  requestType: text("request_type", {
    enum: ["legal-demand", "enforcement-request", "emergency"],
  }),
  // The kinds of information given (DISCLOSURE_CATEGORIES in the API's lib/dataBreaches.ts). Face
  // templates and uploaded files only under a legal demand. Empty for records made before 2026-10-07.
  categories: text("categories").array(),
  reference: text("reference"),
  // A copy of the email, not a foreign key: the record must outlive the account.
  subjectEmail: text("subject_email"),
  informationDisclosed: text("information_disclosed").notNull(),
  disclosedAt: timestamp("disclosed_at", { withTimezone: true }).notNull(),
  personToldAt: timestamp("person_told_at", { withTimezone: true }),
  notTellingReason: text("not_telling_reason"),
  recordedByEmail: text("recorded_by_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GovernmentDisclosure =
  typeof governmentDisclosuresTable.$inferSelect;
