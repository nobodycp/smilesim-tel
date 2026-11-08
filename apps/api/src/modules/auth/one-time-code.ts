import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

// Sign-in codes sent by SMS or email (spec 2026-11-08-signin-methods).

export const CODE_TTL_SECONDS = 300;
export const CODE_TRIES = 5;
export const RESEND_SECONDS = 30;

export type PendingCode = { hash: string; tries: number; purpose: 'enroll' | 'challenge'; method: 'sms' | 'email' };

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Bound to the account, so a stored hash says nothing about another account's code. */
export const hashCode = (userId: string, code: string) => createHash('sha256').update(`${userId}:${code.trim()}`).digest('hex');

export function codeMatches(hash: string, userId: string, code: string): boolean {
  const given = Buffer.from(hashCode(userId, code), 'hex');
  const kept = Buffer.from(hash, 'hex');
  return given.length === kept.length && timingSafeEqual(given, kept);
}

/** «•••••4567» for a phone, «a•••@example.com» for an email. */
export function maskContact(value: string, method: 'sms' | 'email'): string {
  if (method === 'email') {
    const [name = '', domain = ''] = value.split('@');
    return `${name.slice(0, 1)}•••@${domain}`;
  }
  const digits = value.replace(/\D/g, '');
  return `•••••${digits.slice(-4)}`;
}
