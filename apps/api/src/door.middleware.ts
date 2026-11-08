import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { expectedLayer } from './doors';
import { errorBody } from './errors';
import { AUTH_STORE, AuthStore } from './modules/auth/auth.store';
import { readCookie } from './cookies';


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
    if (!expected) return next();
    const sessionId = readCookie(req, 'sid');
    if (!sessionId) return next();
    const live = await this.store.liveSession(sessionId);
    if (!live) return next();
    let layer = live.user.layer;
    if (live.session.kind === 'impersonation') {
      const homeId = readCookie(req, 'home');
      const home = homeId ? await this.store.liveSession(homeId) : null;
      if (home) layer = home.user.layer;
    }
    if (layer !== expected) {
      res.status(403).json(errorBody('DOOR_MISMATCH'));
      return;
    }
    next();
  }
}
