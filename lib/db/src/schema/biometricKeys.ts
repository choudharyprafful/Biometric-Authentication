import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Device-bound biometric key pairs, enrolled via Android's native
 * BiometricPrompt + Keystore (mobile only) — not WebAuthn/passkeys. Chosen
 * specifically because native passkey ceremonies require Digital Asset
 * Links domain verification against a real, owned domain, which a local
 * dev tunnel can never satisfy (see artifacts/mobile/README.md). Keystore
 * key generation + BiometricPrompt-gated signing has no such requirement —
 * it still satisfies the brief's actual security property ("the biometric
 * unlocks a secret key on the device that signs a challenge from the
 * server; the biometric never leaves the device"), just without the
 * WebAuthn/FIDO2 relying-party ecosystem around it.
 *
 * Only the public key is stored here; the private key never leaves the
 * device's secure hardware (Android Keystore, StrongBox-backed where
 * available). The server verifies RSA-SHA256 signatures over its own
 * server-issued challenges — same trust model as passkeys.ts, simpler
 * transport.
 */
export const biometricKeysTable = pgTable("biometric_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  publicKey: text("public_key").notNull(), // PEM-encoded RSA public key
  deviceName: text("device_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export type BiometricKey = typeof biometricKeysTable.$inferSelect;
