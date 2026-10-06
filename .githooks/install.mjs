// Points git at .githooks so the pre-commit formatting step runs (root package.json "prepare", which
// pnpm runs on install). Does nothing outside a git checkout, for example when installed from an archive.
import { execFileSync } from "node:child_process";

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

try {
  git("rev-parse", "--git-dir");
  let current = "";
  try {
    current = git("config", "--local", "core.hooksPath");
  } catch {
    // not set yet
  }
  if (current !== ".githooks")
    git("config", "--local", "core.hooksPath", ".githooks");
} catch {
  // not a git checkout, or git isn't installed: nothing to set up
}
