/**
 * Verifies the encryption keyring in lib/fileEncryption.ts (docs/04 R-DP-3): that a value keeps
 * decrypting through every step of moving from the SESSION_SECRET-derived key to an independent
 * one and then rotating that, and that the failure cases fail loudly rather than silently.
 *
 * The failures that matter are silent ones: a rotation that strands data written under the old
 * key, a value quietly encrypted under the wrong key, or SESSION_SECRET still able to open data
 * after the move away from it.
 *
 * Run: pnpm --filter @workspace/api-server run verify:keyring
 * Needs no server or database.
 */
import crypto from "node:crypto";

const enc = await import("./fileEncryption");

let failures = 0;
function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  if (!pass) failures += 1;
}

function throws(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

const VARS = [
  "SESSION_SECRET",
  "FILE_ENCRYPTION_KEY",
  "FILE_ENCRYPTION_KEY_ID",
  "FILE_ENCRYPTION_PREVIOUS_KEYS",
] as const;
function setEnv(values: Partial<Record<(typeof VARS)[number], string>>): void {
  for (const v of VARS) {
    if (values[v] === undefined) delete process.env[v];
    else process.env[v] = values[v];
  }
}

const hex = () => crypto.randomBytes(32).toString("hex");
const K1 = hex();
const K2 = hex();
const SECRET = "session-secret-for-verify";
const plain = Buffer.from("face template 0.12,-0.04,0.33", "utf8");
const open = (f: ReturnType<typeof enc.encryptFile>) =>
  enc.decryptFile(f).equals(plain);

console.log("\n[1] Before an independent key is set");
setEnv({ SESSION_SECRET: SECRET });
const legacy = enc.encryptFile(plain);
check(
  "writes under the SESSION_SECRET-derived key, unprefixed as before",
  enc.currentKeyId() === "legacy" &&
    !legacy.iv.includes(":") &&
    !enc.hasIndependentKey(),
  `currentKeyId=${enc.currentKeyId()}, iv=${legacy.iv}`,
);
check("reads it back", open(legacy), "decrypts to the original");

console.log("\n[2] FILE_ENCRYPTION_KEY set (the move to an independent key)");
setEnv({ SESSION_SECRET: SECRET, FILE_ENCRYPTION_KEY: K1 });
const k1 = enc.encryptFile(plain);
check(
  "new data is written under k1, and says so",
  enc.currentKeyId() === "k1" && k1.iv.startsWith("k1:"),
  `iv=${k1.iv}`,
);
check(
  "data written before the move still reads",
  open(legacy),
  "legacy value decrypts",
);
check(
  "the older value is flagged for re-encryption, the new one isn't",
  enc.needsReencryption(legacy) && !enc.needsReencryption(k1),
  `legacy=${enc.needsReencryption(legacy)}, k1=${enc.needsReencryption(k1)}`,
);
const moved = enc.reencrypt(legacy);
check(
  "re-encrypting moves it onto k1 without changing it",
  moved.iv.startsWith("k1:") && open(moved),
  `iv=${moved.iv}`,
);

console.log("\n[3] SESSION_SECRET rotated after the move");
setEnv({ SESSION_SECRET: "a-new-session-secret", FILE_ENCRYPTION_KEY: K1 });
check("values on k1 are unaffected", open(k1) && open(moved), "both decrypt");
check(
  "SESSION_SECRET no longer opens them: a legacy value now fails",
  throws(() => enc.decryptFile(legacy)) !== null,
  "legacy value no longer decrypts once its derivation secret changes",
);

console.log("\n[4] Rotating k1 to k2, keeping k1 readable");
setEnv({
  SESSION_SECRET: SECRET,
  FILE_ENCRYPTION_KEY: K2,
  FILE_ENCRYPTION_KEY_ID: "k2",
  FILE_ENCRYPTION_PREVIOUS_KEYS: `k1:${K1}`,
});
const k2 = enc.encryptFile(plain);
check(
  "new data goes under k2",
  k2.iv.startsWith("k2:") && open(k2),
  `iv=${k2.iv}`,
);
check(
  "k1 values still read, and are flagged",
  open(k1) && enc.needsReencryption(k1),
  "k1 decrypts via FILE_ENCRYPTION_PREVIOUS_KEYS",
);

console.log("\n[5] Failures are loud");
setEnv({
  SESSION_SECRET: SECRET,
  FILE_ENCRYPTION_KEY: K2,
  FILE_ENCRYPTION_KEY_ID: "k2",
});
const missing = throws(() => enc.decryptFile(k1));
check(
  "a value on a key that has been dropped names that key",
  missing?.includes('"k1"') ?? false,
  missing ?? "no error",
);
const tampered = {
  ...k2,
  ciphertext: Buffer.from(
    Buffer.from(k2.ciphertext, "base64").map((b, i) => (i === 0 ? b ^ 1 : b)),
  ).toString("base64"),
};
check(
  "a changed byte is rejected (GCM authentication)",
  throws(() => enc.decryptFile(tampered)) !== null,
  "tampered ciphertext refused",
);
const relabelled = { ...k2, iv: `k1:${k2.iv.slice(3)}` };
setEnv({
  SESSION_SECRET: SECRET,
  FILE_ENCRYPTION_KEY: K2,
  FILE_ENCRYPTION_KEY_ID: "k2",
  FILE_ENCRYPTION_PREVIOUS_KEYS: `k1:${K1}`,
});
check(
  "a value relabelled with another key's ID is rejected",
  throws(() => enc.decryptFile(relabelled)) !== null,
  "k2 ciphertext under a k1 label fails authentication",
);
for (const [label, env] of [
  ["a short key", { FILE_ENCRYPTION_KEY: "abcd" }],
  ["a non-hex key", { FILE_ENCRYPTION_KEY: "z".repeat(64) }],
  [
    'the ID "legacy"',
    { FILE_ENCRYPTION_KEY: K1, FILE_ENCRYPTION_KEY_ID: "legacy" },
  ],
  [
    "an ID with a colon",
    { FILE_ENCRYPTION_KEY: K1, FILE_ENCRYPTION_KEY_ID: "k:1" },
  ],
  [
    "a new key reusing an old key's ID",
    {
      FILE_ENCRYPTION_KEY: K2,
      FILE_ENCRYPTION_KEY_ID: "k1",
      FILE_ENCRYPTION_PREVIOUS_KEYS: `k1:${K1}`,
    },
  ],
] as const) {
  setEnv({ SESSION_SECRET: SECRET, ...env });
  const err = throws(() => enc.encryptFile(plain));
  check(`refuses ${label}`, err !== null, err ?? "accepted");
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
