import { isProduction } from './config';
import type { NextFunction, Request, Response } from 'express';

// Headers every API answer carries. The API serves JSON, images and an event stream, never a page to frame,
// so the policy denies everything; the Swagger page (/docs, outside production) needs its scripts and is left out.
export function securityHeaders(production = isProduction()) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('X-Powered-By');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!req.path.startsWith('/docs')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
