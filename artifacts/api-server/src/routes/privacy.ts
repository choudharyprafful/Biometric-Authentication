import {
  Router,
  type IRouter,
  type Request,
  type RequestHandler,
} from "express";
import { asc, desc, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  passkeysTable,
  biometricKeysTable,
  uploadsTable,
  paymentsTable,
  securityLogsTable,
  dataBreachesTable,
  dataBreachNoticesTable,
} from "@workspace/db";
import {
  AcknowledgePrivacyPolicyBody,
  AcknowledgePrivacyPolicyResponse,
  GetMyPrivacyPolicyStatusResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { decryptFile } from "../lib/fileEncryption";
import { getClientIp } from "../lib/clientIp";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { renderReadableExport } from "../lib/readableExport";
import { RETENTION } from "../lib/retention";
import { appUrl } from "../lib/mailer";
import { disclosuresToldTo } from "../lib/dataBreaches";
import {
  PRIVACY_POLICY_VERSION,
  acknowledgementDetails,
  privacyPolicyStatus,
} from "../lib/privacyPolicy";

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

router.get(
  "/users/me/privacy-policy",
  requireSignedIn,
  async (req, res): Promise<void> => {
    res.json(
      GetMyPrivacyPolicyStatusResponse.parse(
        await privacyPolicyStatus(req.session.userId as number),
      ),
    );
  },
);

router.post(
  "/users/me/privacy-policy/acknowledge",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const userId = req.session.userId as number;
    const parsed = AcknowledgePrivacyPolicyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.version !== PRIVACY_POLICY_VERSION) {
      res.status(409).json({
        error:
          "The privacy policy has changed since this page loaded. Reload it to see the current version.",
      });
      return;
    }
    const [user] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    await logEvent({
      eventType: "PRIVACY_POLICY_ACKNOWLEDGED",
      details: acknowledgementDetails(PRIVACY_POLICY_VERSION, "notice"),
      userId,
      userEmail: user?.email,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.json(
      AcknowledgePrivacyPolicyResponse.parse(await privacyPolicyStatus(userId)),
    );
  },
);

// One limit for both downloads (JSON and readable copy), so offering two formats doesn't double it.
const exportRateLimit = requestRateLimit("data-export", 5, 60 * 60 * 1000);
// File contents are included up to this total; anything beyond is listed and downloadable from the
// Data Vault. Uploads are capped at 15 MB each, so this always fits at least one file.
const EXPORT_FILE_CONTENT_LIMIT_BYTES = 25 * 1024 * 1024;
const EXPORT_EVENT_LIMIT = 5000;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
// The download's file name carries the Sydney date, matching the date written in the readable copy.
const fileDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(d);

// Notices about data breaches this account was sent (routes/dataBreaches.ts). Empty where the
// table doesn't exist yet (the live site before scripts/ops/migrate-retention-and-breaches.mjs).
async function breachNoticesFor(userId: number) {
  try {
    return await db
      .select({
        title: dataBreachesTable.title,
        description: dataBreachesTable.description,
        dataInvolved: dataBreachesTable.dataInvolved,
        userGuidance: dataBreachesTable.userGuidance,
        notifiedAt: dataBreachNoticesTable.notifiedAt,
        acknowledgedAt: dataBreachNoticesTable.acknowledgedAt,
      })
      .from(dataBreachNoticesTable)
      .innerJoin(
        dataBreachesTable,
        eq(dataBreachesTable.id, dataBreachNoticesTable.breachId),
      )
      .where(eq(dataBreachNoticesTable.userId, userId))
      .orderBy(desc(dataBreachNoticesTable.notifiedAt));
  } catch {
    return [];
  }
}

// Disclosures to government agencies the person has been told about (lib/dataBreaches.ts). Empty
// before the migration, like breachNoticesFor.
async function disclosuresFor(email: string) {
  try {
    return await disclosuresToldTo(email);
  } catch {
    return [];
  }
}

/** Everything the data export holds about one account; file contents only when asked for. */
async function collectExport(userId: number, withFileContents: boolean) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) return null;

  const [
    passkeys,
    phoneKeys,
    uploads,
    payments,
    events,
    policy,
    notices,
    disclosures,
  ] = await Promise.all([
    db
      .select({
        deviceName: passkeysTable.deviceName,
        createdAt: passkeysTable.createdAt,
        lastUsedAt: passkeysTable.lastUsedAt,
      })
      .from(passkeysTable)
      .where(eq(passkeysTable.userId, userId)),
    db
      .select({
        deviceName: biometricKeysTable.deviceName,
        createdAt: biometricKeysTable.createdAt,
        lastUsedAt: biometricKeysTable.lastUsedAt,
      })
      .from(biometricKeysTable)
      .where(eq(biometricKeysTable.userId, userId)),
    db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.userId, userId))
      .orderBy(asc(uploadsTable.createdAt)),
    db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.userId, userId))
      .orderBy(asc(paymentsTable.createdAt)),
    db
      .select({
        timestamp: securityLogsTable.timestamp,
        eventType: securityLogsTable.eventType,
        details: securityLogsTable.details,
        ipAddress: securityLogsTable.ipAddress,
        userAgent: securityLogsTable.userAgent,
      })
      .from(securityLogsTable)
      .where(eq(securityLogsTable.userId, userId))
      .orderBy(desc(securityLogsTable.timestamp))
      .limit(EXPORT_EVENT_LIMIT),
    privacyPolicyStatus(userId),
    breachNoticesFor(userId),
    disclosuresFor(user.email),
  ]);

  let includedBytes = 0;
  let withContent = 0;
  const uploadEntries = uploads.map((u) => {
    const entry = {
      id: u.id,
      fileName: u.fileName,
      mimeType: u.mimeType,
      fileType: u.fileType,
      sizeBytes: u.sizeBytes,
      declaredSource: u.contentSource,
      // Team 2's Bystander Consent Policy: who else the file shows or names, as declared (null when
      // never asked), and whether a report from someone in it is being reviewed.
      otherPeople: u.bystanders,
      otherPeopleStatement: u.bystanderStatement,
      pausedForReviewSince: iso(u.pausedForReviewAt),
      uploadedAt: iso(u.createdAt),
    };
    if (!withFileContents) return entry;
    if (includedBytes + u.sizeBytes > EXPORT_FILE_CONTENT_LIMIT_BYTES) {
      return {
        ...entry,
        contentBase64: null,
        contentNote:
          "Not included: this export carries file contents up to 25 MB in total. Download this file from the Data Vault.",
      };
    }
    try {
      const content = decryptFile({
        ciphertext: u.ciphertext,
        iv: u.iv,
        authTag: u.authTag,
      });
      includedBytes += content.length;
      withContent += 1;
      return { ...entry, contentBase64: content.toString("base64") };
    } catch {
      return {
        ...entry,
        contentBase64: null,
        contentNote:
          "Could not be read for this export. Download it from the Data Vault, or contact us.",
      };
    }
  });

  return {
    user,
    passkeys,
    phoneKeys,
    uploadEntries,
    withContent,
    payments,
    events,
    policy,
    notices,
    disclosures,
  };
}

type ExportData = NonNullable<Awaited<ReturnType<typeof collectExport>>>;

async function recordExport(
  req: Request,
  data: ExportData,
  format: "readable copy" | "JSON",
): Promise<void> {
  await logEvent({
    eventType: "DATA_EXPORTED",
    details: `Personal data export downloaded (${format}): ${data.uploadEntries.length} upload(s) (${data.withContent} with content), ${data.payments.length} payment(s), ${data.events.length} security event(s)`,
    userId: data.user.id,
    userEmail: data.user.email,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
}

router.get(
  "/users/me/export",
  requireSignedIn,
  exportRateLimit,
  async (req, res): Promise<void> => {
    const data = await collectExport(req.session.userId as number, true);
    if (!data) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { user } = data;
    const exportedAt = new Date();
    const body = {
      export: {
        format: "SecureAI personal data export",
        formatVersion: 1,
        exportedAt: exportedAt.toISOString(),
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      },
      notes: [
        "This file holds the personal data SecureAI stores about your account, as described in section 2 of the Privacy Policy (/privacy). A readable copy of the same information, for people rather than programs, is available from Security Settings.",
        "Your face template, if you set up face sign-in, is not included. It is 128 numbers that are only useful for face matching, and copying it into a file would only create another place it could leak. It is stored encrypted, and you can delete it in Security Settings.",
        "Passkeys and phone keys are listed by name and date only. The fingerprint or face that unlocks them never leaves your device.",
        "Your password is stored only as a one-way hash, which is not included.",
        "Uploads include their content (base64) up to 25 MB in total; anything beyond that is listed and can be downloaded from the Data Vault. Photo and video location data was removed when each file was uploaded.",
        `Security events are your most recent ${EXPORT_EVENT_LIMIT.toLocaleString("en-AU")}, with the IP address and browser recorded for each.`,
        `Payment records are kept for ${RETENTION.paymentRecordsYears} years after the payment and security records for ${RETENTION.securityLogMonths} months (records of challenges to AI decisions for ${RETENTION.aiChallengeRecordYears} years), whether or not you delete your account, and then deleted automatically (section 10 of the Privacy Policy). Deleting your account deletes everything else straight away.`,
        "Disclosures to government agencies are listed where we have told you about them (section 9 of the Privacy Policy).",
      ],
      account: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        dateOfBirth: user.dateOfBirth,
        parentGuardianEmail: user.parentGuardianEmail,
        parentConsentGiven: user.parentGuardianEmail
          ? user.parentConsentGiven
          : null,
        parentConsentAt: iso(user.parentConsentAt),
        subscriptionPlan: user.subscriptionPlan,
        paymentHold: user.paymentHold,
        createdAt: iso(user.createdAt),
        updatedAt: iso(user.updatedAt),
      },
      consents: {
        dataProcessing: {
          given: user.dataConsentGiven,
          at: iso(user.dataConsentAt),
        },
        faceBiometric: {
          given: user.biometricConsentGiven,
          at: iso(user.biometricConsentAt),
        },
        behaviourModelTraining: {
          given: user.trainingConsentGiven,
          at: iso(user.trainingConsentAt),
        },
        contentPersonalisation: {
          given: user.contentPersonalizationConsentGiven,
          at: iso(user.contentPersonalizationConsentAt),
        },
      },
      signInMethods: {
        faceTemplate: user.faceEnrolled
          ? "Stored, encrypted. Not included in this export (see notes)."
          : "None stored.",
        passkeys: data.passkeys.map((k) => ({
          deviceName: k.deviceName,
          createdAt: iso(k.createdAt),
          lastUsedAt: iso(k.lastUsedAt),
        })),
        phoneKeys: data.phoneKeys.map((k) => ({
          deviceName: k.deviceName,
          createdAt: iso(k.createdAt),
          lastUsedAt: iso(k.lastUsedAt),
        })),
      },
      uploads: data.uploadEntries,
      payments: data.payments.map((p) => ({
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
      securityEvents: data.events.map((e) => ({
        timestamp: iso(e.timestamp),
        eventType: e.eventType,
        details: e.details,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
      })),
      dataBreachNotices: data.notices.map((n) => ({
        title: n.title,
        description: n.description,
        dataInvolved: n.dataInvolved,
        whatYouCanDo: n.userGuidance,
        notifiedAt: iso(n.notifiedAt),
        acknowledgedAt: iso(n.acknowledgedAt),
      })),
      governmentDisclosures: data.disclosures.map((d) => ({
        agency: d.agency,
        legalBasis: d.legalBasis,
        requestType: d.requestType,
        kindsOfInformation: d.categories,
        informationDisclosed: d.informationDisclosed,
        disclosedAt: iso(d.disclosedAt),
        youWereToldAt: iso(d.personToldAt),
      })),
      privacyPolicy: data.policy,
    };

    await recordExport(req, data, "JSON");
    res.set("Cache-Control", "no-store");
    res.set(
      "Content-Disposition",
      `attachment; filename="secureai-data-${fileDate(exportedAt)}.json"`,
    );
    res.json(body);
  },
);

// The same information as one web page someone who isn't technical can read, print or save as a
// PDF (client requirement, 2026-10-02). No file contents: the page lists files; the Data Vault and
// the JSON download hold them.
router.get(
  "/users/me/export/readable",
  requireSignedIn,
  exportRateLimit,
  async (req, res): Promise<void> => {
    const data = await collectExport(req.session.userId as number, false);
    if (!data) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const { user } = data;
    const exportedAt = new Date();
    const keys = (rows: ExportData["passkeys"]) =>
      rows.map((k) => ({
        deviceName: k.deviceName,
        createdAt: iso(k.createdAt),
        lastUsedAt: iso(k.lastUsedAt),
      }));
    const html = renderReadableExport({
      exportedAt,
      privacyPolicyUrl: appUrl("/privacy"),
      account: {
        name: user.name,
        email: user.email,
        role: user.role,
        dateOfBirth: user.dateOfBirth,
        parentGuardianEmail: user.parentGuardianEmail,
        parentConsentGiven: user.parentGuardianEmail
          ? user.parentConsentGiven
          : null,
        subscriptionPlan: user.subscriptionPlan,
        createdAt: iso(user.createdAt),
        updatedAt: iso(user.updatedAt),
      },
      consents: [
        {
          label: "Using your account information (needed to use SecureAI)",
          given: user.dataConsentGiven,
          at: iso(user.dataConsentAt),
        },
        {
          label: "Face sign-in: keeping a template of your face",
          given: user.biometricConsentGiven,
          at: iso(user.biometricConsentAt),
        },
        {
          label: "Learning from your activity to suggest next steps",
          given: user.trainingConsentGiven,
          at: iso(user.trainingConsentAt),
        },
        {
          label: "Personalising content from text you upload",
          given: user.contentPersonalizationConsentGiven,
          at: iso(user.contentPersonalizationConsentAt),
        },
      ],
      faceTemplateStored: user.faceEnrolled,
      passkeys: keys(data.passkeys),
      phoneKeys: keys(data.phoneKeys),
      uploads: data.uploadEntries.map((u) => ({
        fileName: u.fileName,
        fileType: u.fileType,
        sizeBytes: u.sizeBytes,
        declaredSource: u.declaredSource,
        otherPeople: u.otherPeople,
        pausedForReviewSince: u.pausedForReviewSince,
        uploadedAt: u.uploadedAt,
      })),
      payments: data.payments.map((p) => ({
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        description: p.description,
        createdAt: iso(p.createdAt),
        refundedAt: iso(p.refundedAt),
      })),
      events: data.events.map((e) => ({
        timestamp: iso(e.timestamp),
        eventType: e.eventType,
        details: e.details,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
      })),
      eventLimit: EXPORT_EVENT_LIMIT,
      policy: data.policy,
      breachNotices: data.notices.map((n) => ({
        title: n.title,
        description: n.description,
        dataInvolved: n.dataInvolved,
        userGuidance: n.userGuidance,
        notifiedAt: n.notifiedAt.toISOString(),
        acknowledgedAt: iso(n.acknowledgedAt),
      })),
      disclosures: data.disclosures.map((d) => ({
        agency: d.agency,
        legalBasis: d.legalBasis,
        requestType: d.requestType,
        categories: d.categories,
        informationDisclosed: d.informationDisclosed,
        disclosedAt: d.disclosedAt.toISOString(),
        personToldAt: iso(d.personToldAt),
      })),
      retention: RETENTION,
    });

    await recordExport(req, data, "readable copy");
    res.set("Cache-Control", "no-store");
    res.set(
      "Content-Disposition",
      `attachment; filename="secureai-data-${fileDate(exportedAt)}.html"`,
    );
    res.type("html").send(html);
  },
);

export default router;
