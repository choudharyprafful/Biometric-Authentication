// Builds the Elastic Beanstalk source bundle for artifacts/api-server: the esbuild output, a minimal
// package.json and Procfile, and the RDS CA bundle that DATABASE_URL's sslrootcert points at.
//
//   pnpm --filter @workspace/api-server run build
//   node scripts/ops/package-api.mjs <out.zip>
import fs from "node:fs";
import { writeZip } from "./lib/zip.mjs";

const apiRoot = new URL("../../artifacts/api-server/", import.meta.url);
const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/ops/package-api.mjs <out.zip>");

const entries = [];
const distFiles = fs.readdirSync(new URL("dist/", apiRoot)).filter((f) => f.endsWith(".mjs")).sort();
if (!distFiles.includes("index.mjs")) throw new Error("dist/index.mjs missing — run the api-server build first");
for (const f of distFiles) entries.push([`dist/${f}`, fs.readFileSync(new URL(`dist/${f}`, apiRoot))]);
entries.push(
  ["package.json", Buffer.from(`${JSON.stringify({ name: "secureai-api", version: "1.0.0", private: true, scripts: { start: "node dist/index.mjs" }, engines: { node: "24.x" } }, null, 2)}\n`)],
  ["Procfile", Buffer.from("web: node dist/index.mjs\n")],
  ["certs/rds-global-bundle.pem", fs.readFileSync(new URL("certs/rds-global-bundle.pem", apiRoot))],
);

writeZip(out, entries);
console.log(`wrote ${out}: ${entries.map(([n]) => n).join(", ")}`);
