import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config';

// Secrets that must be read back (an authenticator's shared secret) are sealed before they are stored, so a copy
// of the database alone does not hand them over (review 2026-11-10, S12). AES-256-GCM with the key in
// `SECRETS_KEY` (32 bytes, base64). Without a key nothing is sealed and values stay as written.

const PREFIX = 'v1:';
/** The sizes `seal` writes: a 96-bit nonce and the full 128-bit authentication tag. `open` accepts no other. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

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
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
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
  const parts = stored.slice(PREFIX.length).split(':');
  // Exactly the three parts `seal` writes: anything shorter or longer is not a value this box sealed.
  if (parts.length !== 3) throw new Error('A sealed secret cannot be opened: it is not in the sealed form');
  const [iv, tag, body] = parts.map((part) => Buffer.from(part, 'base64url'));
  // The cipher itself takes a tag as short as 4 bytes when its length is not fixed, which would let a stored
  // value be checked against a fraction of its tag. Only the full tag `seal` writes is a tag.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('A sealed secret cannot be opened: it is not in the sealed form');
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

/** Why a stored value could not be read: there is no key to open it with, or it does not open (another key, damaged, not what it claims to be). */
export type Unreadable = 'no-key' | 'unreadable';

/**
 * The plain value, without ever throwing: `{ value }` for a value that was never sealed (as it is) and for a
 * sealed one that opens; `{ unreadable }` for a sealed one that does not. For values that are shown, where one
 * unreadable row must not take a whole answer down. The reason says nothing about the value, and neither the
 * stored text nor the error of the cipher is kept.
 */
export function tryOpen(stored: string): { value: string } | { unreadable: Unreadable } {
  if (!isSealed(stored)) return { value: stored };
  if (!secretsKey()) return { unreadable: 'no-key' };
  try {
    return { value: open(stored) };
  } catch {
    return { unreadable: 'unreadable' };
  }
}
