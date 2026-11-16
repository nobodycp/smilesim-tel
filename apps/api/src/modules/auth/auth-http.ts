import type { Request, Response } from 'express';
import { cookieBase, expectedLayer, readCookie } from '../platform';
import type { Failure } from './auth.service';
import { SESSION_COOKIE_SECONDS } from './sessions';

// What the three controllers of `/auth` read of a request and write of an answer (slice R.A). They have no
// interceptor: each service checks the session it is handed, and the routes record through `AuthRecords`.

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie('sid', sessionId, { ...cookieBase(), maxAge: SESSION_COOKIE_SECONDS * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie('sid', cookieBase());
}

export const sessionIdOf = (req: Request) => readCookie(req, 'sid');

export function metaOf(req: Request) {
  return { userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' };
}

export function originOf(req: Request): string | undefined {
  return typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
}

export function doorOf(req: Request) {
  const header = req.headers['x-door'];
  return expectedLayer({ origin: originOf(req), door: typeof header === 'string' ? header : undefined });
}

/** A refusal's status and body. */
export function failWith(res: Response, failure: Failure) {
  res.status(failure.status);
  return { message: failure.message, code: failure.code };
}

/** A route's answer: the refusal as it is, or what `body` makes of the result. */
export function answer<R extends Failure | { kind: 'ok' }, B>(res: Response, result: R, body: (ok: Extract<R, { kind: 'ok' }>) => B) {
  return result.kind === 'error' ? failWith(res, result) : body(result as Extract<R, { kind: 'ok' }>);
}
