import { createHash, randomBytes } from 'node:crypto';

// The session cookie carries a token; the database and Redis keep only its hash (review 2026-11-10, S6). A
// session's `id` is its public handle (list, revoke, the operator on a log line) and opens nothing.

/** A new cookie value: 32 random bytes, base64url. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What is stored for a token: its SHA-256, hex. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
