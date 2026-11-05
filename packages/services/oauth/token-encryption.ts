import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * AES-256-GCM encryption for tokens at rest.
 * Format: `v1.<iv>.<authTag>.<ciphertext>` (base64url parts, 12-byte IV).
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string, key: Buffer): string {
  const [version, iv, tag, ciphertext, ...rest] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new Error("Unrecognised encrypted payload");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** Constant-time comparison of a raw value against a stored sha256(). */
export function matchesHash(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(sha256(value));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
