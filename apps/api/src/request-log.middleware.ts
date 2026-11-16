import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ERROR_MESSAGES } from './errors';
import { hashSessionToken } from './modules/auth';
import { readCookie } from './modules/platform/cookies';
import { resourcePaths, routePath } from './modules/platform/route-prefixes';
import { RequestLogWriter, type RequestAccount } from './modules/monitoring/request-log.writer';
import type { Actor } from './modules/access';

/** Sent back on every answer, so a person's report can be matched to its row. Always ours, never the caller's. */
export const REQUEST_ID_HEADER = 'X-Request-Id';
const USER_AGENT_MAX = 200;
const PATH_MAX = 500;
const ROUTE_MAX = 200;
// Not written: the health probe (polled), and the notices stream (one endless request a tab).
const UNLOGGED = [/^\/health$/, ...resourcePaths('notices/stream').map((path) => new RegExp(`^${path}$`))];

/** A length header as a number of bytes; anything else is 0. */
function bytes(value: unknown): number {
  const count = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/** The actor the actor interceptor left on the request; an entered session names the account that entered too. */
function accountOf(req: Request): RequestAccount | null {
  const actor = (req as Request & { actor?: Actor }).actor;
  if (!actor) return null;
  return { actorId: actor.id, actorLoginName: actor.loginName, layer: actor.layer, operatorId: actor.impersonating ? actor.operatorId : null };
}

/**
 * The request log (spec 2026-11-17-system-monitor, section 2). First of the middleware, so a request refused by the
 * others (origin, rate limit, door) and an unknown path are written too. When the answer ends it hands one row to
 * the writer, which keeps it in memory: the request never waits for its log.
 *
 * What is read, and only this: the method, the route pattern, the path cut at `?`, the status, the API's error code
 * (from an error answer's `code`, when it is one of ours), the account, the address, the user agent cut to 200
 * characters and the two lengths. Never a body, a cookie, a query string or another header's value; the session
 * cookie is turned into its hash here, to name the account later, and goes no further.
 */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  constructor(private readonly writer: RequestLogWriter) {}

  use(req: Request, res: Response, next: NextFunction) {
    const path = routePath(req.originalUrl ?? req.url);
    if (UNLOGGED.some((pattern) => pattern.test(path))) return next();
    const at = new Date();
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    let code = '';
    const json = res.json.bind(res);
    // The error code is taken from the answer as it is sent; nothing else of the body is looked at or kept.
    res.json = (body?: unknown) => {
      const sent = (body as { code?: unknown } | null)?.code;
      if (res.statusCode >= 400 && typeof sent === 'string' && sent in ERROR_MESSAGES) code = sent;
      return json(body);
    };
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      try {
        const route = (req.route as { path?: unknown } | undefined)?.path;
        const sessionId = accountOf(req) ? undefined : readCookie(req, 'sid');
        const agent = req.headers['user-agent'];
        this.writer.add({
          at,
          durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
          method: req.method,
          route: typeof route === 'string' ? route.slice(0, ROUTE_MAX) : '',
          path: String(req.originalUrl ?? req.url ?? '').split('?')[0].slice(0, PATH_MAX),
          status: res.statusCode,
          code,
          account: accountOf(req),
          sessionHash: sessionId ? hashSessionToken(sessionId) : null,
          ip: (req.ip ?? '').replace(/^::ffff:/, ''),
          userAgent: typeof agent === 'string' ? agent.slice(0, USER_AGENT_MAX) : '',
          requestId,
          bytesIn: bytes(req.headers['content-length']),
          bytesOut: bytes(res.getHeader('content-length')),
        });
      } catch {
        // The log never fails a request, even after its answer.
      }
    };
    res.once('finish', end);
    res.once('close', end);
    next();
  }
}
