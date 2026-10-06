// Runs before each commit (git uses .githooks once `pnpm install` has run .githooks/install.mjs):
// formats the staged files with Prettier, so what is committed is formatted. CI checks the same with
// `pnpm run format:check`, so a commit made without the hook still can't merge unformatted.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const root = git("rev-parse", "--show-toplevel").trim();

let prettier;
try {
  prettier = createRequire(path.join(root, "package.json"))("prettier");
} catch {
  console.warn(
    "pre-commit: Prettier isn't installed (run pnpm install), so the files weren't formatted. CI still checks them.",
  );
  process.exit(0);
}

const list = (output) => output.split("\0").filter(Boolean);
const staged = list(
  git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"),
);
const partlyStaged = new Set(list(git("diff", "--name-only", "-z")));
const ignorePath = [
  path.join(root, ".gitignore"),
  path.join(root, ".prettierignore"),
];

const formatted = [];
const blocked = [];
for (const rel of staged) {
  const file = path.join(root, rel);
  const info = await prettier.getFileInfo(file, { ignorePath });
  if (info.ignored || !info.inferredParser) continue;
  const options = { ...(await prettier.resolveConfig(file)), filepath: file };
  if (partlyStaged.has(rel)) {
    // Only part of this file is staged: check what will be committed and leave the working copy alone.
    if (!(await prettier.check(git("show", `:${rel}`), options)))
      blocked.push(rel);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  const output = await prettier.format(text, options);
  // On Windows git may check files out with CRLF line endings; that alone isn't a change to commit.
  if (output !== text.replace(/\r\n/g, "\n")) {
    fs.writeFileSync(file, output);
    formatted.push(rel);
  }
}

if (formatted.length) {
  git("add", "--", ...formatted);
  console.log(
    `pre-commit: formatted ${formatted.length} file(s) with Prettier: ${formatted.join(", ")}`,
  );
}
if (blocked.length) {
  console.error(
    `pre-commit: not formatted, and only partly staged: ${blocked.join(", ")}\n` +
      "Run pnpm exec prettier --write on them, stage them again, and commit.",
  );
  process.exit(1);
}
