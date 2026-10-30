import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { doorFromHost } from './lib/doors';

export function middleware(request: NextRequest) {
  const door = doorFromHost(request.headers.get('host') ?? '');
  const headers = new Headers(request.headers);
  if (door) headers.set('x-door', door.host);
  else headers.delete('x-door');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
