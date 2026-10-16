/**
 * The first place in this app that reads the actual CONTENT of an upload
 * server-side, not just its metadata — gated behind its own separate
 * consent flag (contentPersonalizationConsentGiven), never pooled across
 * users, and never persisted: the profile is recomputed fresh from
 * decrypted-in-memory content on every request, so withdrawing consent or
 * deleting the uploads takes effect immediately with no stored profile to
 * separately delete.
 *
 * Scope is TEXT uploads the account authored ITSELF, and that pair of
 * conditions is enforced by lib/dataProvenance.ts rather than asserted here:
 * photos/video need a distinct bystander-consent workflow this app doesn't
 * implement, audio carries its own voice-cloning-specific consent
 * requirement, and content the uploader didn't write is ruled out on
 * copyright grounds independently of any consent they could give.
 *
 * The words and the scoring are in topicModel.ts (pure, no database), so
 * the fairness spot-check runs exactly the same code.
 */

import { and, eq, desc, or, isNull, sql, type SQL } from "drizzle-orm";
import { trainableCombinations } from "./dataProvenance";
import {
  db,
  uploadsTable,
  usersTable,
  bystanderConsentRequestsTable,
} from "@workspace/db";
import { decryptFile } from "./fileEncryption";
import { topicKeywords, type KeywordScore } from "./topicModel";

export { MAX_KEYWORDS_RETURNED, type KeywordScore } from "./topicModel";

// Cost bound, not anti-poisoning — a private, single-account computation
// has no shared corpus for one account's volume to poison against another's.
export const MAX_DOCUMENTS = 30;
export const MAX_CHARS_PER_DOCUMENT = 20000;

export interface ContentProfile {
  keywords: KeywordScore[];
  documentsConsidered: number;
  builtAt: Date;
}

/**
 * The account's files the profile is allowed to read, as a query condition; undefined when the
 * matrix currently admits nothing. The profile and "delete the files it used" (routes/
 * contentProfile.ts) both use this, so the files offered for deletion are exactly the ones read.
 *
 * Eligibility comes from Team 2's acceptability matrix rather than a hardcoded file-type test. The
 * set this resolves to is currently {own_work + text}, which is what the previous
 * `fileType = "text"` filter happened to select — but only on one of the two axes the matrix
 * defines. The source axis was absent entirely, so an uploaded copy of a published book was
 * indistinguishable from the uploader's own diary. Deriving the filter from
 * trainableCombinations() means a matrix revision changes this query without anyone remembering
 * to come back and edit it.
 */
export function profileFilesCondition(userId: number): SQL | undefined {
  const eligible = trainableCombinations();
  if (eligible.length === 0) return undefined;
  return and(
    eq(uploadsTable.userId, userId),
    // Team 2's Bystander Consent Policy (dataProvenance.ts assessPeopleRules): a file that shows
    // someone under 18, or that someone in it has asked us to review, is used by no feature.
    sql`NOT (coalesce(${uploadsTable.bystanders}, '{}'::text[]) @> ARRAY['minor']::text[])`,
    isNull(uploadsTable.pausedForReviewAt),
    // Someone in it with their own account: only once every one of them has agreed to this use.
    sql`(NOT (coalesce(${uploadsTable.bystanders}, '{}'::text[]) @> ARRAY['account']::text[])
      OR (EXISTS (SELECT 1 FROM ${bystanderConsentRequestsTable} r WHERE r.upload_id = ${uploadsTable.id})
        AND NOT EXISTS (SELECT 1 FROM ${bystanderConsentRequestsTable} r
          WHERE r.upload_id = ${uploadsTable.id} AND r.personalisation IS DISTINCT FROM true)))`,
    or(
      ...eligible.map((combo) =>
        and(
          eq(uploadsTable.contentSource, combo.source),
          eq(uploadsTable.fileType, combo.fileType),
        ),
      ),
    ),
  );
}

/** Returns an empty profile — not an error — if consent isn't given or no
 *  text uploads exist. */
export async function buildContentProfile(
  userId: number,
): Promise<ContentProfile> {
  const [user] = await db
    .select({ consent: usersTable.contentPersonalizationConsentGiven })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user?.consent) {
    return { keywords: [], documentsConsidered: 0, builtAt: new Date() };
  }

  const readable = profileFilesCondition(userId);
  if (!readable) {
    return { keywords: [], documentsConsidered: 0, builtAt: new Date() };
  }

  const docs = await db
    .select({
      ciphertext: uploadsTable.ciphertext,
      iv: uploadsTable.iv,
      authTag: uploadsTable.authTag,
    })
    .from(uploadsTable)
    .where(readable)
    .orderBy(desc(uploadsTable.createdAt))
    .limit(MAX_DOCUMENTS);

  if (docs.length === 0) {
    return { keywords: [], documentsConsidered: 0, builtAt: new Date() };
  }

  const texts: string[] = [];
  for (const doc of docs) {
    try {
      texts.push(
        decryptFile(doc).toString("utf8").slice(0, MAX_CHARS_PER_DOCUMENT),
      );
    } catch {
      continue; // a corrupt/undecryptable row must never break the whole profile
    }
  }
  const keywords = topicKeywords(texts);
  const documentsConsidered = texts.length;

  return { keywords, documentsConsidered, builtAt: new Date() };
}
