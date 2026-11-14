import type { CookieOptions, Request } from 'express';
import { env } from '../../config';

// The session cookies, in one place: how they are read and the options they are written with.

/** What a call is made with: the session, and the owner's own session kept aside while an account is entered. */
export type Gate = { sessionId?: string; homeId?: string };

/** One cookie, from cookie-parser when it ran, else from the raw header. */
export function readCookie(req: Request, name: string): string | undefined {
  const parsed = (req as Request & { cookies?: Record<string, unknown> }).cookies?.[name];
  if (typeof parsed === 'string' && parsed) return parsed;
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim()) || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The session cookies of a request. `home` only says where `leave` goes back to; it names nobody (rule 3.5). */
export function gateOf(req: Request): Gate {
  return { sessionId: readCookie(req, 'sid'), homeId: readCookie(req, 'home') };
}

/** The options every session cookie (`sid`, `home`) is written with. */
export function cookieBase(): CookieOptions {
  return {
    httpOnly: true,
    secure: env('COOKIE_SECURE') === 'true',
    domain: env('COOKIE_DOMAIN'),
    sameSite: 'lax',
    path: '/',
  };
}
