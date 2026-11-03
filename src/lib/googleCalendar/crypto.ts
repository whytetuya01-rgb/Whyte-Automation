import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts Google tokens at rest: AES-256-GCM with a random 96-bit IV per value and an "additional authenticated data"
 * label, so a sealed value cannot be moved to another record or purpose (it fails to open). Stored as
 * `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url). `keyId` is the first 8 hex characters of the key's SHA-256, which lets
 * a rotated key still open older values: set the new key in GOOGLE_CALENDAR_TOKEN_KEY and keep the old one in
 * GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS until every connection has been re-sealed (any refresh does it).
 */

export class TokenCryptoError extends Error {}

function loadKey(base64: string | undefined): { id: string; key: Buffer } | null {
  if (!base64?.trim()) return null;
  const key = Buffer.from(base64.trim(), "base64");
  if (key.length !== 32) return null;
  return { id: createHash("sha256").update(key).digest("hex").slice(0, 8), key };
}

function keys(env: NodeJS.ProcessEnv) {
  const current = loadKey(env.GOOGLE_CALENDAR_TOKEN_KEY);
  if (!current) throw new TokenCryptoError("GOOGLE_CALENDAR_TOKEN_KEY is not set to 32 base64-encoded bytes.");
  return { current, previous: loadKey(env.GOOGLE_CALENDAR_TOKEN_KEY_PREVIOUS) };
}

export function sealToken(plain: string, aad: string, env: NodeJS.ProcessEnv = process.env): string {
  const { current } = keys(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", current.id, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openToken(sealed: string, aad: string, env: NodeJS.ProcessEnv = process.env): string {
  const [version, keyId, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !keyId || !iv || !tag || data === undefined) throw new TokenCryptoError("Unrecognised sealed value.");
  const { current, previous } = keys(env);
  const key = [current, previous].find((candidate) => candidate?.id === keyId);
  if (!key) throw new TokenCryptoError("No key matches this sealed value (was the key rotated without keeping the old one?).");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCryptoError("The sealed value could not be opened (wrong record, wrong key or tampered).");
  }
}

/** True when the value was sealed with an older key and should be sealed again with the current one. */
export function needsResealing(sealed: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return sealed.split(".")[1] !== keys(env).current.id;
}

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");
