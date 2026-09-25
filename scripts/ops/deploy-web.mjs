// Builds the web app and deploys it to Amplify Hosting (manual-deploy branch), then confirms the live
// site serves the new build through CloudFront.
//
//   node scripts/ops/deploy-web.mjs                 build, check, deploy, verify
//   node scripts/ops/deploy-web.mjs --package-only  build, check and zip; deploy nothing
//
// BASE_PATH is set here rather than on the command line: Git Bash rewrites a bare "/" into its own
// install path ("/Program Files/Git/"), which produces a build whose every asset 404s.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { directoryEntries, writeZip } from "./lib/zip.mjs";

const APP_ID = "d1cc0z06pe6l9z";
const BRANCH = "main";
const LIVE = "https://d2zb1uxt99m5ks.cloudfront.net";
const PACKAGE_ONLY = process.argv.includes("--package-only");

const root = fileURLToPath(new URL("../..", import.meta.url));
const dist = path.join(root, "artifacts", "secureai", "dist", "public");
const step = (msg) => console.log(`\n▸ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { throw new Error(msg); };
const aws = (args) => execSync(`aws ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const assetRefs = (html) => [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);

try {
  step("Building the web app");
  execSync("pnpm --filter @workspace/secureai run build", { cwd: root, stdio: "inherit", env: { ...process.env, PORT: "3000", BASE_PATH: "/" } });

  step("Checking the build");
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const refs = assetRefs(html);
  if (!refs.some((r) => r.startsWith("/assets/"))) fail("index.html references no /assets/ files — wrong base path?");
  for (const r of refs) if (!fs.existsSync(path.join(dist, r))) fail(`index.html references ${r}, which is not in the build`);
  ok(`index.html references ${refs.length} local files, all present at the site root`);
  const js = fs.readdirSync(path.join(dist, "assets")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(dist, "assets", f), "utf8")).join("\n");
  if (js.includes("Demo access")) fail("the development-only demo credentials hint is in the production bundle");
  ok("no development-only demo credentials in the bundle");
  for (const f of ["noise.svg", "models/tiny_face_detector_model-weights_manifest.json", "models/face_landmark_68_model-weights_manifest.json", "models/face_recognition_model-weights_manifest.json"]) {
    if (!fs.existsSync(path.join(dist, f))) fail(`${f} is missing from the build`);
  }
  ok("noise texture and face-model files present");

  step("Packaging");
  const entries = directoryEntries(dist);
  const zipFile = path.join(os.tmpdir(), `secureai-web-${Date.now()}.zip`);
  writeZip(zipFile, entries);
  ok(`${entries.length} files → ${zipFile} (${(fs.statSync(zipFile).size / 1e6).toFixed(1)} MB)`);
  if (PACKAGE_ONLY) {
    step(`--package-only: nothing deployed. The zip is kept at ${zipFile}.`);
  } else {
    step(`Deploying to Amplify (${APP_ID}/${BRANCH})`);
    const { jobId, zipUploadUrl } = JSON.parse(aws(`amplify create-deployment --app-id ${APP_ID} --branch-name ${BRANCH} --output json`));
    const put = await fetch(zipUploadUrl, { method: "PUT", body: fs.readFileSync(zipFile) });
    if (!put.ok) fail(`upload to Amplify failed (HTTP ${put.status})`);
    aws(`amplify start-deployment --app-id ${APP_ID} --branch-name ${BRANCH} --job-id ${jobId}`);
    ok(`job ${jobId} started`);
    let status = "PENDING";
    for (let i = 0; i < 60 && !["SUCCEED", "FAILED", "CANCELLED"].includes(status); i++) {
      await new Promise((r) => setTimeout(r, 10000));
      status = aws(`amplify get-job --app-id ${APP_ID} --branch-name ${BRANCH} --job-id ${jobId} --query "job.summary.status" --output text`);
    }
    if (status !== "SUCCEED") fail(`Amplify job ${jobId} ended as ${status} — check the Amplify console`);
    ok("Amplify reports the deployment succeeded");

    step("Confirming the live site serves this build");
    const liveHtml = await (await fetch(`${LIVE}/`, { cache: "no-store" })).text();
    const expected = refs.find((r) => r.endsWith(".js"));
    if (!liveHtml.includes(expected)) fail(`${LIVE}/ does not reference ${expected} yet — Amplify's CDN may still be serving the old copy; re-check in a few minutes`);
    const asset = await fetch(`${LIVE}${expected}`);
    if (!asset.ok) fail(`${LIVE}${expected} answered ${asset.status}`);
    ok(`${LIVE}/ serves ${expected}`);
    fs.rmSync(zipFile, { force: true });
  }
} catch (e) {
  console.error(`\n✗ Stopped: ${e.message}`);
  process.exitCode = 1;
}
