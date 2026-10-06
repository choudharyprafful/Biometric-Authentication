// Builds the web app and deploys it to Amplify Hosting (manual-deploy branch), then confirms the live
// site serves the new build through CloudFront, with the security headers from
// web-security-headers.mjs (set as the Amplify app's custom headers before deploying).
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
import {
  WEB_SECURITY_HEADERS,
  amplifyCustomHeadersYaml,
} from "./web-security-headers.mjs";

const APP_ID = "d1cc0z06pe6l9z";
const BRANCH = "main";
const LIVE = "https://d2zb1uxt99m5ks.cloudfront.net";
const PACKAGE_ONLY = process.argv.includes("--package-only");

const root = fileURLToPath(new URL("../..", import.meta.url));
const dist = path.join(root, "artifacts", "secureai", "dist", "public");
const step = (msg) => console.log(`\n▸ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  throw new Error(msg);
};
const aws = (args) =>
  execSync(`aws ${args}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const assetRefs = (html) =>
  [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);

try {
  step("Building the web app");
  execSync("pnpm --filter @workspace/secureai run build", {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: "3000",
      BASE_PATH: "/",
      VITE_CANONICAL_ORIGIN: LIVE,
    },
  });

  step("Checking the build");
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const refs = assetRefs(html);
  if (!refs.some((r) => r.startsWith("/assets/")))
    fail("index.html references no /assets/ files — wrong base path?");
  for (const r of refs)
    if (!fs.existsSync(path.join(dist, r)))
      fail(`index.html references ${r}, which is not in the build`);
  ok(
    `index.html references ${refs.length} local files, all present at the site root`,
  );
  const js = fs
    .readdirSync(path.join(dist, "assets"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(dist, "assets", f), "utf8"))
    .join("\n");
  if (js.includes("Demo access"))
    fail(
      "the development-only demo credentials hint is in the production bundle",
    );
  ok("no development-only demo credentials in the bundle");
  if (!js.includes(LIVE))
    fail(
      `the bundle does not contain ${LIVE}, so amplifyapp.com visitors would not be forwarded to it`,
    );
  ok(`amplifyapp.com visitors are forwarded to ${LIVE}`);
  for (const f of [
    "noise.svg",
    "models/tiny_face_detector_model-weights_manifest.json",
    "models/face_landmark_68_model-weights_manifest.json",
    "models/face_recognition_model-weights_manifest.json",
  ]) {
    if (!fs.existsSync(path.join(dist, f)))
      fail(`${f} is missing from the build`);
  }
  ok("noise texture and face-model files present");
  const css = fs
    .readdirSync(path.join(dist, "assets"))
    .filter((f) => f.endsWith(".css"))
    .map((f) => fs.readFileSync(path.join(dist, "assets", f), "utf8"))
    .join("\n");
  // The Content-Security-Policy only allows this site's own origin; anything fetched from elsewhere
  // would be blocked on the live site.
  if (/fonts\.(googleapis|gstatic)\.com/.test(html + css))
    fail(
      "the build loads fonts from Google, which the Content-Security-Policy blocks; bundle them (@fontsource)",
    );
  if (/url\(\s*["']?data:font/.test(css))
    fail(
      "the build inlines fonts as data: URIs, which the CSP (font-src 'self') blocks; see assetsInlineLimit in vite.config.ts",
    );
  ok(
    "no third-party or inlined fonts (the CSP allows only files from this site)",
  );

  step("Packaging");
  const entries = directoryEntries(dist);
  const zipFile = path.join(os.tmpdir(), `secureai-web-${Date.now()}.zip`);
  writeZip(zipFile, entries);
  ok(
    `${entries.length} files → ${zipFile} (${(fs.statSync(zipFile).size / 1e6).toFixed(1)} MB)`,
  );
  if (PACKAGE_ONLY) {
    step(`--package-only: nothing deployed. The zip is kept at ${zipFile}.`);
  } else {
    step("Security headers on the Amplify app");
    const wanted = amplifyCustomHeadersYaml();
    const current = aws(
      `amplify get-app --app-id ${APP_ID} --query "app.customHeaders" --output text`,
    );
    if (current.trim() === wanted.trim()) {
      ok("already set");
    } else {
      // Through a JSON file: the multi-line YAML doesn't survive command-line quoting on Windows.
      const input = path.join(
        os.tmpdir(),
        `secureai-headers-${Date.now()}.json`,
      );
      fs.writeFileSync(
        input,
        JSON.stringify({ appId: APP_ID, customHeaders: wanted }),
      );
      try {
        aws(
          `amplify update-app --cli-input-json "file://${input.replaceAll("\\", "/")}"`,
        );
      } finally {
        fs.rmSync(input, { force: true });
      }
      ok(
        `set ${Object.keys(WEB_SECURITY_HEADERS).length} headers (they take effect with this deployment)`,
      );
    }

    step(`Deploying to Amplify (${APP_ID}/${BRANCH})`);
    const { jobId, zipUploadUrl } = JSON.parse(
      aws(
        `amplify create-deployment --app-id ${APP_ID} --branch-name ${BRANCH} --output json`,
      ),
    );
    const put = await fetch(zipUploadUrl, {
      method: "PUT",
      body: fs.readFileSync(zipFile),
    });
    if (!put.ok) fail(`upload to Amplify failed (HTTP ${put.status})`);
    aws(
      `amplify start-deployment --app-id ${APP_ID} --branch-name ${BRANCH} --job-id ${jobId}`,
    );
    ok(`job ${jobId} started`);
    let status = "PENDING";
    for (
      let i = 0;
      i < 60 && !["SUCCEED", "FAILED", "CANCELLED"].includes(status);
      i++
    ) {
      await new Promise((r) => setTimeout(r, 10000));
      status = aws(
        `amplify get-job --app-id ${APP_ID} --branch-name ${BRANCH} --job-id ${jobId} --query "job.summary.status" --output text`,
      );
    }
    if (status !== "SUCCEED")
      fail(
        `Amplify job ${jobId} ended as ${status} — check the Amplify console`,
      );
    ok("Amplify reports the deployment succeeded");

    step("Confirming the live site serves this build");
    const liveHtml = await (
      await fetch(`${LIVE}/`, { cache: "no-store" })
    ).text();
    const expected = refs.find((r) => r.endsWith(".js"));
    if (!liveHtml.includes(expected))
      fail(
        `${LIVE}/ does not reference ${expected} yet — Amplify's CDN may still be serving the old copy; re-check in a few minutes`,
      );
    const asset = await fetch(`${LIVE}${expected}`);
    if (!asset.ok) fail(`${LIVE}${expected} answered ${asset.status}`);
    ok(`${LIVE}/ serves ${expected}`);

    step("Confirming the live pages carry the security headers");
    const live = await fetch(`${LIVE}/privacy`, { cache: "no-store" });
    const missing = Object.entries(WEB_SECURITY_HEADERS).filter(
      ([name, value]) => live.headers.get(name) !== value,
    );
    if (missing.length)
      fail(
        `${LIVE}/privacy is missing or has a different ${missing.map(([n]) => n).join(", ")}. CloudFront may still hold the old copy; re-check in a few minutes`,
      );
    ok(
      `all ${Object.keys(WEB_SECURITY_HEADERS).length} present, including the Content-Security-Policy`,
    );
    fs.rmSync(zipFile, { force: true });
  }
} catch (e) {
  console.error(`\n✗ Stopped: ${e.message}`);
  process.exitCode = 1;
}
