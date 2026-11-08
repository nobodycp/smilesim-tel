// Every call goes to the backend with the session cookie. No login policy lives here:
// the backend decides, and the pages display what it returns.

import { reportReach } from './connection';
import { doorFromHost } from './doors';
import type { ApiResult } from './api-types';

const base = () => (typeof window === 'undefined' ? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001' : '/api');

const NETWORK_MESSAGE = 'تعذّر الاتصال بالخادم';
const GENERIC_MESSAGE = 'حدث خطأ';

// The session is gone, or belongs to another door: back to /login. The code decides. The Arabic
// sentence is kept as a fallback for an API that does not send a code yet.
function endsSession(status: number, code: string | undefined, message: string): boolean {
  if (code) return code === 'LOGIN_REQUIRED' || code === 'DOOR_MISMATCH';
  return (status === 401 && message === 'يلزم تسجيل الدخول') || (status === 403 && message === 'هذا الحساب ليس لهذا المدخل');
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  const door = typeof window === 'undefined' ? null : doorFromHost(window.location.host);
  const headers: Record<string, string> = {};
  if (door) headers['x-door'] = door.host;
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    response = await fetch(`${base()}${path}`, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    reportReach(false);
    return { ok: false, status: 0, message: NETWORK_MESSAGE, code: 'NETWORK' };
  }
  const data: unknown = await response.json().catch(() => undefined);
  // The browser reaches the API through the Next rewrite. When the API is down the rewrite answers
  // a bare 5xx with no JSON; that is the API being unreachable, not an error it chose to send.
  if (!reachedApi(response.status, data)) {
    reportReach(false);
    return { ok: false, status: response.status, message: NETWORK_MESSAGE, code: 'NETWORK' };
  }
  reportReach(true);
  if (!response.ok) {
    const body = (data ?? {}) as { message?: unknown; code?: unknown };
    const hasMessage = typeof body.message === 'string';
    const message = hasMessage ? (body.message as string) : GENERIC_MESSAGE;
    const code = typeof body.code === 'string' ? body.code : hasMessage ? undefined : 'GENERIC';
    if (typeof window !== 'undefined' && window.location.pathname !== '/login' && endsSession(response.status, code, message)) {
      window.location.assign('/login');
    }
    return { ok: false, status: response.status, message, ...(code ? { code } : {}) };
  }
  return { ok: true, status: response.status, data: (data ?? {}) as T };
}

// A gateway answer (502/503/504) or a 5xx with no JSON body never came from the API.
function reachedApi(status: number, data: unknown): boolean {
  if (status === 502 || status === 503 || status === 504) return false;
  if (status >= 500 && (data === undefined || typeof data !== 'object' || data === null)) return false;
  return true;
}

export const segment = encodeURIComponent;

// Empty values are left out, so a cleared filter sends nothing.
export function queryString(query?: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) params.set(key, value);
  }
  const tail = params.toString();
  return tail ? `?${tail}` : '';
}

