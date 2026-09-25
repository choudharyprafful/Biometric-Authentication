import { eq } from "drizzle-orm";
import { db, usersTable, passkeysTable, biometricKeysTable } from "@workspace/db";

// The one public shape of a user. Six routes used to carry their own copy, and two drifted: they
// ignored mobile device keys, so /users/:id reported passkeyEnrolled=false where /auth/me said true.
// A WebAuthn passkey and a mobile device biometric key both count as the key-based factor.
export async function mapUser(user: typeof usersTable.$inferSelect) {
  const [passkeys, biometricKeys] = await Promise.all([
    db.select({ id: passkeysTable.id }).from(passkeysTable).where(eq(passkeysTable.userId, user.id)).limit(1),
    db.select({ id: biometricKeysTable.id }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, user.id)).limit(1),
  ]);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    faceEnrolled: user.faceEnrolled,
    passkeyEnrolled: passkeys.length > 0 || biometricKeys.length > 0,
    dataConsentGiven: user.dataConsentGiven,
    biometricConsentGiven: user.biometricConsentGiven,
    parentConsentPending: user.parentGuardianEmail !== null && !user.parentConsentGiven,
    trainingConsentGiven: user.trainingConsentGiven,
    contentPersonalizationConsentGiven: user.contentPersonalizationConsentGiven,
    subscriptionPlan: user.subscriptionPlan,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt?.toISOString() ?? null,
  };
}
