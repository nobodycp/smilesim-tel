import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { expectedLayer, WRONG_DOOR } from './doors';
import { AUTH_STORE, AuthStore } from './modules/auth/auth.store';

function readCookie(req: Request, name: string): string | undefined {
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
      res.status(403).json({ message: WRONG_DOOR });
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
      res.status(403).json({ message: WRONG_DOOR });
      return;
    }
    next();
  }
}
