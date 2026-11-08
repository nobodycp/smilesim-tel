import { createHash } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, type OnModuleDestroy } from '@nestjs/common';
import type { Request } from 'express';
import IORedis from 'ioredis';
import { Observable, catchError, from, mergeMap, of, tap, throwError } from 'rxjs';
import { readCookie } from '../../cookies';
import { fail } from './office-failure';

// Server-side guard against a write sent twice (a double click, a retried request), spec 2026-11-08-duplicate-writes.
// A write is the same when it comes from the same session with the same method, path and body, or carries the same
// `Idempotency-Key`. While the first is running a repeat is refused (409 DUPLICATE_REQUEST); once it succeeded, a
// repeat within the window gets the first answer back and runs nothing. A failed write leaves no trace, so it can be
// sent again. A handler that writes its own response (cookies: enter, leave) is only locked while it runs.
export const SAME_WRITE_SECONDS = 10;
export const KEYED_WRITE_SECONDS = 24 * 60 * 60;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PENDING = '__pending__';

export type WriteStore = {
  /** Claims `key` for `seconds` when free; else returns what is there (PENDING or a stored answer). */
  claim: (key: string, seconds: number) => Promise<string | null>;
  save: (key: string, value: string, seconds: number) => Promise<void>;
  drop: (key: string) => Promise<void>;
};

export function memoryWrites(now: () => number = Date.now): WriteStore {
  const rows = new Map<string, { value: string; ends: number }>();
  const live = (key: string) => {
    const row = rows.get(key);
    if (row && row.ends <= now()) rows.delete(key);
    return rows.get(key);
  };
  return {
    async claim(key, seconds) {
      const row = live(key);
      if (row) return row.value;
      rows.set(key, { value: PENDING, ends: now() + seconds * 1000 });
      return null;
    },
    async save(key, value, seconds) {
      rows.set(key, { value, ends: now() + seconds * 1000 });
    },
    async drop(key) {
      rows.delete(key);
    },
  };
}

function redisWrites(redis: IORedis): WriteStore {
  return {
    async claim(key, seconds) {
      const set = await redis.set(key, PENDING, 'EX', seconds, 'NX');
      return set === 'OK' ? null : await redis.get(key);
    },
    async save(key, value, seconds) {
      await redis.set(key, value, 'EX', seconds);
    },
    async drop(key) {
      await redis.del(key);
    },
  };
}

@Injectable()
export class DuplicateGuardInterceptor implements NestInterceptor, OnModuleDestroy {
  private readonly redis = process.env.REDIS_URL ? new IORedis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
  store: WriteStore = this.redis ? redisWrites(this.redis) : memoryWrites();

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.originalUrl.split('?')[0] ?? '';
    const sessionId = readCookie(req, 'sid');
    if (!WRITE_METHODS.has(req.method) || !path.startsWith('/office/') || !sessionId) return next.handle();
    const explicit = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].slice(0, 120) : '';
    const fingerprint = createHash('sha256')
      .update(`${sessionId}\n${explicit ? `key:${explicit}` : `${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`}`)
      .digest('hex');
    const key = `write:${fingerprint}`;
    const seconds = explicit ? KEYED_WRITE_SECONDS : SAME_WRITE_SECONDS;

    return from(this.store.claim(key, seconds).catch(() => null)).pipe(
      mergeMap((found) => {
        if (found === PENDING) fail(409, 'DUPLICATE_REQUEST');
        if (found !== null) return of(JSON.parse(found) as unknown);
        return next.handle().pipe(
          tap((answer) => {
            // A handler that wrote its own response returns nothing: keep no answer to replay.
            const saved = answer === undefined ? this.store.drop(key) : this.store.save(key, JSON.stringify(answer), seconds);
            void saved.catch(() => undefined);
          }),
          catchError((error: unknown) => {
            void this.store.drop(key).catch(() => undefined);
            return throwError(() => error);
          }),
        );
      }),
    );
  }
}
