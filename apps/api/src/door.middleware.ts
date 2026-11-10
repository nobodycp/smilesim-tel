import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { expectedLayer } from './doors';
import { errorBody } from './errors';
import { AUTH_STORE, AuthStore } from './modules/auth/auth.store';
import { readCookie } from './modules/shared/cookies';

/**
 * The routes that start a session on this door. The `sid` cookie is shared by every door of the site
 * (`COOKIE_DOMAIN`), so a browser signed in on another door brings that session here; refusing it would leave the
 * door with no way in. These routes replace the cookie, so they pass whatever session came with them.
 */
const STARTS_SESSION = new Set(['/auth/login', '/auth/passkey-login/options', '/auth/passkey-login', '/office/handoff']);

function startsSession(req: Request): boolean {
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0].replace(/\/+$/, '');
  return req.method === 'POST' && STARTS_SESSION.has(path);
}

@Injectable()
export class DoorMiddleware implements NestMiddleware {
  constructor(@Inject(AUTH_STORE) private readonly store: AuthStore) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const header = req.headers['x-door'];
    const expected = expectedLayer({
      origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      door: typeof header === 'string' ? header : undefined,
    });
    if (expected === 'conflict') {
      res.status(403).json(errorBody('DOOR_MISMATCH'));
      return;
    }
    if (!expected || startsSession(req)) return next();
    const sessionId = readCookie(req, 'sid');
    if (!sessionId) return next();
    const live = await this.store.liveSession(sessionId);
    if (!live) return next();
    // An entered (impersonation) session opens on the entered account's own door, like that account would, so the
    // owner sees exactly its menu and screens; the admin door refuses it.
    if (live.user.layer !== expected) {
      res.status(403).json(errorBody('DOOR_MISMATCH'));
      return;
    }
    next();
  }
}
