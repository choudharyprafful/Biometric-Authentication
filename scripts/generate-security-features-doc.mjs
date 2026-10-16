// Writes docs/13_Security_Features.md from the Security Center's feature list
// (artifacts/secureai/src/lib/securityFeatures.ts), so the page and the document can't disagree.
// CI runs it with --check, which fails when the document is out of date.
//
//   node scripts/generate-security-features-doc.mjs           rewrite the document
//   node scripts/generate-security-features-doc.mjs --check   fail if it differs
//
// It imports the TypeScript file directly, which needs Node 22.18 or later (CI uses 24).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import {
  SECURITY_FEATURE_AREAS,
  SECURITY_FEATURE_COUNT,
} from "../artifacts/secureai/src/lib/securityFeatures.ts";

const SOURCE = "artifacts/secureai/src/lib/securityFeatures.ts";
const outPath = fileURLToPath(
  new URL("../docs/13_Security_Features.md", import.meta.url),
);

// Backticks mark code (see the source); everything else is text, so Markdown characters are escaped.
const md = (text) =>
  text
    .split("`")
    .map((part, i) =>
      i % 2 === 1 ? `\`${part}\`` : part.replace(/[\\*_<[\]]/g, "\\$&"),
    )
    .join("");

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens.
const anchor = (title) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

const lines = [
  "# 13. Security Features",
  "",
  `Every security feature in SecureAI, ${SECURITY_FEATURE_COUNT} in ${SECURITY_FEATURE_AREAS.length} areas: what it does, how it is built, and where the code is.`,
  "",
  "The same list is the first tab of the Security Center in the web app (`/security-center`, for security analysts and administrators). There each card opens to the same explanation, and a feature with a live check shows the server's current state.",
  "",
  `Generated from \`${SOURCE}\` by \`node scripts/generate-security-features-doc.mjs\`. Edit that file, not this one: CI fails when the two differ.`,
  "",
  "## Contents",
  "",
  ...SECURITY_FEATURE_AREAS.map(
    (area) =>
      `- [${area.title}](#${anchor(area.title)}) (${area.features.length})`,
  ),
];

let number = 0;
for (const area of SECURITY_FEATURE_AREAS) {
  lines.push("", `## ${area.title}`);
  for (const feature of area.features) {
    number += 1;
    lines.push(
      "",
      `### ${number}. ${md(feature.name)}`,
      "",
      md(feature.detail),
      "",
      `**How it's built.** ${md(feature.how)}`,
      "",
      `**Code:** ${feature.code.map((file) => `\`${file}\``).join(", ")}`,
    );
    const where = [];
    if (feature.whereLabel) {
      where.push(
        md(feature.whereLabel) +
          (feature.where ? ` (\`${feature.where}\`)` : ""),
      );
    }
    if (feature.controlId) where.push("a live check in the Security Center");
    if (where.length > 0) lines.push("", `**See it:** ${where.join("; ")}.`);
  }
}

const document = await prettier.format(`${lines.join("\n")}\n`, {
  ...(await prettier.resolveConfig(outPath)),
  parser: "markdown",
});

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outPath)
    ? fs.readFileSync(outPath, "utf8").replace(/\r\n/g, "\n")
    : "";
  if (current !== document) {
    console.error(
      `docs/13_Security_Features.md is out of date with ${SOURCE}. Run: node scripts/generate-security-features-doc.mjs`,
    );
    process.exit(1);
  }
  console.log(
    `docs/13_Security_Features.md matches ${SOURCE} (${SECURITY_FEATURE_COUNT} features).`,
  );
} else {
  fs.writeFileSync(outPath, document);
  console.log(
    `Wrote docs/13_Security_Features.md (${SECURITY_FEATURE_COUNT} features).`,
  );
}
