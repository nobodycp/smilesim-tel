import { CallHandler, ExecutionContext, Injectable, Module, NestInterceptor, type OnModuleDestroy } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { logger } from './log';
import { LEGACY_PREFIX } from './route-prefixes';

const log = logger('LegacyPaths');

/** How often the counts are written to the log and cleared. */
export const LEGACY_REPORT_EVERY_MS = 10 * 60_000;

/**
 * Counts the requests that still reach a route by its old path (`/office/…`, slice R.11b), by method and route
 * pattern (`GET /office/lines/:id`): never a parameter's value, a query, a body, a session, an account or an address.
 * Every ten minutes the counts are logged as one line and cleared, so a release can show that nothing calls the old
 * paths any more before they are removed (R.11c). Nothing is counted for the current paths.
 */
@Injectable()
export class LegacyPathCounter implements NestInterceptor, OnModuleDestroy {
  private readonly counts = new Map<string, number>();
  private readonly timer = setInterval(() => void this.report(), LEGACY_REPORT_EVERY_MS);

  constructor() {
    this.timer.unref?.();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<Request & { route?: { path?: unknown } }>();
      const pattern = req.route?.path;
      if (typeof pattern === 'string' && pattern.startsWith(`/${LEGACY_PREFIX}/`)) {
        const key = `${req.method} ${pattern}`;
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
      }
    }
    return next.handle();
  }

  /** What was counted since the last report, most used first, written to the log; the counts start again. */
  report(): [route: string, hits: number][] {
    const rows = [...this.counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    this.counts.clear();
    if (rows.length > 0) log.warn(`old paths used: ${rows.map(([route, hits]) => `${route} x${hits}`).join(', ')}`);
    return rows;
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.report();
  }
}

/** Registers the counter once for every route (`APP_INTERCEPTOR`), before the duplicate guard, so a replay is counted too. */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: LegacyPathCounter }],
})
export class LegacyPathsModule {}
