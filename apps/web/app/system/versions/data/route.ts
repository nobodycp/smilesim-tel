import { withWebVersions } from '../../../../features/system/versions';
import { webVersions } from '../../../../features/system/web-versions';
import type { SystemVersions } from '../../../../lib/api-types';

// `GET /system/versions/data`: the versions page's answer, the web's own components filled in.
// The web server asks the API's `GET /v1/system/versions` with the caller's own session cookie and door, so the API
// decides who may see versions (the branch owner on the branch door; spec 2026-11-17-system-monitor, D1); only a 200 from it is answered with the
// web's versions. Any refusal is passed back as the API sent it, and nothing of the web is in it.

export const dynamic = 'force-dynamic';

const API = process.env.API_PROXY_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

/** What the API needs to know the caller: its session, its door (set by proxy.ts from the host), and who it is. */
const FORWARDED = ['cookie', 'x-door', 'user-agent', 'x-forwarded-for', 'accept-language'] as const;

export async function GET(request: Request) {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  let answer: Response;
  try {
    answer = await fetch(`${API}/v1/system/versions`, { headers, cache: 'no-store' });
  } catch {
    // The API is not reachable: a bare gateway answer, as the rewrite gives (lib/http.ts reads it as NETWORK).
    return new Response(null, { status: 502 });
  }
  const body: unknown = await answer.json().catch(() => undefined);
  if (!answer.ok || body === undefined) {
    return Response.json(body ?? {}, { status: answer.ok ? 502 : answer.status, headers: { 'cache-control': 'no-store' } });
  }
  const today = new Date().toISOString().slice(0, 10);
  return Response.json(withWebVersions(body as SystemVersions, webVersions(), today), { headers: { 'cache-control': 'no-store' } });
}
