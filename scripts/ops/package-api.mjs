// Builds the Elastic Beanstalk source bundle for artifacts/api-server: the esbuild output, a minimal
// package.json and Procfile, the RDS CA bundle that DATABASE_URL's sslrootcert points at, the
// platform hooks for ClamAV and the origin certificate (each as both a deployment hook and a
// configuration hook, executable), and the nginx HTTPS listener for CloudFront with the pinned
// certbot it needs (docs/04 R-SC-6).
//
//   pnpm --filter @workspace/api-server run build
//   node scripts/ops/package-api.mjs <out.zip>
import fs from "node:fs";
import { writeZip } from "./lib/zip.mjs";

const apiRoot = new URL("../../artifacts/api-server/", import.meta.url);
const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/ops/package-api.mjs <out.zip>");

const entries = [];
const distFiles = fs
  .readdirSync(new URL("dist/", apiRoot))
  .filter((f) => f.endsWith(".mjs"))
  .sort();
if (!distFiles.includes("index.mjs"))
  throw new Error("dist/index.mjs missing — run the api-server build first");
for (const f of distFiles)
  entries.push([`dist/${f}`, fs.readFileSync(new URL(`dist/${f}`, apiRoot))]);
entries.push(
  [
    "package.json",
    Buffer.from(
      `${JSON.stringify({ name: "secureai-api", version: "1.0.0", private: true, scripts: { start: "node dist/index.mjs" }, engines: { node: "24.x" } }, null, 2)}\n`,
    ),
  ],
  ["Procfile", Buffer.from("web: node dist/index.mjs\n")],
  [
    "certs/rds-global-bundle.pem",
    fs.readFileSync(new URL("certs/rds-global-bundle.pem", apiRoot)),
  ],
);

// Elastic Beanstalk runs hooks only when they are executable, and a Windows checkout could carry CRLF
// line endings that break the shebang line.
const platformFile = (path) => {
  const content = fs.readFileSync(new URL(`.platform/${path}`, apiRoot));
  if (content.includes(0x0d))
    throw new Error(`.platform/${path} has CRLF line endings; it must be LF`);
  return content;
};
// Each hook also runs on configuration changes, so setting its environment property alone applies
// it: CLAMD_HOST for ClamAV; ORIGIN_TLS_HOSTNAME and ORIGIN_HTTP for the origin certificate.
for (const hook of [
  "prebuild/10_clamav.sh",
  "prebuild/20_origin_tls_prepare.sh",
  "postdeploy/20_origin_tls.sh",
]) {
  const content = platformFile(`hooks/${hook}`);
  entries.push(
    [`.platform/hooks/${hook}`, content, 0o755],
    [`.platform/confighooks/${hook}`, content, 0o755],
  );
}
for (const path of [
  "nginx/conf.d/origin-tls.conf",
  "nginx/conf.d/elasticbeanstalk/00_application.conf",
  "nginx/conf.d/elasticbeanstalk/10_acme_challenge.conf",
  "origin-tls/certbot-requirements.txt",
])
  entries.push([`.platform/${path}`, platformFile(path)]);

writeZip(out, entries);
console.log(`wrote ${out}: ${entries.map(([n]) => n).join(", ")}`);
