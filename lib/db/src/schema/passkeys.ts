import { pgTable, text, serial, integer, bigint, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * WebAuthn/passkey credentials. The biometric (Face ID / fingerprint / PIN)
 * unlocks a private key held on the user's device; only the public key is
 * stored here. The server verifies signatures over its own challenges.
 */
export const passkeysTable = pgTable("passkeys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(), // base64url-encoded COSE public key
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: jsonb("transports"), // e.g. ["internal", "hybrid"]
  deviceName: text("device_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export type Passkey = typeof passkeysTable.$inferSelect;
