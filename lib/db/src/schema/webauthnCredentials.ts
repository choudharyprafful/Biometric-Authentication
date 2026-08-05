import { pgTable, text, serial, integer, bigint, timestamp } from "drizzle-orm/pg-core";

// Stores one WebAuthn credential (passkey) per row per user.
// A user can register multiple passkeys (phone, laptop, hardware key).
export const webauthnCredentialsTable = pgTable("webauthn_credentials", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Base64url-encoded credential ID returned by the authenticator.
  credentialId: text("credential_id").notNull().unique(),
  // Base64url-encoded COSE public key.
  publicKey: text("public_key").notNull(),
  // Monotonically increasing counter; used to detect cloned authenticators.
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  // Comma-separated transport hints ("internal", "hybrid", "usb", etc.)
  transports: text("transports"),
  // Human-readable name set at registration (e.g. device model or user label).
  label: text("label").notNull().default("Passkey"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export type WebauthnCredential = typeof webauthnCredentialsTable.$inferSelect;
