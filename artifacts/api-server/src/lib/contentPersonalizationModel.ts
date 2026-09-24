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
 * Uses TF-IDF over unigrams and bigrams rather than a neural embedding
 * model — no NLP/ML dependency is vendored, and every score traces to
 * countable word occurrences. Bigrams are extracted from genuinely
 * adjacent tokens in the original text, not reconstructed after stopword
 * removal, so a surfaced phrase reflects real adjacency in the source.
 */

import { and, eq, desc, or } from "drizzle-orm";
import { trainableCombinations } from "./dataProvenance";
import { db, uploadsTable, usersTable } from "@workspace/db";
import { decryptFile } from "./fileEncryption";

// Cost bound, not anti-poisoning — a private, single-account computation
// has no shared corpus for one account's volume to poison against another's.
export const MAX_DOCUMENTS = 30;
export const MAX_CHARS_PER_DOCUMENT = 20000;
export const MAX_KEYWORDS_RETURNED = 20;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "so", "of", "to", "in", "on", "at",
  "for", "with", "as", "by", "is", "are", "was", "were", "be", "been", "being", "this", "that",
  "these", "those", "it", "its", "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "they", "them", "their", "not", "no", "do", "does", "did", "have", "has", "had",
  "will", "would", "can", "could", "should", "shall", "from", "up", "down", "out", "about", "into",
  "over", "under", "again", "further", "just", "also", "very", "there", "here", "what", "which",
  "who", "whom", "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "only", "own", "same", "too", "s", "t", "don", "now",
]);

export interface KeywordScore {
  keyword: string;
  score: number; // TF-IDF weight within this account's own corpus — not comparable across accounts
}

export interface ContentProfile {
  keywords: KeywordScore[];
  documentsConsidered: number;
  builtAt: Date;
}

function isContentWord(word: string): boolean {
  return word.length > 2 && !STOPWORDS.has(word);
}

/** Kept in original order, unfiltered, so bigrams reflect genuine
 *  adjacency in the source text rather than tokens that only became
 *  "adjacent" after stopwords were removed between them. */
function tokenizeRaw(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/** A bigram is only extracted when BOTH of its words pass isContentWord —
 *  keeps "of the" / "in a" out without stripping stopwords before
 *  checking adjacency. */
function extractTerms(text: string): string[] {
  const raw = tokenizeRaw(text);
  const terms: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const word = raw[i]!;
    if (isContentWord(word)) terms.push(word);
    const next = raw[i + 1];
    if (next && isContentWord(word) && isContentWord(next)) {
      terms.push(`${word} ${next}`);
    }
  }
  return terms;
}

/** Returns an empty profile — not an error — if consent isn't given or no
 *  text uploads exist. */
export async function buildContentProfile(userId: number): Promise<ContentProfile> {
  const [user] = await db
    .select({ consent: usersTable.contentPersonalizationConsentGiven })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user?.consent) {
    return { keywords: [], documentsConsidered: 0, builtAt: new Date() };
  }

  // Eligibility comes from Team 2's acceptability matrix rather than a
  // hardcoded file-type test. The set this resolves to is currently
  // {own_work + text}, which is what the previous `fileType = "text"` filter
  // happened to select — but only on one of the two axes the matrix defines.
  // The source axis was absent entirely, so an uploaded copy of a published
  // book was indistinguishable from the uploader's own diary. Deriving the
  // filter from trainableCombinations() means a matrix revision changes this
  // query without anyone remembering to come back and edit it.
  const eligible = trainableCombinations();
  if (eligible.length === 0) {
    return { keywords: [], documentsConsidered: 0, builtAt: new Date() };
  }

  const docs = await db
    .select({ ciphertext: uploadsTable.ciphertext, iv: uploadsTable.iv, authTag: uploadsTable.authTag })
    .from(uploadsTable)
    .where(
      and(
        eq(uploadsTable.userId, userId),
        or(
          ...eligible.map((combo) =>
            and(eq(uploadsTable.contentSource, combo.source), eq(uploadsTable.fileType, combo.fileType)),
          ),
        ),
      ),
    )
    .orderBy(desc(uploadsTable.createdAt))
    .limit(MAX_DOCUMENTS);

  if (docs.length === 0) {
    return { keywords: [], documentsConsidered: 0, builtAt: new Date() };
  }

  // Term-frequency (total occurrences) and document-frequency (distinct
  // documents containing the term) are tracked separately — TF-IDF needs both.
  const termCounts = new Map<string, number>();
  const docFrequency = new Map<string, number>();
  let totalTermInstances = 0;
  let documentsConsidered = 0;

  for (const doc of docs) {
    let plaintext: string;
    try {
      plaintext = decryptFile(doc).toString("utf8").slice(0, MAX_CHARS_PER_DOCUMENT);
    } catch {
      continue; // a corrupt/undecryptable row must never break the whole profile
    }
    documentsConsidered += 1;

    const terms = extractTerms(plaintext);
    const seenInThisDoc = new Set<string>();
    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
      totalTermInstances += 1;
      seenInThisDoc.add(term);
    }
    for (const term of seenInThisDoc) {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    }
  }

  // Smoothed IDF (scikit-learn's default TfidfVectorizer formula):
  // idf = ln((N+1)/(df+1)) + 1. The "+1"s avoid division by zero and keep
  // every term's weight strictly positive even in the N=1 case, where an
  // un-smoothed IDF would collapse every score to zero.
  const N = documentsConsidered;
  const keywords: KeywordScore[] = Array.from(termCounts.entries())
    .map(([keyword, count]) => {
      const tf = totalTermInstances > 0 ? count / totalTermInstances : 0;
      const df = docFrequency.get(keyword) ?? 1;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      return { keyword, score: tf * idf };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KEYWORDS_RETURNED);

  return { keywords, documentsConsidered, builtAt: new Date() };
}
