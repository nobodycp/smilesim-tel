import { CallHandler, ExecutionContext, Injectable, NestInterceptor, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, mergeMap } from 'rxjs';
import { gateOf } from '../gate';
import { OfficeKernel } from './office-kernel';
import type { Actor as ActorShape } from './types';

type WithActor = Request & { officeActor?: ActorShape };

/**
 * Resolves the signed-in actor once, before the handler, and leaves it on the request for `@Actor()`.
 * Declared after ActivityInterceptor (`@UseInterceptors(ActivityInterceptor, ActorInterceptor)`), so a refused
 * session is still written to the activity log, and before pipes run, so 401 still comes before 400.
 */
@Injectable()
export class ActorInterceptor implements NestInterceptor {
  constructor(private readonly kernel: OfficeKernel) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<WithActor>();
    return from(this.kernel.actor(gateOf(req))).pipe(
      mergeMap((actor) => {
        req.officeActor = actor;
        return next.handle();
      }),
    );
  }
}

/** The actor ActorInterceptor resolved for this request. */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext): ActorShape => {
  const actor = context.switchToHttp().getRequest<WithActor>().officeActor;
  if (!actor) throw new Error('@Actor() needs ActorInterceptor on the controller');
  return actor;
});
