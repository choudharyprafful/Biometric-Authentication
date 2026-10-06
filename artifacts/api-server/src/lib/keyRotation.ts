import { and, asc, eq, gt, isNotNull, notLike } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db, usersTable, uploadsTable, paymentsTable } from "@workspace/db";
import {
  currentKeyId,
  hasIndependentKey,
  reencrypt,
  type EncryptedFile,
} from "./fileEncryption";
import { logEvent } from "./auditLog";
import { logger } from "./logger";

// Moves everything encrypted at rest onto the current key (docs/04 R-DP-3). Runs when the API
// starts and hourly after that, but only once FILE_ENCRYPTION_KEY is set: until then the current
// key is the legacy one derived from SESSION_SECRET and there is nothing to move. After a key
// change the old key has to stay readable (FILE_ENCRYPTION_PREVIOUS_KEYS, or SESSION_SECRET for
// the legacy key) until this job reports that nothing is left on it.

interface Target {
  label: string;
  table: PgTable;
  id: AnyPgColumn;
  ciphertext: AnyPgColumn;
  iv: AnyPgColumn;
  authTag: AnyPgColumn;
  /** The same three columns by their property names, which is what update().set() takes. */
  props: { ciphertext: string; iv: string; authTag: string };
  /** Rows per query; uploads are up to 15 MB each, so fewer at a time. */
  batch: number;
}

const TARGETS: Target[] = [
  {
    label: "face templates",
    table: usersTable,
    id: usersTable.id,
    ciphertext: usersTable.faceDescriptorCiphertext,
    iv: usersTable.faceDescriptorIv,
    authTag: usersTable.faceDescriptorAuthTag,
    props: {
      ciphertext: "faceDescriptorCiphertext",
      iv: "faceDescriptorIv",
      authTag: "faceDescriptorAuthTag",
    },
    batch: 100,
  },
  {
    label: "uploads",
    table: uploadsTable,
    id: uploadsTable.id,
    ciphertext: uploadsTable.ciphertext,
    iv: uploadsTable.iv,
    authTag: uploadsTable.authTag,
    props: { ciphertext: "ciphertext", iv: "iv", authTag: "authTag" },
    batch: 5,
  },
  {
    label: "payment tokens",
    table: paymentsTable,
    id: paymentsTable.id,
    ciphertext: paymentsTable.providerTokenCiphertext,
    iv: paymentsTable.providerTokenIv,
    authTag: paymentsTable.providerTokenAuthTag,
    props: {
      ciphertext: "providerTokenCiphertext",
      iv: "providerTokenIv",
      authTag: "providerTokenAuthTag",
    },
    batch: 100,
  },
];

export interface RotationResult {
  keyId: string;
  reencrypted: Record<string, number>;
  /** Values no configured key could open: left untouched, and reported. */
  unreadable: Record<string, number>;
}

const notOnCurrentKey = (t: Target) =>
  and(isNotNull(t.iv), notLike(t.iv, `${currentKeyId()}:%`));

async function rotateTarget(
  t: Target,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  let afterId = 0;
  for (;;) {
    const rows = (await db
      .select({
        id: t.id,
        ciphertext: t.ciphertext,
        iv: t.iv,
        authTag: t.authTag,
      })
      .from(t.table)
      .where(and(notOnCurrentKey(t), gt(t.id, afterId)))
      .orderBy(asc(t.id))
      .limit(t.batch)) as Array<{ id: number } & EncryptedFile>;
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = row.id;
      let next: EncryptedFile;
      try {
        next = reencrypt(row);
      } catch (err) {
        failed += 1;
        logger.error(
          { err, table: t.label, id: row.id },
          "Key rotation: a stored value could not be decrypted with any configured key",
        );
        continue;
      }
      // Only if the row still holds what was read: a value rewritten meanwhile (a new face
      // enrolment, say) is already on the current key and must not be overwritten.
      const updated = await db
        .update(t.table)
        .set({
          [t.props.ciphertext]: next.ciphertext,
          [t.props.iv]: next.iv,
          [t.props.authTag]: next.authTag,
        } as never)
        .where(and(eq(t.id, row.id), eq(t.iv, row.iv)))
        .returning({ id: t.id });
      if (updated.length) done += 1;
    }
  }
  return { done, failed };
}

/** Re-encrypts every value that isn't on the current key. Safe to run repeatedly. */
export async function rotateToCurrentKey(): Promise<RotationResult> {
  const result: RotationResult = {
    keyId: currentKeyId(),
    reencrypted: {},
    unreadable: {},
  };
  for (const t of TARGETS) {
    const { done, failed } = await rotateTarget(t);
    result.reencrypted[t.label] = done;
    result.unreadable[t.label] = failed;
  }
  return result;
}

/** How many stored values are still on a key other than the current one, per kind. */
export async function countNotOnCurrentKey(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of TARGETS) {
    const rows = await db
      .select({ id: t.id })
      .from(t.table)
      .where(notOnCurrentKey(t));
    counts[t.label] = rows.length;
  }
  return counts;
}

const describe = (counts: Record<string, number>) =>
  Object.entries(counts)
    .map(([label, n]) => `${label} ${n}`)
    .join(", ");

// Unreadable values stay unreadable from one pass to the next; record them again only if the
// number changes, rather than once an hour.
let lastUnreadable = 0;

async function runRotationPass(): Promise<void> {
  const result = await rotateToCurrentKey();
  const moved = Object.values(result.reencrypted).reduce((a, b) => a + b, 0);
  const unreadable = Object.values(result.unreadable).reduce(
    (a, b) => a + b,
    0,
  );
  const unreadableChanged = unreadable !== lastUnreadable;
  lastUnreadable = unreadable;
  if (moved === 0 && !unreadableChanged) return;
  const remaining = await countNotOnCurrentKey();
  logger.info({ ...result, remaining }, "Key rotation: pass complete");
  await logEvent({
    eventType: "ENCRYPTION_KEY_ROTATED",
    details:
      `Re-encrypted under key ${result.keyId}: ${describe(result.reencrypted)}. ` +
      `Still on an older key: ${describe(remaining)}` +
      (unreadable
        ? `. Could not be decrypted with any configured key: ${describe(result.unreadable)}`
        : ""),
  });
}

const ROTATION_INTERVAL_MS = 60 * 60 * 1000;

export function startKeyRotationJob(): void {
  if (!hasIndependentKey()) {
    // Production should never run like this; development may.
    const level = process.env["NODE_ENV"] === "production" ? "warn" : "info";
    logger[level](
      "Encryption key: FILE_ENCRYPTION_KEY is not set, so data at rest is encrypted with a key derived from SESSION_SECRET (docs/04 R-DP-3)",
    );
    return;
  }
  logger.info(
    { keyId: currentKeyId() },
    "Encryption key: independent key configured; moving any older values onto it",
  );
  const run = () =>
    runRotationPass().catch((err) =>
      logger.warn({ err }, "Key rotation: pass failed"),
    );
  void run();
  setInterval(run, ROTATION_INTERVAL_MS).unref();
}
