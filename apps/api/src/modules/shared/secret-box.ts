import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config';

// Secrets that must be read back (an authenticator's shared secret) are sealed before they are stored, so a copy
// of the database alone does not hand them over (review 2026-11-10, S12). AES-256-GCM with the key in
// `SECRETS_KEY` (32 bytes, base64). Without a key nothing is sealed and values stay as written.

const PREFIX = 'v1:';

/** The key, or null when `SECRETS_KEY` is unset or is not 32 bytes of base64. */
export function secretsKey(): Buffer | null {
  const raw = env('SECRETS_KEY');
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** `v1:<iv>:<tag>:<ciphertext>` in base64url; the value itself when there is no key or it is already sealed. */
export function seal(plain: string): string {
  const key = secretsKey();
  if (!key || isSealed(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${[iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join(':')}`;
}

/**
 * The plain value. One that was never sealed is returned as it is, so rows written before sealing still read.
 * A sealed value that cannot be opened (no key, another key, tampered) throws: it must never be read as a secret.
 */
export function open(stored: string): string {
  if (!isSealed(stored)) return stored;
  const key = secretsKey();
  if (!key) throw new Error('A sealed secret cannot be opened: SECRETS_KEY is not set');
  const [iv, tag, body] = stored.slice(PREFIX.length).split(':').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
