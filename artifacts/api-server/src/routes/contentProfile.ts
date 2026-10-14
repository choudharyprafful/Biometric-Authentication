import { Router, type IRouter, type Request } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, uploadsTable, usersTable } from "@workspace/db";
import {
  SetContentPersonalizationConsentBody,
  SetContentPersonalizationConsentResponse,
  GetContentProfileResponse,
  DeleteContentProfileFilesResponse,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { mapUser } from "../lib/mapUser";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import {
  buildContentProfile,
  profileFilesCondition,
} from "../lib/contentPersonalizationModel";
import { getClientIp } from "../lib/clientIp";
import { isAiSystemEnabled } from "../lib/aiGovernance";
import { activeHoldsFor, keepUpload } from "../lib/legalHolds";

const router: IRouter = Router();

// Same no-MFA-gate reasoning as POST /users/me/training-consent (routes/behavior.ts) — withdrawal must always be reachable even by an otherwise-gated account.
router.post(
  "/users/me/content-personalization-consent",
  async (req, res): Promise<void> => {
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const parsed = SetContentPersonalizationConsentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!user) {
      res.status(401).json({ error: "Session invalid" });
      return;
    }

    const { consent } = parsed.data;
    await db
      .update(usersTable)
      .set({
        contentPersonalizationConsentGiven: consent,
        contentPersonalizationConsentAt: consent ? new Date() : null,
      })
      .where(eq(usersTable.id, userId));

    await logEvent({
      eventType: consent
        ? "CONTENT_PERSONALIZATION_CONSENT_GIVEN"
        : "CONTENT_PERSONALIZATION_CONSENT_WITHDRAWN",
      details: `${consent ? "Granted" : "Withdrew"} consent for user ${user.id}'s own uploaded text content to be read for a private personalization profile`,
      userId,
      userEmail: user.email,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });

    const [updated] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    res.json(
      SetContentPersonalizationConsentResponse.parse(await mapUser(updated!)),
    );
  },
);

// Same protection shape as GET /behavior/suggested-action (brief §8) — arguably more warranted here, since this is the one endpoint that reads decrypted upload content server-side.
const contentProfileRateLimit = requestRateLimit(
  "content-profile",
  30,
  5 * 60 * 1000,
);

router.get(
  "/users/me/content-profile",
  requireParentConsent,
  requireMfaEnrolled,
  contentProfileRateLimit,
  async (req, res): Promise<void> => {
    const userId = req.session.userId as number;

    // An administrator's off switch (lib/aiGovernance.ts): no uploads are decrypted or read.
    if (!(await isAiSystemEnabled("content-personalisation"))) {
      res.json(
        GetContentProfileResponse.parse({
          keywords: [],
          documentsConsidered: 0,
          disabled: true,
        }),
      );
      return;
    }

    const profile = await buildContentProfile(userId);

    await logQuery(
      req,
      userId,
      `${profile.keywords.length} keyword(s) from ${profile.documentsConsidered} document(s)`,
    );
    res.json(
      GetContentProfileResponse.parse({
        keywords: profile.keywords,
        documentsConsidered: profile.documentsConsidered,
        disabled: false,
      }),
    );
  },
);

// Deleting files is destructive, so unlike withdrawal it keeps the same gates as DELETE /uploads/:id.
const profileFilesDeleteRateLimit = requestRateLimit(
  "content-profile-files-delete",
  5,
  5 * 60 * 1000,
);

// DELETE /users/me/content-profile/files — Team 2's Weeks 3-4 framework, section 7, and the scenario
// script's step 7: someone withdrawing personalisation consent can also have the stored entries
// removed, not only their future use stopped. Deletes exactly the files the profile reads
// (profileFilesCondition), the same way as deleting each one from the vault; nothing else is
// touched. The profile itself was never stored, so there is nothing further to unlearn.
router.delete(
  "/users/me/content-profile/files",
  requireParentConsent,
  requireMfaEnrolled,
  profileFilesDeleteRateLimit,
  async (req, res): Promise<void> => {
    const userId = req.session.userId as number;
    const readable = profileFilesCondition(userId);
    const files = readable
      ? await db.select().from(uploadsTable).where(readable)
      : [];

    if (files.length > 0) {
      // A legal hold keeps a copy of each file, still encrypted (lib/legalHolds.ts).
      const [owner] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      const holds = await activeHoldsFor({ userId, email: owner?.email });
      await db.transaction(async (tx) => {
        for (const file of files) await keepUpload(tx, holds, file);
        await tx.delete(uploadsTable).where(
          inArray(
            uploadsTable.id,
            files.map((file) => file.id),
          ),
        );
      });
      for (const file of files) {
        await logEvent({
          eventType: "UPLOAD_DELETED",
          details: `Upload deleted: ${file.fileName} (${file.fileType}, ${file.mimeType}, ${file.sizeBytes} bytes) — one of the files the personalization profile read`,
          userId,
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"],
        });
      }
    }

    res.json(
      DeleteContentProfileFilesResponse.parse({ deletedCount: files.length }),
    );
  },
);

async function logQuery(
  req: Request,
  userId: number,
  outcome: string,
): Promise<void> {
  await logEvent({
    eventType: "CONTENT_PROFILE_QUERIED",
    details: `GET /users/me/content-profile — ${outcome}`,
    userId,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
}

export default router;
