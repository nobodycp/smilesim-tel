import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { doorFromHost } from './lib/doors';

const development = process.env.NODE_ENV === 'development';

/**
 * One Content-Security-Policy per request, built around a fresh nonce.
 * Next.js reads the nonce from this header on the request and stamps its own inline scripts;
 * layout.tsx reads `x-nonce` and passes it to the preferences bootstrap script.
 *
 * To allow a new source, add it to the directive that needs it below and say why:
 * an image host goes in img-src, an API on another origin in connect-src, a font host in font-src.
 * Development only loosens script-src ('unsafe-eval' for React/HMR), style-src and connect-src (ws: for HMR).
 */
function contentSecurityPolicy(nonce: string): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, ...(development ? ["'unsafe-eval'"] : [])],
    // Stylesheets (including next/font's self-hosted CSS) come from 'self'.
    // React writes style="" attributes on a few elements (positioned menus, company marks), so attributes allow inline.
    'style-src': ["'self'", ...(development ? ["'unsafe-inline'"] : [])],
    'style-src-attr': ["'unsafe-inline'"],
    // Company logos are stored as data URLs; blob: covers locally generated previews.
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    // The browser only talks to /api on its own origin (next.config.mjs rewrites it to the api).
    'connect-src': ["'self'", ...(development ? ['ws:', 'wss:'] : [])],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function proxy(request: NextRequest) {
  const door = doorFromHost(request.headers.get('host') ?? '');
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);

  const headers = new Headers(request.headers);
  if (door) headers.set('x-door', door.host);
  else headers.delete('x-door');
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
