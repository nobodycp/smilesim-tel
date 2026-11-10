import { env, isProduction } from './config';
import { createHash } from 'node:crypto';
import { Injectable, type NestMiddleware, type OnModuleDestroy } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import IORedis from 'ioredis';
import { readCookie } from './modules/shared/cookies';
import { errorBody } from './errors';

// Requests per signed-in session in a one-minute window, shared by every API process through Redis.
// A page load asks for about ten reads; a busy desk stays far under these. Writes have their own, lower ceiling.
export const RATE_WINDOW_SECONDS = 60;
export const RATE_LIMIT_ALL = 600;
export const RATE_LIMIT_WRITES = 60;
/** Sign-in attempts per network address in the window, across every login name (review 2026-11-10, S9). */
export const RATE_LIMIT_SIGN_IN = 30;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** The routes a caller with no session uses to get one. */
const SIGN_IN = [/^\/auth\/login$/, /^\/auth\/passkey-login(\/options)?$/, /^\/office\/handoff$/];
// Not counted: the long-lived notices stream (one per open tab) and the health probe.
const EXEMPT = [/\/office\/notices\/stream$/, /^\/health$/];

/** One counter per key and window: returns the count after this request and the seconds left in the window. */
export type RateCounter = { hit: (key: string) => Promise<{ count: number; ttl: number }> };

export function memoryCounter(now: () => number = Date.now): RateCounter {
  const windows = new Map<string, { count: number; ends: number }>();
  return {
    async hit(key) {
      const at = now();
      let window = windows.get(key);
      if (!window || window.ends <= at) {
        window = { count: 0, ends: at + RATE_WINDOW_SECONDS * 1000 };
        windows.set(key, window);
      }
      window.count += 1;
      if (windows.size > 10_000) for (const [name, row] of windows) if (row.ends <= at) windows.delete(name);
      return { count: window.count, ttl: Math.ceil((window.ends - at) / 1000) };
    },
  };
}

export function redisCounter(redis: IORedis): RateCounter {
  return {
    async hit(key) {
      // The window opens at the first request (NX) and is never extended.
      const result = await redis.multi().set(key, 0, 'EX', RATE_WINDOW_SECONDS, 'NX').incr(key).ttl(key).exec();
      const count = Number(result?.[1]?.[1] ?? 0);
      const ttl = Number(result?.[2]?.[1] ?? RATE_WINDOW_SECONDS);
      return { count, ttl: ttl > 0 ? ttl : RATE_WINDOW_SECONDS };
    },
  };
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware, OnModuleDestroy {
  private readonly redis = env('REDIS_URL') ? new IORedis(env('REDIS_URL') as string, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
  counter: RateCounter = this.redis ? redisCounter(this.redis) : memoryCounter();

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  /**
   * Counts a sign-in attempt against the caller's address and answers 429 when it is over. Only where the address
   * is the caller's own: not in production behind a proxy the API was not told to trust (every caller would share
   * the proxy's address and lock each other out).
   */
  private async signInOver(req: Request, res: Response): Promise<boolean> {
    if (isProduction() && !env('TRUST_PROXY')) return false;
    try {
      const hit = await this.counter.hit(`rate:signin:${createHash('sha256').update(req.ip ?? '').digest('hex').slice(0, 32)}`);
      if (hit.count <= RATE_LIMIT_SIGN_IN) return false;
      res.setHeader('Retry-After', String(hit.ttl));
      res.status(429).json(errorBody('RATE_LIMITED'));
      return true;
    } catch {
      return false;
    }
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const sessionId = readCookie(req, 'sid');
    const path = req.originalUrl.split('?')[0] ?? '';
    if (req.method === 'POST' && SIGN_IN.some((pattern) => pattern.test(path)) && (await this.signInOver(req, res))) return;
    if (!sessionId || EXEMPT.some((pattern) => pattern.test(path))) return next();
    // The key holds a hash, never the session id itself.
    const id = createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
    try {
      const all = await this.counter.hit(`rate:all:${id}`);
      const write = WRITE_METHODS.has(req.method) ? await this.counter.hit(`rate:write:${id}`) : null;
      const over = all.count > RATE_LIMIT_ALL ? all : write && write.count > RATE_LIMIT_WRITES ? write : null;
      if (over) {
        res.setHeader('Retry-After', String(over.ttl));
        res.status(429).json(errorBody('RATE_LIMITED'));
        return;
      }
    } catch {
      // Redis down: the limit is a guard, not a gate; the request goes on.
    }
    next();
  }
}
