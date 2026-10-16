/**
 * Consent requests to someone in a file who has their own SecureAI account: Team 2's Bystander
 * Consent Policy, section 4, first row ("the app can route an actual consent request to them directly
 * through their own account"), and the User Data Case Studies, item 2. The schema is
 * lib/db/src/schema/bystanderConsentRequests.ts; what the answers allow is assessPeopleRules in
 * dataProvenance.ts.
 *
 * The uploader gives the person's email address. Whether an account has that address is never
 * revealed to the uploader: every request reads "waiting" until it is answered, and only an account
 * whose address is confirmed (email verification, R-PAY-5) sees requests sent to it. The person sees
 * who asked, and the file's name, type and date, never the file itself: if the uploader typed the
 * wrong address, the content would otherwise go to a stranger.
 *
 * No email goes to an address without an account, so this can't be used to make SecureAI mail
 * anyone; an account holder is emailed once per request, and the uploader can't tell whether that
 * happened. Logs name accounts by id and count people, never their addresses (R-LOG-6).
 */
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import {
  db,
  uploadsTable,
  usersTable,
  bystanderConsentRequestsTable,
  type BystanderConsentRequest,
} from "@workspace/db";
import { logEvent } from "./auditLog";
import { appUrl, sendMail } from "./mailer";

/** At most this many people with an account can be asked about one file. */
export const MAX_PEOPLE_ASKED = 5;

const SIGNATURE = "SecureAI (Miifile Pty Ltd)";

/** The addresses to ask, lower-cased and each once, or a message for the uploader. */
export function addressesToAsk(
  raw: readonly string[] | null | undefined,
  uploaderEmail: string,
): { emails: string[] } | { error: string } {
  const emails = [
    ...new Set((raw ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ];
  if (emails.length === 0)
    return {
      error:
        "Give the email address of each person in it who has a SecureAI account, so we can ask them",
    };
  if (emails.length > MAX_PEOPLE_ASKED)
    return { error: `Ask at most ${MAX_PEOPLE_ASKED} people about one file` };
  if (emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
    return { error: "One of the email addresses isn't valid" };
  if (emails.includes(uploaderEmail.trim().toLowerCase()))
    return {
      error:
        "That's your own address: only list other people with a SecureAI account",
    };
  return { emails };
}

/**
 * Makes the file's requests match `emails`: keeps the ones still listed (with any answer already
 * given), removes the rest, and adds new ones. Returns the newly added addresses.
 */
export async function setPeopleAsked(
  uploadId: number,
  emails: readonly string[],
): Promise<string[]> {
  if (emails.length === 0) {
    await db
      .delete(bystanderConsentRequestsTable)
      .where(eq(bystanderConsentRequestsTable.uploadId, uploadId));
    return [];
  }
  await db
    .delete(bystanderConsentRequestsTable)
    .where(
      and(
        eq(bystanderConsentRequestsTable.uploadId, uploadId),
        notInArray(bystanderConsentRequestsTable.subjectEmail, [...emails]),
      ),
    );
  const added = await db
    .insert(bystanderConsentRequestsTable)
    .values(emails.map((subjectEmail) => ({ uploadId, subjectEmail })))
    .onConflictDoNothing()
    .returning({ subjectEmail: bystanderConsentRequestsTable.subjectEmail });
  return added.map((a) => a.subjectEmail);
}

/** Tells each newly asked person who has a confirmed account; nothing for anyone else. */
export async function notifyPeopleAsked(
  emails: readonly string[],
  uploader: { id: number; name: string; email: string },
  upload: { id: number; fileName: string },
): Promise<void> {
  if (emails.length === 0) return;
  const holders = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.email, [...emails]),
        eq(usersTable.emailVerified, true),
      ),
    );
  for (const holder of holders) {
    await logEvent({
      eventType: "BYSTANDER_CONSENT_REQUESTED",
      details: `Account ${uploader.id} asked whether you agree to their file ${upload.id} being used; it is waiting for your answer`,
      userId: holder.id,
    });
    await sendMail(
      holder.email,
      "Someone asked whether you agree to a file that shows you",
      [
        `${uploader.name} (${uploader.email}) uploaded a file to SecureAI that they say shows or names you, and asked whether you agree to it being used.`,
        "",
        `File: ${upload.fileName}`,
        "",
        "You decide each use separately, and you can change your answer at any time. Until you answer, no feature uses the file.",
        "",
        `Sign in to answer: ${appUrl("/uploads")}`,
        "",
        "If you don't know this person, or you'd rather the file were removed, you can also ask us to review it:",
        appUrl("/report-content"),
        "",
        SIGNATURE,
      ].join("\n"),
    );
  }
}

/** Every request on these files, grouped by file. */
export async function requestsForUploads(
  uploadIds: readonly number[],
): Promise<Map<number, BystanderConsentRequest[]>> {
  const byUpload = new Map<number, BystanderConsentRequest[]>();
  if (uploadIds.length === 0) return byUpload;
  const rows = await db
    .select()
    .from(bystanderConsentRequestsTable)
    .where(inArray(bystanderConsentRequestsTable.uploadId, [...uploadIds]))
    .orderBy(asc(bystanderConsentRequestsTable.id));
  for (const row of rows) {
    const list = byUpload.get(row.uploadId) ?? [];
    list.push(row);
    byUpload.set(row.uploadId, list);
  }
  return byUpload;
}

export interface IncomingRequest {
  id: number;
  fromName: string;
  fromEmail: string;
  fileName: string;
  fileType: string;
  uploadedAt: string;
  requestedAt: string;
  personalisation: boolean | null;
  sharedTraining: boolean | null;
  answeredAt: string | null;
}

/** Requests sent to this account's address; none until the address is confirmed. */
export async function incomingRequests(user: {
  email: string;
  emailVerified: boolean;
}): Promise<IncomingRequest[]> {
  if (!user.emailVerified) return [];
  const rows = await db
    .select({
      request: bystanderConsentRequestsTable,
      fileName: uploadsTable.fileName,
      fileType: uploadsTable.fileType,
      uploadedAt: uploadsTable.createdAt,
      fromName: usersTable.name,
      fromEmail: usersTable.email,
    })
    .from(bystanderConsentRequestsTable)
    .innerJoin(
      uploadsTable,
      eq(uploadsTable.id, bystanderConsentRequestsTable.uploadId),
    )
    .innerJoin(usersTable, eq(usersTable.id, uploadsTable.userId))
    .where(
      eq(
        bystanderConsentRequestsTable.subjectEmail,
        user.email.trim().toLowerCase(),
      ),
    )
    .orderBy(asc(bystanderConsentRequestsTable.id));
  return rows.map(toIncoming);
}

function toIncoming(row: {
  request: BystanderConsentRequest;
  fileName: string;
  fileType: string;
  uploadedAt: Date;
  fromName: string;
  fromEmail: string;
}): IncomingRequest {
  return {
    id: row.request.id,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    fileName: row.fileName,
    fileType: row.fileType,
    uploadedAt: row.uploadedAt.toISOString(),
    requestedAt: row.request.createdAt.toISOString(),
    personalisation: row.request.personalisation,
    sharedTraining: row.request.sharedTraining,
    answeredAt: row.request.answeredAt?.toISOString() ?? null,
  };
}

/**
 * Records this account's answer, or a changed answer. Null when there is no such request for this
 * account's confirmed address, so someone else's request can't be told apart from one that doesn't
 * exist.
 */
export async function answerRequest(
  user: { id: number; email: string; emailVerified: boolean },
  requestId: number,
  answer: { personalisation: boolean; sharedTraining: boolean },
): Promise<IncomingRequest | null> {
  if (!user.emailVerified) return null;
  const [updated] = await db
    .update(bystanderConsentRequestsTable)
    .set({
      personalisation: answer.personalisation,
      sharedTraining: answer.sharedTraining,
      answeredByUserId: user.id,
      answeredAt: new Date(),
    })
    .where(
      and(
        eq(bystanderConsentRequestsTable.id, requestId),
        eq(
          bystanderConsentRequestsTable.subjectEmail,
          user.email.trim().toLowerCase(),
        ),
      ),
    )
    .returning({ id: bystanderConsentRequestsTable.id });
  if (!updated) return null;
  const all = await incomingRequests(user);
  return all.find((r) => r.id === requestId) ?? null;
}
