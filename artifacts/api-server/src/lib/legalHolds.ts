/**
 * Legal holds (docs/12_Data_Breach_Response_Plan.md section 3; privacy policy sections 9 and 10).
 *
 * When a government or law-enforcement request arrives, an administrator places a hold on the person
 * it names. What exists of theirs is copied straight away, and while the hold is active anything of
 * theirs about to be deleted or replaced (by them, by staff, or by the retention purge) is copied
 * first. The person sees no difference: their own deletions still happen, which also avoids tipping
 * them off when an order forbids telling them. Releasing the hold deletes the copies.
 *
 * Copies keep encrypted fields encrypted, as stored, and no endpoint returns them: producing them for
 * an agency is an operator task (docs/12), so no account, an administrator's included, can read
 * someone else's files or face template through the app. Password hashes are never copied.
 */
import crypto from "node:crypto";
import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  uploadsTable,
  passkeysTable,
  biometricKeysTable,
  paymentsTable,
  securityLogsTable,
  legalHoldsTable,
  legalHoldItemsTable,
  type LegalHold,
} from "@workspace/db";
import { recordEvent } from "./auditLog";
import type { Actor } from "./aiGovernance";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export const HOLD_COPY_KINDS = [
  "account",
  "face-template",
  "upload",
  "passkey",
  "phone-key",
  "payment",
  "security-record",
] as const;
export type HoldCopyKind = (typeof HOLD_COPY_KINDS)[number];
type CopyReason = "placed" | "deleted" | "retention";

export class HoldNotFoundError extends Error {}
export class HoldAlreadyReleasedError extends Error {}

export interface HoldView {
  id: number;
  subjectEmail: string;
  accountFound: boolean;
  agency: string;
  reference: string | null;
  reason: string;
  placedByEmail: string;
  placedAt: Date;
  releasedAt: Date | null;
  releasedByEmail: string | null;
  releaseReason: string | null;
  copies: { kind: HoldCopyKind; count: number }[];
  copiesTotal: number;
}

// Before scripts/ops/migrate-legal-holds.mjs has run there is no hold table, so no hold to honour.
const isMissingTable = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
};

function actorFields(actor: Actor) {
  return {
    userId: actor.userId,
    userEmail: actor.email,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  };
}

/**
 * The active holds on a person, by account id or email. Call it before the transaction that deletes,
 * and pass the result in: a failed query inside a transaction would abort the whole transaction.
 */
export async function activeHoldsFor(subject: {
  userId?: number | null;
  email?: string | null;
}): Promise<number[]> {
  const email = subject.email?.trim().toLowerCase() || null;
  const matches = [];
  if (subject.userId != null)
    matches.push(eq(legalHoldsTable.subjectUserId, subject.userId));
  if (email) matches.push(eq(legalHoldsTable.subjectEmail, email));
  if (matches.length === 0) return [];
  try {
    const rows = await db
      .select({ id: legalHoldsTable.id })
      .from(legalHoldsTable)
      .where(and(isNull(legalHoldsTable.releasedAt), or(...matches)));
    return rows.map((r) => r.id);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Copies rows into each hold. The same row unchanged is kept once; a changed one is kept again. */
async function keep(
  exec: Executor,
  holdIds: number[],
  kind: HoldCopyKind,
  reason: CopyReason,
  rows: { sourceId: number; data: object }[],
): Promise<number> {
  if (holdIds.length === 0 || rows.length === 0) return 0;
  const values = holdIds.flatMap((holdId) =>
    rows.map((row) => {
      // Through JSON once, so dates are stored as the ISO strings the fingerprint was taken of.
      const data = JSON.parse(JSON.stringify(row.data)) as object;
      return {
        holdId,
        kind,
        sourceId: row.sourceId,
        reason,
        data,
        dataSha256: crypto
          .createHash("sha256")
          .update(JSON.stringify(data))
          .digest("hex"),
      };
    }),
  );
  // An upload can be 15 MB of ciphertext, so those go one statement each.
  const chunk = kind === "upload" ? 1 : 200;
  let kept = 0;
  for (let i = 0; i < values.length; i += chunk) {
    const inserted = await exec
      .insert(legalHoldItemsTable)
      .values(values.slice(i, i + chunk))
      .onConflictDoNothing()
      .returning({ id: legalHoldItemsTable.id });
    kept += inserted.length;
  }
  return kept;
}

type UserRow = typeof usersTable.$inferSelect;

// The account without its password hash (never kept) and without the face template (kept as its own
// kind, so removing a face can be copied on its own).
function accountData(user: UserRow) {
  const {
    passwordHash: _passwordHash,
    faceDescriptorCiphertext: _ciphertext,
    faceDescriptorIv: _iv,
    faceDescriptorAuthTag: _authTag,
    ...profile
  } = user;
  return profile;
}

/** Before a face template is removed or replaced. Nothing to copy if there isn't one. */
export async function keepFaceTemplate(
  exec: Executor,
  holdIds: number[],
  user: UserRow,
  reason: CopyReason = "deleted",
): Promise<number> {
  if (!user.faceDescriptorCiphertext) return 0;
  return keep(exec, holdIds, "face-template", reason, [
    {
      sourceId: user.id,
      data: {
        userId: user.id,
        faceDescriptorCiphertext: user.faceDescriptorCiphertext,
        faceDescriptorIv: user.faceDescriptorIv,
        faceDescriptorAuthTag: user.faceDescriptorAuthTag,
        biometricConsentAt: user.biometricConsentAt,
      },
    },
  ]);
}

/** Before an upload is deleted. */
export function keepUpload(
  exec: Executor,
  holdIds: number[],
  upload: typeof uploadsTable.$inferSelect,
): Promise<number> {
  return keep(exec, holdIds, "upload", "deleted", [
    { sourceId: upload.id, data: upload },
  ]);
}

/** Before passkeys are deleted. */
export function keepPasskeys(
  exec: Executor,
  holdIds: number[],
  passkeys: (typeof passkeysTable.$inferSelect)[],
): Promise<number> {
  return keep(
    exec,
    holdIds,
    "passkey",
    "deleted",
    passkeys.map((p) => ({ sourceId: p.id, data: p })),
  );
}

/** Everything that goes with an account: the account, its face template, uploads and sign-in keys. */
async function keepAccount(
  exec: Executor,
  holdIds: number[],
  user: UserRow,
  reason: CopyReason,
): Promise<number> {
  if (holdIds.length === 0) return 0;
  const [uploads, passkeys, phoneKeys] = await Promise.all([
    exec.select().from(uploadsTable).where(eq(uploadsTable.userId, user.id)),
    exec.select().from(passkeysTable).where(eq(passkeysTable.userId, user.id)),
    exec
      .select()
      .from(biometricKeysTable)
      .where(eq(biometricKeysTable.userId, user.id)),
  ]);
  let kept = await keep(exec, holdIds, "account", reason, [
    { sourceId: user.id, data: accountData(user) },
  ]);
  kept += await keepFaceTemplate(exec, holdIds, user, reason);
  for (const upload of uploads)
    kept += await keep(exec, holdIds, "upload", reason, [
      { sourceId: upload.id, data: upload },
    ]);
  kept += await keep(
    exec,
    holdIds,
    "passkey",
    reason,
    passkeys.map((p) => ({ sourceId: p.id, data: p })),
  );
  kept += await keep(
    exec,
    holdIds,
    "phone-key",
    reason,
    phoneKeys.map((k) => ({ sourceId: k.id, data: k })),
  );
  return kept;
}

/** Before an account is deleted: run inside the deleting transaction. */
export async function keepAccountBeforeDeletion(
  tx: Tx,
  holdIds: number[],
  userId: number,
): Promise<number> {
  if (holdIds.length === 0) return 0;
  const [user] = await tx
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user ? keepAccount(tx, holdIds, user, "deleted") : 0;
}

// A held person's records: by account id where the record has one, otherwise by email.
function heldPersonIs(
  hold: LegalHold,
  userIdColumn: typeof paymentsTable.userId | typeof securityLogsTable.userId,
  emailColumn:
    typeof paymentsTable.userEmail | typeof securityLogsTable.userEmail,
) {
  return or(
    hold.subjectUserId != null
      ? eq(userIdColumn, hold.subjectUserId)
      : sql`false`,
    sql`lower(${emailColumn}) = ${hold.subjectEmail}`,
  );
}

/**
 * Before the retention purge: copies held people's payment and security records that are due for
 * deletion, or within a day of it, so nothing falls due between the copy and the purge. AI challenge
 * records (kept 2 years) are security records too, so they are copied after 12 months, early but
 * harmlessly.
 */
export async function keepRecordsDueForPurge(periods: {
  paymentRecordsYears: number;
  securityLogMonths: number;
}): Promise<number> {
  let holds: LegalHold[];
  try {
    holds = await db
      .select()
      .from(legalHoldsTable)
      .where(isNull(legalHoldsTable.releasedAt));
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
  let kept = 0;
  for (const hold of holds) {
    const payments = await db
      .select()
      .from(paymentsTable)
      .where(
        and(
          heldPersonIs(hold, paymentsTable.userId, paymentsTable.userEmail),
          lt(
            paymentsTable.createdAt,
            sql`now() - make_interval(years => ${periods.paymentRecordsYears}) + interval '1 day'`,
          ),
        ),
      );
    kept += await keep(
      db,
      [hold.id],
      "payment",
      "retention",
      payments.map((p) => ({ sourceId: p.id, data: p })),
    );
    const records = await db
      .select()
      .from(securityLogsTable)
      .where(
        and(
          heldPersonIs(
            hold,
            securityLogsTable.userId,
            securityLogsTable.userEmail,
          ),
          lt(
            securityLogsTable.timestamp,
            sql`now() - make_interval(months => ${periods.securityLogMonths}) + interval '1 day'`,
          ),
        ),
      );
    kept += await keep(
      db,
      [hold.id],
      "security-record",
      "retention",
      records.map((r) => ({ sourceId: r.id, data: r })),
    );
  }
  return kept;
}

async function views(holds: LegalHold[]): Promise<HoldView[]> {
  if (holds.length === 0) return [];
  const counts = await db
    .select({
      holdId: legalHoldItemsTable.holdId,
      kind: legalHoldItemsTable.kind,
      n: count(),
    })
    .from(legalHoldItemsTable)
    .groupBy(legalHoldItemsTable.holdId, legalHoldItemsTable.kind);
  return holds.map(({ subjectUserId, ...hold }) => {
    const copies = HOLD_COPY_KINDS.flatMap((kind) => {
      const row = counts.find((c) => c.holdId === hold.id && c.kind === kind);
      return row ? [{ kind, count: Number(row.n) }] : [];
    });
    return {
      ...hold,
      accountFound: subjectUserId != null,
      copies,
      copiesTotal: copies.reduce((sum, c) => sum + c.count, 0),
    };
  });
}

/** Active holds first, newest first within each. */
export async function listHolds(): Promise<HoldView[]> {
  return views(
    await db
      .select()
      .from(legalHoldsTable)
      .orderBy(
        sql`${legalHoldsTable.releasedAt} IS NOT NULL`,
        desc(legalHoldsTable.placedAt),
        desc(legalHoldsTable.id),
      ),
  );
}

async function viewOf(id: number): Promise<HoldView> {
  const [hold] = await db
    .select()
    .from(legalHoldsTable)
    .where(eq(legalHoldsTable.id, id));
  if (!hold) throw new HoldNotFoundError();
  const [view] = await views([hold]);
  return view!;
}

/**
 * Places a hold and copies what the person has now: their account, face template, uploads and sign-in
 * keys if the account exists, and their payment records either way. Their security records can't be
 * changed, only purged, so they are copied when the purge is due. The audit entry names the agency
 * but not the person, as for disclosures: the security log is read more widely than this record.
 */
export async function placeHold(
  input: {
    subjectEmail: string;
    agency: string;
    reference?: string | null;
    reason: string;
  },
  actor: Actor,
): Promise<HoldView> {
  const email = input.subjectEmail.trim().toLowerCase();
  const hold = await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
    const [row] = await tx
      .insert(legalHoldsTable)
      .values({
        subjectEmail: email,
        subjectUserId: user?.id ?? null,
        agency: input.agency.trim(),
        reference: input.reference?.trim() || null,
        reason: input.reason.trim(),
        placedByEmail: actor.email,
      })
      .returning();
    if (user) await keepAccount(tx, [row!.id], user, "placed");
    const payments = await tx
      .select()
      .from(paymentsTable)
      .where(heldPersonIs(row!, paymentsTable.userId, paymentsTable.userEmail));
    await keep(
      tx,
      [row!.id],
      "payment",
      "placed",
      payments.map((p) => ({ sourceId: p.id, data: p })),
    );
    return row!;
  });
  const view = await viewOf(hold.id);
  await recordEvent({
    eventType: "LEGAL_HOLD_PLACED",
    details: `hold=${hold.id}; agency=${hold.agency}; accountFound=${view.accountFound}; copies=${view.copiesTotal}`,
    ...actorFields(actor),
  });
  return view;
}

/** Ends a hold once the obligation is over, and deletes its copies. A released hold stays released. */
export async function releaseHold(
  id: number,
  reason: string,
  actor: Actor,
): Promise<HoldView> {
  const deleted = await db.transaction(async (tx) => {
    const [hold] = await tx
      .select()
      .from(legalHoldsTable)
      .where(eq(legalHoldsTable.id, id))
      .for("update");
    if (!hold) throw new HoldNotFoundError();
    if (hold.releasedAt) throw new HoldAlreadyReleasedError();
    const removed = await tx
      .delete(legalHoldItemsTable)
      .where(eq(legalHoldItemsTable.holdId, id))
      .returning({ id: legalHoldItemsTable.id });
    await tx
      .update(legalHoldsTable)
      .set({
        releasedAt: new Date(),
        releasedByEmail: actor.email,
        releaseReason: reason.trim(),
      })
      .where(eq(legalHoldsTable.id, id));
    return removed.length;
  });
  await recordEvent({
    eventType: "LEGAL_HOLD_RELEASED",
    details: `hold=${id}; copiesDeleted=${deleted}; reason=${reason.trim()}`,
    ...actorFields(actor),
  });
  return viewOf(id);
}
