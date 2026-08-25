import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Resolves the AES-256 key from FILE_ENCRYPTION_KEY (64 hex chars = 32 bytes).
 * Falls back to a key derived from SESSION_SECRET for local dev, mirroring
 * the dev fallback already used for the session secret in app.ts — never
 * used once FILE_ENCRYPTION_KEY is set in a real deployment.
 */
function resolveKey(): Buffer {
  const configured = process.env["FILE_ENCRYPTION_KEY"];
  if (configured) {
    const key = Buffer.from(configured, "hex");
    if (key.length !== 32) {
      throw new Error("FILE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
    }
    return key;
  }
  return crypto.scryptSync(
    process.env["SESSION_SECRET"] || "fallback-dev-secret-change-in-prod",
    "secureai-file-encryption",
    32,
  );
}

export interface EncryptedFile {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptFile(plaintext: Buffer): EncryptedFile {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, resolveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptFile(file: EncryptedFile): Buffer {
  const decipher = crypto.createDecipheriv(ALGORITHM, resolveKey(), Buffer.from(file.iv, "base64"));
  decipher.setAuthTag(Buffer.from(file.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(file.ciphertext, "base64")), decipher.final()]);
}

/** Convenience wrappers for encrypting a JSON-serializable value (e.g. a
 *  face descriptor array) rather than an arbitrary byte buffer. */
export function encryptJson(value: unknown): EncryptedFile {
  return encryptFile(Buffer.from(JSON.stringify(value), "utf8"));
}

export function decryptJson<T>(file: EncryptedFile): T {
  return JSON.parse(decryptFile(file).toString("utf8")) as T;
}
