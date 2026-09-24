/**
 * Verifies that the provenance rules in lib/dataProvenance.ts actually match
 * Team 2's Data Source Acceptability Matrix (docs/09), rather than verifying
 * that they compile.
 *
 * Permanent rather than throwaway for the same reason the DP suite is: the
 * failure mode here is silent. Someone adds a source to the enum and forgets
 * a classification entry; someone flips `trainingPermitted` while adjusting
 * copy; someone "simplifies" the two-axis check back to a file-type test.
 * None of those break a typecheck, and all of them would quietly re-open the
 * copyright and consent exposure the matrix exists to close.
 *
 * Section [3] is the one that matters: it asserts the exact set of
 * (source, fileType) pairs admitted into training, so ANY widening of that
 * surface fails here and has to be a deliberate, reviewed change.
 *
 * Run: pnpm --filter @workspace/api-server run verify:provenance
 * Needs no server and no database — the rules are pure functions.
 */
export {};

const {
  CONTENT_SOURCES,
  classifySource,
  assessTrainingEligibility,
  trainableCombinations,
  isContentSource,
} = await import("./dataProvenance");

type ContentSource = Awaited<typeof import("./dataProvenance")>["CONTENT_SOURCES"][number];
type UploadFileType = "image" | "video" | "text" | "audio";

let failures = 0;
function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  if (!pass) failures += 1;
}

const FILE_TYPES: UploadFileType[] = ["text", "image", "video", "audio"];

// ---------------------------------------------------------------------------
console.log("\n[1] Every source is classified, and every classification cites a matrix row");
{
  let unclassified = 0;
  let uncited = 0;
  for (const source of CONTENT_SOURCES) {
    const c = classifySource(source);
    if (!c) unclassified += 1;
    else if (!c.matrixRow || c.matrixRow.length < 5) uncited += 1;
  }
  check(
    "no source is missing a classification",
    unclassified === 0,
    `${CONTENT_SOURCES.length} sources declared, ${unclassified} without a classification entry`,
  );
  check(
    "every rule is traceable to Team 2's document",
    uncited === 0,
    `${uncited} classifications without a matrix row citation — a rule nobody can trace is a rule nobody can audit`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n[2] The fail-closed default actually fails closed");
{
  const undeclared = classifySource("unspecified");
  check(
    "an undeclared origin is never trainable",
    undeclared.trainingPermitted === false,
    `unspecified -> trainingPermitted=${undeclared.trainingPermitted}, tier=${undeclared.tier}`,
  );

  let leaked = 0;
  for (const fileType of FILE_TYPES) {
    if (assessTrainingEligibility("unspecified", fileType).eligible) leaked += 1;
  }
  check(
    "no file type rescues an undeclared origin",
    leaked === 0,
    `checked all ${FILE_TYPES.length} file types against 'unspecified'; ${leaked} were admitted`,
  );

  check(
    "an unrecognised value is not mistaken for a valid source",
    !isContentSource("own_work_please") && !isContentSource(null) && !isContentSource(42),
    "isContentSource() rejects a near-miss string, null, and a number",
  );
}

// ---------------------------------------------------------------------------
console.log("\n[3] THE GOVERNANCE TEST — the exact training surface, pinned");
{
  // Written out longhand rather than computed, so that widening the surface
  // requires editing this list on purpose. A test that derives its own
  // expectation from the code under test cannot catch the code changing.
  const EXPECTED = new Set(["own_work|text"]);

  const actual = new Set(trainableCombinations().map((c) => `${c.source}|${c.fileType}`));

  const unexpected = [...actual].filter((c) => !EXPECTED.has(c));
  const missing = [...EXPECTED].filter((c) => !actual.has(c));

  check(
    "nothing beyond the matrix's permitted set is trainable",
    unexpected.length === 0,
    unexpected.length === 0
      ? `training surface is exactly {${[...actual].join(", ")}} out of ${CONTENT_SOURCES.length * FILE_TYPES.length} possible pairs`
      : `WIDENED: ${unexpected.join(", ")} became trainable without this test being updated`,
  );
  check(
    "the permitted set hasn't been narrowed by accident either",
    missing.length === 0,
    missing.length === 0 ? "own_work + text still admitted" : `lost: ${missing.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n[4] Copyright-risk sources are refused on the SOURCE axis, not by luck");
{
  // The distinction matters. If a published book were only excluded because
  // it happened to arrive as a PDF (an unsupported type), then the same book
  // pasted as plain text would sail through. Assert the reason, not just the
  // outcome.
  const highRisk: ContentSource[] = ["third_party_individual", "published_work", "social_media", "incidental_third_party_ip"];

  let wrongAxis = 0;
  for (const source of highRisk) {
    const verdict = assessTrainingEligibility(source, "text");
    if (verdict.eligible || verdict.blockedBy !== "source") wrongAxis += 1;
  }
  check(
    "third-party/published/social content is blocked as text, by source",
    wrongAxis === 0,
    `${highRisk.length} high-risk sources tested as plain text — ${wrongAxis} were either admitted or blocked for the wrong reason`,
  );

  const book = assessTrainingEligibility("published_work", "text");
  console.log(`        published_work + text -> blockedBy=${book.blockedBy}, copyright=${book.copyrightRisk}`);
  console.log(`        reason: ${book.reason}`);
}

// ---------------------------------------------------------------------------
console.log("\n[5] Own work is still refused for media types awaiting a consent workflow");
{
  let wrong = 0;
  for (const fileType of ["image", "video", "audio"] as UploadFileType[]) {
    const verdict = assessTrainingEligibility("own_work", fileType);
    if (verdict.eligible || verdict.blockedBy !== "file_type") wrong += 1;
  }
  check(
    "own photos/video/audio are blocked on the FILE TYPE axis",
    wrong === 0,
    `3 media types tested as own_work — ${wrong} misclassified. Blocking here is a missing governance ` +
      `workflow (bystander/voice consent), not a copyright problem, and the axis says which`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n[6] Full decision matrix");
{
  const header = ["source".padEnd(28), ...FILE_TYPES.map((f) => f.padEnd(7))].join("");
  console.log(`        ${header}`);
  for (const source of CONTENT_SOURCES) {
    const cells = FILE_TYPES.map((f) => (assessTrainingEligibility(source, f).eligible ? "TRAIN" : "  -  ").padEnd(7));
    console.log(`        ${source.padEnd(28)}${cells.join("")}`);
  }
  const total = CONTENT_SOURCES.length * FILE_TYPES.length;
  console.log(`\n        ${trainableCombinations().length} of ${total} combinations admitted into training.`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
