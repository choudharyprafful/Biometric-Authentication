/**
 * The text side of the personal topic profile (contentPersonalizationModel.ts): splitting writing
 * into words, and scoring which words and two-word phrases are most distinctive. Pure functions with
 * no database import, so the AI Security page's fairness spot-check (topicFairness.ts) and CI can run
 * exactly the code the profile uses.
 *
 * Uses TF-IDF over unigrams and bigrams rather than a neural embedding model — no NLP/ML dependency
 * is vendored, and every score traces to countable word occurrences. Bigrams are extracted from
 * genuinely adjacent tokens in the original text, not reconstructed after stopword removal, so a
 * surfaced phrase reflects real adjacency in the source.
 *
 * Words are found with the runtime's Unicode word segmentation (Intl.Segmenter), so writing in any
 * script counts. Until 2026-10-15 the tokenizer kept only a-z and 0-9: "canción" became "canci",
 * and writing in Hindi, Chinese, Vietnamese or Arabic produced no topics at all. Team 2's fairness
 * test (risk R13) is what found it; topicFairness.ts keeps checking it. The stopword list is still
 * English only, so in other languages some everyday words can surface as topics (aiSystems.ts lists
 * this as a known limit).
 */

export const MAX_KEYWORDS_RETURNED = 20;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "so",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "with",
  "as",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "they",
  "them",
  "their",
  "not",
  "no",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "will",
  "would",
  "can",
  "could",
  "should",
  "shall",
  "from",
  "up",
  "down",
  "out",
  "about",
  "into",
  "over",
  "under",
  "again",
  "further",
  "just",
  "also",
  "very",
  "there",
  "here",
  "what",
  "which",
  "who",
  "whom",
  "when",
  "where",
  "why",
  "how",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "only",
  "own",
  "same",
  "too",
  "s",
  "t",
  "don",
  "now",
]);

export interface KeywordScore {
  keyword: string;
  score: number; // TF-IDF weight within this account's own corpus — not comparable across accounts
}

const WORDS = new Intl.Segmenter(undefined, { granularity: "word" });
// Scripts written without spaces, where a two-character word is an ordinary word, not a fragment.
const DENSE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** Words in reading order, lower-cased and in one Unicode form, punctuation dropped. Kept unfiltered
 *  so bigrams reflect genuine adjacency in the source text rather than tokens that only became
 *  "adjacent" after stopwords were removed between them. */
export function tokenizeWords(text: string): string[] {
  const words: string[] = [];
  for (const piece of WORDS.segment(text.normalize("NFC").toLowerCase())) {
    if (piece.isWordLike) words.push(piece.segment);
  }
  return words;
}

function isContentWord(word: string): boolean {
  const length = [...word].length;
  const minLength = DENSE_SCRIPT.test(word) ? 2 : 3;
  return length >= minLength && !STOPWORDS.has(word);
}

/** A bigram is only extracted when BOTH of its words pass isContentWord — keeps "of the" / "in a"
 *  out without stripping stopwords before checking adjacency. */
function extractTerms(
  text: string,
  tokenize: (text: string) => string[],
): string[] {
  const raw = tokenize(text);
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

/**
 * The most distinctive words and phrases across one person's documents, highest first. `tokenize`
 * is replaceable only so the fairness check can compare against the old tokenizer.
 */
export function topicKeywords(
  documents: readonly string[],
  tokenize: (text: string) => string[] = tokenizeWords,
): KeywordScore[] {
  // Term-frequency (total occurrences) and document-frequency (distinct
  // documents containing the term) are tracked separately — TF-IDF needs both.
  const termCounts = new Map<string, number>();
  const docFrequency = new Map<string, number>();
  let totalTermInstances = 0;
  for (const text of documents) {
    const seenInThisDoc = new Set<string>();
    for (const term of extractTerms(text, tokenize)) {
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
  const N = documents.length;
  return Array.from(termCounts.entries())
    .map(([keyword, count]) => {
      const tf = totalTermInstances > 0 ? count / totalTermInstances : 0;
      const df = docFrequency.get(keyword) ?? 1;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      return { keyword, score: tf * idf };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_KEYWORDS_RETURNED);
}
