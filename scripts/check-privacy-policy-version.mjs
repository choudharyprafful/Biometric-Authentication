// Fails if the privacy policy text the web app shows, the version the mobile sign-up screen sends,
// and the version the API records disagree. The API records "this person was shown version X"; if
// the text changed without the version (or the other way round), that record would name text the
// person never saw.
//
//   node scripts/check-privacy-policy-version.mjs
import fs from "node:fs";

const read = (rel) =>
  fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
// Either quote style, so a formatter changing quotes can't break the check.
const versions = {
  "web text": /version:\s*["']([^"']+)["']/.exec(
    read("artifacts/secureai/src/lib/privacyPolicy.ts"),
  )?.[1],
  "mobile sign-up": /PRIVACY_POLICY_VERSION\s*=\s*["']([^"']+)["']/.exec(
    read("artifacts/mobile/src/config.ts"),
  )?.[1],
  API: /PRIVACY_POLICY_VERSION\s*=\s*["']([^"']+)["']/.exec(
    read("artifacts/api-server/src/lib/privacyPolicy.ts"),
  )?.[1],
};

const missing = Object.entries(versions).filter(([, v]) => !v);
if (missing.length) {
  console.error(
    `Could not find the version in: ${missing.map(([k]) => k).join(", ")}.`,
  );
  process.exit(1);
}
if (new Set(Object.values(versions)).size !== 1) {
  console.error(
    `Privacy policy versions differ: ${Object.entries(versions)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}. Change them together.`,
  );
  process.exit(1);
}
console.log(
  `Privacy policy version ${versions.API} matches in the web text, the mobile app and the API.`,
);
