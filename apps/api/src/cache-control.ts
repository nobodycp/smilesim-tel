import type { NextFunction, Request, Response } from 'express';

/**
 * What every API answer says about caching unless its handler says otherwise (speed plan PF.11, spec decision 12).
 * `private`: no shared cache (a CDN, a proxy) ever stores an answer, which is always one account's. `no-cache`: the
 * browser keeps it but asks again every time (the ETag still saves the bytes of an unchanged answer).
 */
export const DEFAULT_CACHE_CONTROL = 'private, no-cache';

/**
 * Sets the default before anything else runs, so it is on every answer: the handlers', the errors' and the refusals
 * the middlewares send before any handler (origin, rate limit, door). A route with a policy of its own replaces it
 * by setting the header itself: the branding pictures (immutable under the current `?v=`), the notices stream and
 * the health probe (`no-store`).
 */
export function cacheControl() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', DEFAULT_CACHE_CONTROL);
    next();
  };
}
