import type { CookieOptions, Request } from 'express';

/** Reads one cookie, from cookie-parser when it ran, else from the raw header. */
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

/** What an office call is made with: the session, and the home session while an account is entered. */
export function gateOf(req: Request) {
  return { sessionId: readCookie(req, 'sid'), homeId: readCookie(req, 'home') };
}

/** The options every office cookie (`sid`, `home`) is written with. */
export function cookieBase(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    sameSite: 'lax',
    path: '/',
  };
}
