import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { ACTIVITY_KEY, type ActivityMeta } from './activity.decorator';
import { ActivityRecorder } from './activity-recorder';
import { gateOf } from '../../shared/cookies';
import { REPLAY_HEADER } from '../../shared/duplicate-guard.interceptor';
import { OfficeFailure } from '../../shared/office-failure';

/** Writes the activity event a route declares with `@Activity`, after the route answered or refused. */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly activity: ActivityRecorder,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<ActivityMeta | undefined>(ACTIVITY_KEY, context.getHandler());
    if (!meta) return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const event = { action: meta.action, subjectKind: meta.subjectKind, subjectRef: meta.subject(req) };
    const record = (result: 'ok' | 'fail', reason: string) => this.activity.recordOffice(gateOf(req), req.ip ?? '', event, result, reason);
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      // A repeat of a request already answered did nothing: the act is on record once, from the first time.
      mergeMap((value) => (res.getHeader(REPLAY_HEADER) ? [value] : from(record('ok', '').then(() => value)))),
      catchError((error: unknown) =>
        error instanceof OfficeFailure
          ? from(record('fail', error.code)).pipe(mergeMap(() => throwError(() => error)))
          : throwError(() => error),
      ),
    );
  }
}
