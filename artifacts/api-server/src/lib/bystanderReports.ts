/**
 * Reports from people who appear in someone else's upload (Team 2's Bystander Consent Policy,
 * sections 6 and 7; docs/08 section 5h). Anyone can report, without an account. Staff match the
 * report to a file, pause the file while they review it, tell its uploader, and record the outcome.
 *
 * Nothing is emailed to the person reporting: the form is public, so an automatic reply would let
 * anyone make this app send mail to any address. They get a reference on screen, and staff reply.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  uploadsTable,
  usersTable,
  bystanderReportsTable,
  type BystanderReport,
} from "@workspace/db";
import { recordEvent } from "./auditLog";
import { appUrl, sendMail } from "./mailer";
import type { Actor } from "./aiGovernance";
import { activeHoldsFor, keepUpload } from "./legalHolds";

export class ReportNotFoundError extends Error {}
/** The report is already matched or closed. */
export class ReportStateError extends Error {}
/** Input that can't be right; the message is shown to staff. */
export class ReportInputError extends Error {}

export interface ReportInput {
  reporterEmail: string;
  reporterName?: string | null;
  relationship: "self" | "parent-or-guardian";
  request: "review" | "removal";
  contentDescription: string;
  uploaderHint?: string | null;
}

export type ReportOutcome = "removed" | "not-upheld" | "no-match";

function actorFields(actor: Actor) {
  return {
    userId: actor.userId,
    userEmail: actor.email,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  };
}

const SIGNATURE = "SecureAI (Miifile Pty Ltd)";

export async function receiveReport(
  input: ReportInput,
  from: { ip: string; userAgent: string | undefined },
): Promise<BystanderReport> {
  const [row] = await db
    .insert(bystanderReportsTable)
    .values({
      reporterEmail: input.reporterEmail.trim().toLowerCase(),
      reporterName: input.reporterName?.trim() || null,
      relationship: input.relationship,
      request: input.request,
      contentDescription: input.contentDescription.trim(),
      uploaderHint: input.uploaderHint?.trim() || null,
    })
    .returning();
  // The audit entry has the reference, not the person: the security log is read more widely than
  // this record.
  await recordEvent({
    eventType: "BYSTANDER_REPORT_RECEIVED",
    details: `report=${row!.id}; relationship=${row!.relationship}; request=${row!.request}`,
    ipAddress: from.ip,
    userAgent: from.userAgent,
  });
  return row!;
}

/** Newest first. */
export function listReports(): Promise<BystanderReport[]> {
  return db
    .select()
    .from(bystanderReportsTable)
    .orderBy(
      desc(bystanderReportsTable.receivedAt),
      desc(bystanderReportsTable.id),
    );
}

/** An uploader's files as metadata only, so staff can match a report without opening anything. */
export async function candidateUploads(email: string) {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.trim().toLowerCase()));
  if (!user) return [];
  return db
    .select({
      id: uploadsTable.id,
      fileName: uploadsTable.fileName,
      fileType: uploadsTable.fileType,
      createdAt: uploadsTable.createdAt,
      bystanders: uploadsTable.bystanders,
      pausedForReviewAt: uploadsTable.pausedForReviewAt,
    })
    .from(uploadsTable)
    .where(eq(uploadsTable.userId, user.id))
    .orderBy(desc(uploadsTable.createdAt))
    .limit(200);
}

async function getReport(id: number): Promise<BystanderReport> {
  const [report] = await db
    .select()
    .from(bystanderReportsTable)
    .where(eq(bystanderReportsTable.id, id));
  if (!report) throw new ReportNotFoundError();
  return report;
}

async function ownerEmailOf(userId: number): Promise<string | null> {
  const [owner] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return owner?.email ?? null;
}

/**
 * Matches a report to a file, pauses the file (policy section 6: "suspended from any processing
 * beyond storage pending review") and tells its uploader that a report was received.
 */
export async function pauseForReport(
  id: number,
  uploadId: number,
  note: string,
  actor: Actor,
): Promise<BystanderReport> {
  const report = await getReport(id);
  if (report.status !== "open") throw new ReportStateError();
  const [upload] = await db
    .select({
      id: uploadsTable.id,
      userId: uploadsTable.userId,
      fileName: uploadsTable.fileName,
      pausedForReviewAt: uploadsTable.pausedForReviewAt,
    })
    .from(uploadsTable)
    .where(eq(uploadsTable.id, uploadId));
  if (!upload) throw new ReportInputError("No file with that number");
  const ownerEmail = await ownerEmailOf(upload.userId);
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    await tx
      .update(uploadsTable)
      .set({ pausedForReviewAt: upload.pausedForReviewAt ?? now })
      .where(eq(uploadsTable.id, upload.id));
    const [row] = await tx
      .update(bystanderReportsTable)
      .set({
        status: "paused",
        uploadId: upload.id,
        uploaderEmail: ownerEmail,
        staffNote: note.trim(),
        pausedAt: now,
        handledByEmail: actor.email,
      })
      .where(
        and(
          eq(bystanderReportsTable.id, id),
          eq(bystanderReportsTable.status, "open"),
        ),
      )
      .returning();
    if (!row) throw new ReportStateError();
    return row;
  });
  if (ownerEmail)
    await sendMail(
      ownerEmail,
      "A report about one of your SecureAI files",
      [
        "Someone who appears in one of your files has asked us to review it.",
        "",
        `File: ${upload.fileName}`,
        "",
        "While we review it, the file stays in your Data Vault, but no SecureAI feature uses it. You don't need to do anything. We'll email you when the review is finished.",
        "",
        `You can see the file's status here: ${appUrl("/uploads")}`,
        "",
        SIGNATURE,
      ].join("\n"),
    );
  await recordEvent({
    eventType: "BYSTANDER_REPORT_PAUSED",
    details: `report=${id}; upload=${upload.id}`,
    ...actorFields(actor),
  });
  return updated;
}

/**
 * Closes a report. Removed deletes the file (a copy is kept first if it is under a legal hold);
 * not upheld un-pauses it, unless another report about it is still under review; no match closes a
 * report that was never matched to a file. The uploader is told the outcome (policy section 6).
 */
export async function resolveReport(
  id: number,
  outcome: ReportOutcome,
  note: string,
  actor: Actor,
): Promise<BystanderReport> {
  const report = await getReport(id);
  if (report.status !== "open" && report.status !== "paused")
    throw new ReportStateError();
  if (outcome !== "no-match" && report.uploadId === null)
    throw new ReportInputError("Match the report to a file first");
  if (outcome === "no-match" && report.status === "paused")
    throw new ReportInputError(
      "This report is matched to a file: close it as removed or not upheld",
    );

  let fileName: string | null = null;
  let ownerEmail = report.uploaderEmail;
  if (report.uploadId !== null) {
    const [upload] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, report.uploadId));
    if (upload) {
      fileName = upload.fileName;
      ownerEmail = (await ownerEmailOf(upload.userId)) ?? ownerEmail;
      if (outcome === "removed") {
        const holds = await activeHoldsFor({
          userId: upload.userId,
          email: ownerEmail,
        });
        await db.transaction(async (tx) => {
          await keepUpload(tx, holds, upload);
          await tx.delete(uploadsTable).where(eq(uploadsTable.id, upload.id));
        });
      } else if (outcome === "not-upheld") {
        const othersUnderReview = await db
          .select({ id: bystanderReportsTable.id })
          .from(bystanderReportsTable)
          .where(
            and(
              eq(bystanderReportsTable.uploadId, upload.id),
              eq(bystanderReportsTable.status, "paused"),
              ne(bystanderReportsTable.id, report.id),
            ),
          );
        if (othersUnderReview.length === 0)
          await db
            .update(uploadsTable)
            .set({ pausedForReviewAt: null })
            .where(eq(uploadsTable.id, upload.id));
      }
    }
  }

  const [updated] = await db
    .update(bystanderReportsTable)
    .set({
      status: outcome,
      staffNote: note.trim(),
      resolvedAt: new Date(),
      handledByEmail: actor.email,
    })
    .where(
      and(
        eq(bystanderReportsTable.id, id),
        inArray(bystanderReportsTable.status, ["open", "paused"]),
      ),
    )
    .returning();
  if (!updated) throw new ReportStateError();

  if (ownerEmail && fileName && outcome !== "no-match")
    await sendMail(
      ownerEmail,
      outcome === "removed"
        ? "We removed one of your SecureAI files"
        : "Your SecureAI file is back in use",
      (outcome === "removed"
        ? [
            `We've finished reviewing your file "${fileName}" after a report from someone in it, and removed it.`,
            "",
            "Under SecureAI's privacy policy (section 5), a person who appears in someone else's upload can ask for it to be removed. If you think this was a mistake, reply to this email.",
          ]
        : [
            `We've finished reviewing your file "${fileName}". It stays in your Data Vault, and features can use it again as before.`,
          ]
      )
        .concat(["", SIGNATURE])
        .join("\n"),
    );
  await recordEvent({
    eventType: "BYSTANDER_REPORT_RESOLVED",
    details: `report=${id}; outcome=${outcome}; upload=${report.uploadId ?? "none"}`,
    ...actorFields(actor),
  });
  return updated;
}
