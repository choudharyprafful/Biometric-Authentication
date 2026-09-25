import { pgTable, text, serial, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  // security_analyst: read access to the audit trail, no account management.
  // it_support: can view users and help recover a locked-out account
  // (reset password, clear MFA), but can't change roles or delete accounts.
  role: text("role", { enum: ["user", "admin", "security_analyst", "it_support"] }).notNull().default("user"),
  // AES-256-GCM encrypted at rest (see lib/fileEncryption.ts), not plaintext.
  faceDescriptorCiphertext: text("face_descriptor_ciphertext"),
  faceDescriptorIv: text("face_descriptor_iv"),
  faceDescriptorAuthTag: text("face_descriptor_auth_tag"),
  faceEnrolled: boolean("face_enrolled").notNull().default(false),
  // Biometric consent is separate from general data consent, and gets
  // cleared whenever the descriptor is deleted.
  dataConsentGiven: boolean("data_consent_given").notNull().default(false),
  dataConsentAt: timestamp("data_consent_at", { withTimezone: true }),
  biometricConsentGiven: boolean("biometric_consent_given").notNull().default(false),
  biometricConsentAt: timestamp("biometric_consent_at", { withTimezone: true }),
  // Self-reported, same as virtually every consumer app (real ID/document
  // verification is out of scope — see docs/05 "Minor / parental consent").
  // Nullable only because seeded/pre-existing accounts predate this field;
  // required going forward at registration.
  dateOfBirth: date("date_of_birth"),
  // Set only when dateOfBirth indicates the account holder was under the
  // consent-age threshold at registration. NULL for adult accounts — the
  // presence of this field, not a separate boolean, is what marks an
  // account as minor-registered.
  parentGuardianEmail: text("parent_guardian_email"),
  parentConsentGiven: boolean("parent_consent_given").notNull().default(false),
  parentConsentAt: timestamp("parent_consent_at", { withTimezone: true }),
  // Separate from dataConsentGiven on purpose — see docs/03_Data_Flow.md,
  // "Training-specific consent, separate from storage consent" and
  // 08_Requests_to_Team2.md §1. Using the app (dataConsentGiven) is not the
  // same as consenting to have your activity contribute to the behavior
  // model — this flag gates the latter only. Toggleable at any time via
  // POST /users/me/training-consent, unlike dataConsentGiven which is
  // all-or-nothing at registration.
  trainingConsentGiven: boolean("training_consent_given").notNull().default(false),
  trainingConsentAt: timestamp("training_consent_at", { withTimezone: true }),
  // A THIRD, distinct consent purpose from the two above — separate on
  // purpose, per Team 2's matrix (09_Team2_Data_Source_Acceptability_Matrix.md
  // §3): "Explicit, per-purpose consent naming the specific use" for
  // uploaded text, and training consent for it is its own "separate
  // explicit opt-in," not folded into trainingConsentGiven (which gates
  // the behavior-transition model's event-type training only — see
  // behaviorModel.ts). This flag gates lib/contentPersonalizationModel.ts:
  // whether an account's OWN uploaded text content may be read (decrypted
  // server-side) to build a private, never-pooled personalization profile.
  // Toggleable any time, same shape as trainingConsentGiven.
  contentPersonalizationConsentGiven: boolean("content_personalization_consent_given").notNull().default(false),
  contentPersonalizationConsentAt: timestamp("content_personalization_consent_at", { withTimezone: true }),
  subscriptionPlan: text("subscription_plan", { enum: ["free", "plus", "pro", "team"] }).notNull().default("free"),
  // Set when the account loses a chargeback: new purchases are refused until an admin clears it.
  paymentHold: boolean("payment_hold").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true, faceDescriptorCiphertext: true, faceDescriptorIv: true, faceDescriptorAuthTag: true, faceEnrolled: true, subscriptionPlan: true, paymentHold: true, dataConsentGiven: true, dataConsentAt: true, biometricConsentGiven: true, biometricConsentAt: true, parentGuardianEmail: true, parentConsentGiven: true, parentConsentAt: true, trainingConsentGiven: true, trainingConsentAt: true, contentPersonalizationConsentGiven: true, contentPersonalizationConsentAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
