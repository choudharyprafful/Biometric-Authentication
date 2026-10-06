import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Keys (docs/04 R-DP-3). Everything encrypted at rest — face templates, uploads, payment tokens —
 * records which key encrypted it, so the key can be replaced without making stored data
 * unreadable:
 *
 *   FILE_ENCRYPTION_KEY             the current key, 64 hex characters (32 bytes)
 *   FILE_ENCRYPTION_KEY_ID          its name, e.g. "k1" (default "k1"); stored with each value
 *   FILE_ENCRYPTION_PREVIOUS_KEYS   earlier keys still needed for reading, "k1:<hex>,k0:<hex>"
 *
 * The key ID is stored as a prefix of the IV column ("k1:<base64 iv>"); base64 never contains
 * ":", so a value without a prefix is unambiguous. Such values were written before this keyring
 * existed, under the "legacy" key: derived from SESSION_SECRET with scrypt, which is still what
 * encrypts new data when FILE_ENCRYPTION_KEY is unset (local development). The legacy key stays
 * readable so older values keep working; lib/keyRotation.ts re-encrypts them, and anything on a
 * previous key, under the current one in the background.
 */
export const LEGACY_KEY_ID = "legacy";
const KEY_ID_PATTERN = /^[a-z0-9]{1,16}$/;

interface Keyring {
  currentId: string;
  keys: Map<string, Buffer>;
}

function parseHexKey(hex: string, what: string): Buffer {
  const key = Buffer.from(hex.trim(), "hex");
  if (key.length !== 32 || !/^[0-9a-fA-F]{64}$/.test(hex.trim())) {
    throw new Error(`${what} must be a 64-character hex string (32 bytes)`);
  }
  return key;
}

function checkKeyId(id: string, what: string): string {
  if (!KEY_ID_PATTERN.test(id) || id === LEGACY_KEY_ID) {
    throw new Error(
      `${what} must be 1-16 lowercase letters or digits, and not "${LEGACY_KEY_ID}"`,
    );
  }
  return id;
}

function buildKeyring(env: {
  sessionSecret?: string;
  key?: string;
  keyId?: string;
  previous?: string;
}): Keyring {
  const keys = new Map<string, Buffer>();
  keys.set(
    LEGACY_KEY_ID,
    crypto.scryptSync(
      env.sessionSecret || "fallback-dev-secret-change-in-prod",
      "secureai-file-encryption",
      32,
    ),
  );
  for (const entry of (env.previous ?? "").split(",")) {
    if (!entry.trim()) continue;
    const [id, hex] = entry.split(":");
    keys.set(
      checkKeyId((id ?? "").trim(), "A FILE_ENCRYPTION_PREVIOUS_KEYS key ID"),
      parseHexKey(hex ?? "", `FILE_ENCRYPTION_PREVIOUS_KEYS entry "${id}"`),
    );
  }
  if (!env.key) return { currentId: LEGACY_KEY_ID, keys };
  const currentId = checkKeyId(
    (env.keyId || "k1").trim(),
    "FILE_ENCRYPTION_KEY_ID",
  );
  const current = parseHexKey(env.key, "FILE_ENCRYPTION_KEY");
  const clash = keys.get(currentId);
  if (clash && !clash.equals(current)) {
    throw new Error(
      `FILE_ENCRYPTION_PREVIOUS_KEYS has a different key under the current ID "${currentId}"; give the new key a new ID`,
    );
  }
  keys.set(currentId, current);
  return { currentId, keys };
}

// Built once per distinct configuration: scrypt is deliberately slow, and every request that
// touches a face template or upload needs the keys.
let cached: { signature: string; keyring: Keyring } | null = null;

function keyring(): Keyring {
  const env = {
    sessionSecret: process.env["SESSION_SECRET"],
    key: process.env["FILE_ENCRYPTION_KEY"],
    keyId: process.env["FILE_ENCRYPTION_KEY_ID"],
    previous: process.env["FILE_ENCRYPTION_PREVIOUS_KEYS"],
  };
  const signature = JSON.stringify(env);
  if (cached?.signature !== signature) {
    cached = { signature, keyring: buildKeyring(env) };
  }
  return cached.keyring;
}

/** The key new data is encrypted with ("legacy" when FILE_ENCRYPTION_KEY is unset). */
export function currentKeyId(): string {
  return keyring().currentId;
}

/** Whether the encryption key is its own secret rather than derived from SESSION_SECRET. */
export function hasIndependentKey(): boolean {
  return currentKeyId() !== LEGACY_KEY_ID;
}

export interface EncryptedFile {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/** Which key encrypted a stored value. */
export function keyIdOf(iv: string): string {
  const colon = iv.indexOf(":");
  return colon === -1 ? LEGACY_KEY_ID : iv.slice(0, colon);
}

export function needsReencryption(file: Pick<EncryptedFile, "iv">): boolean {
  return keyIdOf(file.iv) !== currentKeyId();
}

export function encryptFile(plaintext: Buffer): EncryptedFile {
  const { currentId, keys } = keyring();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keys.get(currentId)!, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const ivText = iv.toString("base64");
  return {
    ciphertext: encrypted.toString("base64"),
    iv: currentId === LEGACY_KEY_ID ? ivText : `${currentId}:${ivText}`,
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptFile(file: EncryptedFile): Buffer {
  const keyId = keyIdOf(file.iv);
  const key = keyring().keys.get(keyId);
  if (!key) {
    throw new Error(
      `This value was encrypted with key "${keyId}", which is not configured (FILE_ENCRYPTION_KEY or FILE_ENCRYPTION_PREVIOUS_KEYS)`,
    );
  }
  const ivText =
    keyId === LEGACY_KEY_ID ? file.iv : file.iv.slice(keyId.length + 1);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivText, "base64"),
    { authTagLength: 16 },
  );
  decipher.setAuthTag(Buffer.from(file.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(file.ciphertext, "base64")),
    decipher.final(),
  ]);
}

/** Decrypts with whichever key wrote the value and encrypts again under the current key. */
export function reencrypt(file: EncryptedFile): EncryptedFile {
  return encryptFile(decryptFile(file));
}

/** Convenience wrappers for encrypting a JSON-serializable value (e.g. a
 *  face descriptor array) rather than an arbitrary byte buffer. */
export function encryptJson(value: unknown): EncryptedFile {
  return encryptFile(Buffer.from(JSON.stringify(value), "utf8"));
}

export function decryptJson<T>(file: EncryptedFile): T {
  return JSON.parse(decryptFile(file).toString("utf8")) as T;
}
