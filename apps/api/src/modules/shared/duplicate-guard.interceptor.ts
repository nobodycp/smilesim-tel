import { env } from '../../config';
import { createHash } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, type OnModuleDestroy } from '@nestjs/common';
import type { Request, Response } from 'express';
import IORedis from 'ioredis';
import { Observable, catchError, from, mergeMap, of, tap, throwError } from 'rxjs';
import { readCookie } from './cookies';
import { OfficeFailure, fail } from './office-failure';
import { isSealed, open, seal } from './secret-box';

// Server-side guard against a write sent twice (a double click, a retried request), spec 2026-11-08-duplicate-writes.
// A write is the same when it comes from the same session with the same method, path and body, or carries the same
// `Idempotency-Key`. While the first is running a repeat is refused (409 DUPLICATE_REQUEST); once it succeeded, a
// repeat within the window gets the first answer back and runs nothing. A failed write leaves no trace, so it can be
// sent again. An `Idempotency-Key` belongs to the request it was first sent with: the same key on another route or
// with another body is refused (400), never answered with the first request's result. A handler that writes its own response (cookies: enter, leave) is only locked while it runs.
//
// This guard is a convenience in front of the database, never the protection: it expires and it fails open. What
// must not happen twice is refused by the database itself (row locks, unique indexes, `OfficeTask.requestKey`).
//
// An answer that carries a secret (`@SecretAnswer()`: an activation's eSIM code) is kept sealed (secret-box), so
// the store never holds it in the clear. Where it cannot be sealed it is not kept at all: the write stays marked
// as done and a repeat inside the window is refused (409) instead of being answered or run again.
export const SAME_WRITE_SECONDS = 10;
export const KEYED_WRITE_SECONDS = 24 * 60 * 60;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PENDING = '__pending__';
/** The write succeeded and its answer is not kept. */
const DONE_UNKEPT = '__done__';
/** The response header of an answer that repeats an earlier one and ran nothing. */
export const REPLAY_HEADER = 'Idempotent-Replay';
const SECRET_ANSWER = 'duplicate-guard:secret-answer';
/** Marks a route whose answer may carry a secret: the guard keeps it sealed, or not at all. */
export const SecretAnswer = () => SetMetadata(SECRET_ANSWER, true);

/** What is stored for an answer: the JSON, sealed for a secret one; the done mark when it cannot be sealed. */
function kept(answer: unknown, secret: boolean): string {
  const text = JSON.stringify(answer);
  if (!secret) return text;
  const sealed = seal(text);
  return isSealed(sealed) ? sealed : DONE_UNKEPT;
}

/** The stored answer, or null when it is one that cannot be read back. */
function answerOf(found: string): unknown {
  try {
    return JSON.parse(isSealed(found) ? open(found) : found) as unknown;
  } catch {
    return null;
  }
}

export type WriteStore = {
  /** Claims `key` for `seconds` when free, holding `marker`; else returns what is there (a marker or a stored answer). */
  claim: (key: string, seconds: number, marker?: string) => Promise<string | null>;
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
    async claim(key, seconds, marker = PENDING) {
      const row = live(key);
      if (row) return row.value;
      rows.set(key, { value: marker, ends: now() + seconds * 1000 });
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
    async claim(key, seconds, marker = PENDING) {
      const set = await redis.set(key, marker, 'EX', seconds, 'NX');
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
  private readonly redis = env('REDIS_URL') ? new IORedis(env('REDIS_URL') as string, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
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
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    // What the request is: its route and its body.
    const request = hash(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`);
    const key = `write:${hash(`${sessionId}\n${explicit ? `key:${explicit}` : request}`)}`;
    const seconds = explicit ? KEYED_WRITE_SECONDS : SAME_WRITE_SECONDS;
    const secret = Reflect.getMetadata(SECRET_ANSWER, context.getHandler()) === true;
    // A Redis failure lets the write through: the guard is a convenience, the row locks are the protection.
    const claimed = async () => {
      // The key is bound to the first request sent with it.
      if (explicit && ((await this.store.claim(`${key}:of`, seconds, request)) ?? request) !== request) fail(400, 'INVALID');
      return this.store.claim(key, seconds);
    };

    return from(claimed().catch((error: unknown) => (error instanceof OfficeFailure ? Promise.reject(error) : null))).pipe(
      mergeMap((found) => {
        if (found === PENDING || found === DONE_UNKEPT) fail(409, 'DUPLICATE_REQUEST');
        if (found !== null) {
          const answer = answerOf(found);
          // A kept answer that no longer opens (the sealing key changed) is not an answer: the repeat is refused.
          if (answer === null) fail(409, 'DUPLICATE_REQUEST');
          context.switchToHttp().getResponse<Response>().setHeader(REPLAY_HEADER, 'true');
          return of(answer);
        }
        return next.handle().pipe(
          tap((answer) => {
            // A handler that wrote its own response returns nothing: keep no answer to replay.
            const saved = answer === undefined ? this.store.drop(key) : this.store.save(key, kept(answer, secret), seconds);
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
