// Prints one command box from README.md "Quick start", found by the <!-- quickstart:NAME --> marker
// above it, so .github/workflows/quickstart.yml runs exactly what the README tells people to paste.
//
//   node scripts/ci/quickstart-block.mjs NAME [--cmd] [--clone-from PATH]
//
// --cmd              prefix each line with "call": pasted into Command Prompt every line runs, but in
//                    a batch file a line running a .cmd program (npm, pnpm) would end the batch.
// --clone-from PATH  clone the copy under test instead of GitHub's main branch; nothing else changes.
import fs from "node:fs";

const [name, ...options] = process.argv.slice(2);
const readme = fs.readFileSync(
  new URL("../../README.md", import.meta.url),
  "utf8",
);
const match = readme.match(
  new RegExp(
    `<!-- quickstart:${name} -->\\s*\`\`\`[a-z]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``,
  ),
);
if (!name || !match) {
  console.error(`No README "Quick start" box marked quickstart:${name}`);
  process.exit(1);
}

let lines = match[1].split(/\r?\n/);
const cloneFrom = options.indexOf("--clone-from");
if (cloneFrom >= 0) {
  const source = options[cloneFrom + 1];
  const clone =
    /^git clone https:\/\/github\.com\/choudharyprafful\/Biometric-Authentication\.git$/;
  if (!lines.some((l) => clone.test(l))) {
    console.error(`quickstart:${name} has no git clone line to redirect`);
    process.exit(1);
  }
  lines = lines.map((l) =>
    clone.test(l) ? `git clone "${source}" Biometric-Authentication` : l,
  );
}
if (options.includes("--cmd"))
  lines = lines.map((l) => (/^cd /.test(l) ? l : `call ${l}`));
console.log(lines.join("\n"));
