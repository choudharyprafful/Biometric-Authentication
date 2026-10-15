/**
 * CI check for the topic profile's fairness spot-check (topicFairness.ts; Team 2's risk R13): every
 * synthetic writer gets a consistent profile, and the old a-z-only tokenizer is still detected as
 * degraded, so the check itself can't quietly stop working.
 *
 *   pnpm --filter @workspace/api-server run verify:fairness
 *
 * Pure: no database, no network.
 */
import { runTopicFairnessCheck } from "./topicFairness";

let failures = 0;
function check(label: string, pass: boolean, detail = ""): void {
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
}

const report = runTopicFairnessCheck();
console.log(`\nTopic profile fairness spot-check: ${report.model}\n`);
for (const p of report.personas) {
  check(
    `${p.label}: consistent`,
    p.verdict === "consistent",
    `now: ${p.secureai.wordsRead}% of words read, ${p.secureai.topics} topics, fragments [${p.secureai.fragments.join(", ")}]; ` +
      `before: ${p.before.wordsRead}%, ${p.before.topics} topics, fragments [${p.before.fragments.join(", ")}]; ` +
      `topics: ${p.secureai.sample.join(", ")}`,
  );
}
const ascii = report.personas.filter(
  (p) => p.id.startsWith("en-") && p.id !== "en-names",
);
check(
  "plain English writers were already fine before (the check isn't failing everything)",
  ascii.every(
    (p) => p.before.wordsRead >= 90 && p.before.fragments.length === 0,
  ),
);
check(
  "the old a-z-only tokenizer is still caught for the other writers",
  report.summary.degradedBefore >= 6,
  `${report.summary.degradedBefore} of ${report.personas.length} degraded before`,
);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
