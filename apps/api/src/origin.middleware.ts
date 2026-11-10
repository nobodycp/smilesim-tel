import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { allowedOrigins } from './cors';
import { DOOR_HOSTS } from './doors';
import { errorBody } from './errors';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DOOR_LABELS: readonly string[] = DOOR_HOSTS.map((door) => door.host);

/**
 * Whether `origin` is the web app: one of the configured origins, or a door of the same site. The four doors are
 * the hosts `admin.` / `main.` / `agent.` / `pos.` in front of the site's name, so naming the site or one door
 * names them all. Any other host, another subdomain of the site included, is not.
 */
export function isWebOrigin(origin: string, allowed: string[] = allowedOrigins()): boolean {
  if (allowed.includes(origin)) return true;
  let asked: URL;
  try {
    asked = new URL(origin);
  } catch {
    return false;
  }
  const [label, ...rest] = asked.hostname.split('.');
  if (!DOOR_LABELS.includes(label) || rest.length === 0) return false;
  const site = rest.join('.');
  return allowed.some((entry) => {
    try {
      const known = new URL(entry);
      if (known.protocol !== asked.protocol || known.port !== asked.port) return false;
      const [knownLabel, ...knownRest] = known.hostname.split('.');
      // A door of the configured site itself (`admin.` + `smilesim.example`), or a sibling of a configured door.
      return known.hostname === site || (DOOR_LABELS.includes(knownLabel) && knownRest.join('.') === site);
    } catch {
      return false;
    }
  });
}

/**
 * A write that a browser sends from another site is refused (review 2026-11-10, S8). The session cookie is
 * `SameSite=Lax`, which still travels on a form posted from a sibling subdomain; the `Origin` header says where
 * the request really came from. A request with no `Origin` (a server, a script, a test) is not a browser form and
 * is let through to the session check.
 */
@Injectable()
export class OriginMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    if (WRITE_METHODS.has(req.method) && typeof origin === 'string' && origin && !isWebOrigin(origin)) {
      res.status(403).json(errorBody('FORBIDDEN'));
      return;
    }
    next();
  }
}
