import { Router, type IRouter, type RequestHandler } from "express";
import { asc, desc, eq } from "drizzle-orm";
import { db, usersTable, passkeysTable, biometricKeysTable, uploadsTable, paymentsTable, securityLogsTable } from "@workspace/db";
import { AcknowledgePrivacyPolicyBody, AcknowledgePrivacyPolicyResponse, GetMyPrivacyPolicyStatusResponse } from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { decryptFile } from "../lib/fileEncryption";
import { getClientIp } from "../lib/clientIp";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { PRIVACY_POLICY_VERSION, acknowledgementDetails, privacyPolicyStatus } from "../lib/privacyPolicy";

// Privacy rights (policy sections 11 and 13). Like the consent routes, open to any signed-in
// account, including one still setting up MFA or awaiting a parent: seeing the policy and getting
// a copy of your data must not depend on finishing sign-in setup (compare R-CONSENT-2).
const router: IRouter = Router();

const requireSignedIn: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
};

router.get("/users/me/privacy-policy", requireSignedIn, async (req, res): Promise<void> => {
  res.json(GetMyPrivacyPolicyStatusResponse.parse(await privacyPolicyStatus(req.session.userId as number)));
});

router.post("/users/me/privacy-policy/acknowledge", requireSignedIn, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const parsed = AcknowledgePrivacyPolicyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.version !== PRIVACY_POLICY_VERSION) {
    res.status(409).json({ error: "The privacy policy has changed since this page loaded. Reload it to see the current version." });
    return;
  }
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId));
  await logEvent({
    eventType: "PRIVACY_POLICY_ACKNOWLEDGED",
    details: acknowledgementDetails(PRIVACY_POLICY_VERSION, "notice"),
    userId,
    userEmail: user?.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
  res.json(AcknowledgePrivacyPolicyResponse.parse(await privacyPolicyStatus(userId)));
});

const exportRateLimit = requestRateLimit("data-export", 5, 60 * 60 * 1000);
// File contents are included up to this total; anything beyond is listed and downloadable from the
// Data Vault. Uploads are capped at 15 MB each, so this always fits at least one file.
const EXPORT_FILE_CONTENT_LIMIT_BYTES = 25 * 1024 * 1024;
const EXPORT_EVENT_LIMIT = 5000;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

router.get("/users/me/export", requireSignedIn, exportRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [passkeys, phoneKeys, uploads, payments, events, policy] = await Promise.all([
    db.select({ deviceName: passkeysTable.deviceName, createdAt: passkeysTable.createdAt, lastUsedAt: passkeysTable.lastUsedAt }).from(passkeysTable).where(eq(passkeysTable.userId, userId)),
    db.select({ deviceName: biometricKeysTable.deviceName, createdAt: biometricKeysTable.createdAt, lastUsedAt: biometricKeysTable.lastUsedAt }).from(biometricKeysTable).where(eq(biometricKeysTable.userId, userId)),
    db.select().from(uploadsTable).where(eq(uploadsTable.userId, userId)).orderBy(asc(uploadsTable.createdAt)),
    db.select().from(paymentsTable).where(eq(paymentsTable.userId, userId)).orderBy(asc(paymentsTable.createdAt)),
    db
      .select({ timestamp: securityLogsTable.timestamp, eventType: securityLogsTable.eventType, details: securityLogsTable.details, ipAddress: securityLogsTable.ipAddress, userAgent: securityLogsTable.userAgent })
      .from(securityLogsTable)
      .where(eq(securityLogsTable.userId, userId))
      .orderBy(desc(securityLogsTable.timestamp))
      .limit(EXPORT_EVENT_LIMIT),
    privacyPolicyStatus(userId),
  ]);

  let includedBytes = 0;
  let withContent = 0;
  const uploadEntries = uploads.map((u) => {
    const entry = { id: u.id, fileName: u.fileName, mimeType: u.mimeType, fileType: u.fileType, sizeBytes: u.sizeBytes, declaredSource: u.contentSource, uploadedAt: iso(u.createdAt) };
    if (includedBytes + u.sizeBytes > EXPORT_FILE_CONTENT_LIMIT_BYTES) {
      return { ...entry, contentBase64: null, contentNote: "Not included: this export carries file contents up to 25 MB in total. Download this file from the Data Vault." };
    }
    try {
      const content = decryptFile({ ciphertext: u.ciphertext, iv: u.iv, authTag: u.authTag });
      includedBytes += content.length;
      withContent += 1;
      return { ...entry, contentBase64: content.toString("base64") };
    } catch {
      return { ...entry, contentBase64: null, contentNote: "Could not be read for this export. Download it from the Data Vault, or contact us." };
    }
  });

  const exportedAt = new Date();
  const body = {
    export: { format: "SecureAI personal data export", formatVersion: 1, exportedAt: exportedAt.toISOString(), privacyPolicyVersion: PRIVACY_POLICY_VERSION },
    notes: [
      "This file holds the personal data SecureAI stores about your account, as described in section 2 of the Privacy Policy (/privacy).",
      "Your face template, if you set up face sign-in, is not included. It is 128 numbers that are only useful for face matching, and copying it into a file would only create another place it could leak. It is stored encrypted, and you can delete it in Security Settings.",
      "Passkeys and phone keys are listed by name and date only. The fingerprint or face that unlocks them never leaves your device.",
      "Your password is stored only as a one-way hash, which is not included.",
      "Uploads include their content (base64) up to 25 MB in total; anything beyond that is listed and can be downloaded from the Data Vault. Photo and video location data was removed when each file was uploaded.",
      `Security events are your most recent ${EXPORT_EVENT_LIMIT.toLocaleString("en-AU")}, with the IP address and browser recorded for each.`,
      "If you delete your account, payment records and security events are kept (section 10 of the Privacy Policy); everything else is deleted.",
    ],
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      dateOfBirth: user.dateOfBirth,
      parentGuardianEmail: user.parentGuardianEmail,
      parentConsentGiven: user.parentGuardianEmail ? user.parentConsentGiven : null,
      parentConsentAt: iso(user.parentConsentAt),
      subscriptionPlan: user.subscriptionPlan,
      paymentHold: user.paymentHold,
      createdAt: iso(user.createdAt),
      updatedAt: iso(user.updatedAt),
    },
    consents: {
      dataProcessing: { given: user.dataConsentGiven, at: iso(user.dataConsentAt) },
      faceBiometric: { given: user.biometricConsentGiven, at: iso(user.biometricConsentAt) },
      behaviourModelTraining: { given: user.trainingConsentGiven, at: iso(user.trainingConsentAt) },
      contentPersonalisation: { given: user.contentPersonalizationConsentGiven, at: iso(user.contentPersonalizationConsentAt) },
    },
    signInMethods: {
      faceTemplate: user.faceEnrolled ? "Stored, encrypted. Not included in this export (see notes)." : "None stored.",
      passkeys: passkeys.map((k) => ({ deviceName: k.deviceName, createdAt: iso(k.createdAt), lastUsedAt: iso(k.lastUsedAt) })),
      phoneKeys: phoneKeys.map((k) => ({ deviceName: k.deviceName, createdAt: iso(k.createdAt), lastUsedAt: iso(k.lastUsedAt) })),
    },
    uploads: uploadEntries,
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      description: p.description,
      planId: p.planId,
      declineMessage: p.declineMessage,
      createdAt: iso(p.createdAt),
      refundedAt: iso(p.refundedAt),
    })),
    securityEvents: events.map((e) => ({ timestamp: iso(e.timestamp), eventType: e.eventType, details: e.details, ipAddress: e.ipAddress, userAgent: e.userAgent })),
    privacyPolicy: policy,
  };

  await logEvent({
    eventType: "DATA_EXPORTED",
    details: `Personal data export downloaded: ${uploads.length} upload(s) (${withContent} with content), ${payments.length} payment(s), ${events.length} security event(s)`,
    userId,
    userEmail: user.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.set("Cache-Control", "no-store");
  res.set("Content-Disposition", `attachment; filename="secureai-data-${exportedAt.toISOString().slice(0, 10)}.json"`);
  res.json(body);
});

export default router;
