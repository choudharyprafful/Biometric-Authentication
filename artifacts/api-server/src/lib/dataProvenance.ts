/**
 * Data-provenance classification and training-eligibility rules.
 *
 * WHAT THIS IMPLEMENTS
 *
 * The brief's Section 6 splits data provenance across the two teams:
 * Team 2 decides "which sources are allowed", Team 1 builds "records origin;
 * validates inputs". Team 2 delivered their half on 2026-09-09 — the Data
 * Source Acceptability Matrix, transcribed verbatim into
 * docs/09_Team2_Data_Source_Acceptability_Matrix.md. This file is Team 1's
 * half: that matrix turned into rules the pipeline actually evaluates.
 *
 * Until this existed, the matrix was a reference document. Nothing read it.
 * docs/08_Requests_to_Team2.md section 3 had already named the problem — the
 * consent gate "tags every record with a source/consent identifier but has no
 * allowed-sources list to check it against" — and the matrix was the missing
 * list. This closes that loop rather than restating it.
 *
 * WHY SOURCE AND FILE TYPE ARE BOTH REQUIRED
 *
 * The matrix is a two-dimensional table, so a one-dimensional check cannot
 * express it. A diary is trainable; a photograph of the same author's family
 * is not, because the matrix requires a bystander-consent workflow that this
 * app does not implement. Equally, text is trainable when the uploader wrote
 * it and never when they did not, however innocuous the file looks. Both axes
 * have to agree before anything enters a training corpus.
 *
 * Note what this means for the content-personalisation model: its existing
 * "text uploads only" restriction was already the right answer on the file-
 * type axis, but it was a hardcoded constant with the reasoning in a comment.
 * The source axis was absent entirely — an uploaded copy of a published book
 * was indistinguishable from the uploader's own diary. That is the gap this
 * closes, and it is the half that actually carries copyright and consent risk.
 *
 * FAIL-CLOSED, DELIBERATELY
 *
 * `unspecified` is not a matrix row. It is the default for an upload that
 * never declared an origin, including every row that predates this column,
 * and it is NOT trainable. The alternative — defaulting to `own_work` —
 * would silently enrol the entire existing corpus into training on an
 * assumption nobody made, which is the opposite of what the brief's "treat
 * every input as hostile" ground rule asks for. An undeclared upload is
 * usable by its owner exactly as before; it is only training that is withheld.
 */

/**
 * Upload origins, one per relevant row of the matrix's section 3 table,
 * plus the fail-closed default. Stored on the upload itself, because
 * provenance is a property of the file and not of the account that holds it:
 * one user can legitimately hold both their own diary and a scan of a
 * published book.
 */
export const CONTENT_SOURCES = [
  "own_work",
  "third_party_individual",
  "published_work",
  "social_media",
  "incidental_third_party_ip",
  "unspecified",
] as const;

export type ContentSource = (typeof CONTENT_SOURCES)[number];

export type UploadFileType = "image" | "video" | "text" | "audio";

/** Team 2's privacy tiers, matrix section 1. */
export type PrivacyTier = "T0" | "T1" | "T2" | "T3";

/** Team 2's copyright risk levels, matrix section 2. */
export type CopyrightRisk = "low" | "medium" | "high" | "unknown";

export interface SourceClassification {
  source: ContentSource;
  tier: PrivacyTier;
  copyrightRisk: CopyrightRisk;
  /** Human-readable label for the UI and for audit-log detail strings. */
  label: string;
  /** The matrix row this classification was read from, so any rule here can
   *  be traced back to Team 2's document rather than taken on trust. */
  matrixRow: string;
  /** False where the matrix rules the source out regardless of file type. */
  trainingPermitted: boolean;
  /** Why, in Team 2's own terms. Surfaced to the user and the audit log. */
  rationale: string;
}

const CLASSIFICATIONS: Record<ContentSource, SourceClassification> = {
  own_work: {
    source: "own_work",
    tier: "T2",
    copyrightRisk: "low",
    label: "My own work",
    matrixRow: "Uploaded text (diaries, documents)",
    trainingPermitted: true,
    rationale:
      "The uploader holds the rights, so copyright risk is low and training consent is obtainable from " +
      "the one person it belongs to. Still subject to the file-type rules below.",
  },
  third_party_individual: {
    source: "third_party_individual",
    tier: "T3",
    copyrightRisk: "high",
    label: "Someone else's work (a friend, a relative)",
    matrixRow: "Third-party content uploaded by a user (a friend's photo, a grandparent's diary, a deceased person's voicemail)",
    trainingPermitted: false,
    rationale:
      "The uploader has no rights to it and cannot consent on the other person's behalf. Team 2 notes the " +
      "deceased-person case is different in kind from the others: consent is not pending, it is permanently " +
      "out of reach.",
  },
  published_work: {
    source: "published_work",
    tier: "T1",
    copyrightRisk: "high",
    label: "Published work (a book, an article, a news story)",
    matrixRow: "Public / third-party content — published books, news, blogs",
    trainingPermitted: false,
    rationale:
      "The author agreed to publication, not to AI training. A licence is still required, and this app has " +
      "no licence-verification workflow to record one against.",
  },
  social_media: {
    source: "social_media",
    tier: "T3",
    copyrightRisk: "high",
    label: "Content from a social media platform",
    matrixRow: "Public / third-party content — social media",
    trainingPermitted: false,
    rationale:
      "Being public does not make it available for training. Team 2's stated default position is exclusion, " +
      "and the major platforms ban scraping in their terms outright.",
  },
  incidental_third_party_ip: {
    source: "incidental_third_party_ip",
    tier: "T2",
    copyrightRisk: "high",
    label: "My own work, but it contains someone else's IP",
    matrixRow: "Uploaded photos with incidental third-party IP (e.g. a branded character in frame)",
    trainingPermitted: false,
    rationale:
      "Team 2's note on this row is the operative one: the copyright risk is independent of anyone's consent " +
      "status, so the uploader's own consent does not resolve it.",
  },
  unspecified: {
    source: "unspecified",
    tier: "T3",
    copyrightRisk: "unknown",
    label: "Origin not declared",
    matrixRow: "(not a matrix row — the fail-closed default)",
    trainingPermitted: false,
    rationale:
      "No origin was declared, so no matrix row applies and nothing can be verified. Treated at the highest " +
      "tier and excluded from training until the uploader declares a source.",
  },
};

export function classifySource(source: ContentSource): SourceClassification {
  return CLASSIFICATIONS[source];
}

export function isContentSource(value: unknown): value is ContentSource {
  return typeof value === "string" && (CONTENT_SOURCES as readonly string[]).includes(value);
}

/**
 * File types the matrix permits into a training corpus, and the workflow each
 * excluded type is waiting on.
 *
 * Every exclusion here is blocked on a governance workflow that does not
 * exist, not on engineering effort. Recording that distinction matters: it is
 * the difference between "we decided not to" and "Team 2 requires something
 * we have not built", and only the second one is a roadmap item.
 */
const FILE_TYPE_RULES: Record<UploadFileType, { permitted: boolean; matrixRow: string; rationale: string }> = {
  text: {
    permitted: true,
    matrixRow: "Uploaded text (diaries, documents)",
    rationale: "Separate explicit training opt-in is sufficient; text depicts no third party by itself.",
  },
  image: {
    permitted: false,
    matrixRow: "Uploaded photos — family/group",
    rationale:
      "Requires a distinct bystander-consent workflow, which this app does not implement. Team 2 also flags " +
      "that minors in frame need a stricter path than adult bystanders.",
  },
  video: {
    permitted: false,
    matrixRow: "Uploaded video",
    rationale:
      "Requires the photo bystander-consent workflow plus explicit coverage of voice and likeness. Team 2 " +
      "notes face and voice together raise the deepfake risk above a still photo.",
  },
  audio: {
    permitted: false,
    matrixRow: "Uploaded audio / voice",
    rationale:
      "Requires consent that names voice cloning specifically rather than folding it into a general audio " +
      "consent. For music, the composer retains rights even though the user made the recording.",
  },
};

export interface TrainingEligibility {
  eligible: boolean;
  source: ContentSource;
  fileType: UploadFileType;
  tier: PrivacyTier;
  copyrightRisk: CopyrightRisk;
  /** Set when `eligible` is false: which axis refused, for the audit log. */
  blockedBy: "source" | "file_type" | null;
  /** One sentence naming the reason, suitable for a user-facing response. */
  reason: string;
  /** The matrix rows consulted, so a decision is traceable to Team 2's doc. */
  matrixRows: string[];
}

/**
 * The single decision point. Both training pipelines call this rather than
 * testing a file type or a source directly, so a matrix change lands in one
 * place instead of being re-derived at each call site.
 *
 * Source is evaluated first because it is the axis that carries the rights
 * question: a published book is excluded whether it arrives as text or as a
 * scan, and reporting "wrong file type" for it would be a misleading reason.
 */
export function assessTrainingEligibility(source: ContentSource, fileType: UploadFileType): TrainingEligibility {
  const classification = classifySource(source);
  const fileRule = FILE_TYPE_RULES[fileType];

  if (!classification.trainingPermitted) {
    return {
      eligible: false,
      source,
      fileType,
      tier: classification.tier,
      copyrightRisk: classification.copyrightRisk,
      blockedBy: "source",
      reason: classification.rationale,
      matrixRows: [classification.matrixRow],
    };
  }

  if (!fileRule.permitted) {
    return {
      eligible: false,
      source,
      fileType,
      tier: classification.tier,
      copyrightRisk: classification.copyrightRisk,
      blockedBy: "file_type",
      reason: fileRule.rationale,
      matrixRows: [classification.matrixRow, fileRule.matrixRow],
    };
  }

  return {
    eligible: true,
    source,
    fileType,
    tier: classification.tier,
    copyrightRisk: classification.copyrightRisk,
    blockedBy: null,
    reason: `${classification.rationale} ${fileRule.rationale}`,
    matrixRows: [classification.matrixRow, fileRule.matrixRow],
  };
}

/**
 * The (source, fileType) pairs the matrix currently admits into training.
 *
 * Exposed so the eligibility rules can be queried rather than inferred from
 * repeated calls, and so a verification run can assert on the whole surface
 * instead of a sample of it. Derived from the same tables as the live
 * decision, so it cannot drift away from what the pipeline actually does.
 */
export function trainableCombinations(): Array<{ source: ContentSource; fileType: UploadFileType }> {
  const fileTypes: UploadFileType[] = ["text", "image", "video", "audio"];
  const combos: Array<{ source: ContentSource; fileType: UploadFileType }> = [];
  for (const source of CONTENT_SOURCES) {
    for (const fileType of fileTypes) {
      if (assessTrainingEligibility(source, fileType).eligible) combos.push({ source, fileType });
    }
  }
  return combos;
}
