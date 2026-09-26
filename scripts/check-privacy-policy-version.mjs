// Fails if the privacy policy text the web app shows and the version the API records disagree.
// The API records "this person was shown version X"; if the text changed without the version (or the
// other way round), that record would name text the person never saw.
//
//   node scripts/check-privacy-policy-version.mjs
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const web = /version:\s*'([^']+)'/.exec(read("artifacts/secureai/src/lib/privacyPolicy.ts"))?.[1];
const api = /PRIVACY_POLICY_VERSION\s*=\s*"([^"]+)"/.exec(read("artifacts/api-server/src/lib/privacyPolicy.ts"))?.[1];

if (!web || !api) {
  console.error(`Could not find both versions (web: ${web ?? "missing"}, api: ${api ?? "missing"}).`);
  process.exit(1);
}
if (web !== api) {
  console.error(`Privacy policy versions differ: web text is ${web}, API records ${api}. Change both together.`);
  process.exit(1);
}
console.log(`Privacy policy version ${web} matches in the web text and the API.`);
