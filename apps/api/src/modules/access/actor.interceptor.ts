import { withRequestTree } from './account-tree';
import { ActorResolver } from './actor-resolver';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, mergeMap } from 'rxjs';
import { gateOf } from '../platform';
import type { Actor as ActorShape } from './types';

type WithActor = Request & { actor?: ActorShape };

/** The methods that write nothing (ADR 0015); Express answers HEAD with the GET route. */
const READS = new Set(['GET', 'HEAD']);

/**
 * Resolves the signed-in actor once, before the handler, and leaves it on the request for `@Actor()`.
 * Declared after ActivityInterceptor (`@UseInterceptors(ActivityInterceptor, ActorInterceptor)`), so a refused
 * session is still written to the activity log, and before pipes run, so 401 still comes before 400. A GET's
 * handler shares one read of the account tree (`withRequestTree`).
 */
@Injectable()
export class ActorInterceptor implements NestInterceptor {
  constructor(private readonly actors: ActorResolver) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<WithActor>();
    return from(this.actors.actor(gateOf(req))).pipe(
      mergeMap((actor) => {
        req.actor = actor;
        // A read request reads the account tree once, however many of its steps ask for it (plan 2026-11-17-speed, PF.9).
        return READS.has(req.method) ? withRequestTree(() => next.handle()) : next.handle();
      }),
    );
  }
}

/**
 * The actor's shape under the decorator's name, so that the module's surface (`index.ts`) hands both as `Actor`:
 * one name cannot be re-exported from two files.
 */
export type Actor = ActorShape;

/** The actor ActorInterceptor resolved for this request. */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext): ActorShape => {
  const actor = context.switchToHttp().getRequest<WithActor>().actor;
  if (!actor) throw new Error('@Actor() needs ActorInterceptor on the controller');
  return actor;
});
