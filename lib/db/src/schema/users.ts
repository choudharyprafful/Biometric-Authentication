import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
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
  subscriptionPlan: text("subscription_plan", { enum: ["free", "plus", "pro", "team"] }).notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true, faceDescriptorCiphertext: true, faceDescriptorIv: true, faceDescriptorAuthTag: true, faceEnrolled: true, subscriptionPlan: true, dataConsentGiven: true, dataConsentAt: true, biometricConsentGiven: true, biometricConsentAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
