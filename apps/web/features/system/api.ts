import { request, queryString } from '../../lib/http';
import type { AlertSeen, ApiResult, AlertsCleared, ErrorGroups, RequestLogCleared, RequestLogPage, RequestLogSummary, SystemAlertPage, SystemStatus, SystemVersions } from '../../lib/api-types';

/** The filters of the request log, as `GET /v1/system/requests` and its summary read them. */
export type RequestLogFilters = {
  status?: string;
  code?: string;
  method?: string;
  route?: string;
  /** Any part of the path as sent, case ignored. */
  path?: string;
  /** `1`: only the requests no route matched. */
  unmatched?: string;
  account?: string;
  /** The start of an address (`10.0.` finds a range). */
  ip?: string;
  slowerThan?: string;
  from?: string;
  to?: string;
};

/** The filters of the server errors, as `GET /v1/system/errors` reads them. */
export type ErrorFilters = {
  route?: string;
  from?: string;
  to?: string;
};

/**
 * The versions page's answer from the web server itself (`app/system/versions/data`), which asks the API with the
 * caller's session and fills in the web's own components; not through `/api`, which is the API. Its failures read
 * as `request` reads the API's: the code and message the API sent, or NETWORK when nothing answered.
 */
async function webVersionsPage(): Promise<ApiResult<SystemVersions>> {
  let response: Response;
  try {
    response = await fetch('/system/versions/data', { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return { ok: false, status: 0, message: 'تعذّر الاتصال بالخادم', code: 'NETWORK' };
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (response.ok && data && typeof data === 'object') return { ok: true, status: response.status, data: data as SystemVersions };
  const body = (data ?? {}) as { message?: unknown; code?: unknown };
  if (typeof body.message !== 'string') return { ok: false, status: response.status, message: 'تعذّر الاتصال بالخادم', code: 'NETWORK' };
  return { ok: false, status: response.status, message: body.message, ...(typeof body.code === 'string' ? { code: body.code } : {}) };
}

/** The system monitor's calls (spec 2026-11-17-system-monitor), the branch owner's alone. Composed into `api` by lib/api.ts. */
export const systemApi = {
  requestLog: (query: RequestLogFilters & { cursor?: string | null } = {}) =>
    request<RequestLogPage>('GET', `/v1/system/requests${queryString(query)}`),
  requestLogSummary: (query: RequestLogFilters = {}) =>
    request<RequestLogSummary>('GET', `/v1/system/requests/summary${queryString(query)}`),
  clearRequestLog: () => request<RequestLogCleared>('DELETE', '/v1/system/requests'),
  systemStatus: () => request<SystemStatus>('GET', '/v1/system/status'),
  errorGroups: (query: ErrorFilters = {}) => request<ErrorGroups>('GET', `/v1/system/errors${queryString(query)}`),
  clearErrors: () => request<{ removed: number }>('DELETE', '/v1/system/errors'),
  alerts: (query: { state?: 'open' | 'closed'; cursor?: string | null } = {}) =>
    request<SystemAlertPage>('GET', `/v1/system/alerts${queryString(query)}`),
  markAlertSeen: (id: string) => request<AlertSeen>('POST', `/v1/system/alerts/${encodeURIComponent(id)}/seen`),
  clearAlerts: () => request<AlertsCleared>('DELETE', '/v1/system/alerts'),
  systemVersions: webVersionsPage,
  /** Asks for the newest versions now; 429 `RATE_LIMITED` within a minute of the last check. Its answer lacks the web's own: the page reads `systemVersions` again. */
  checkVersions: () => request<SystemVersions>('POST', '/v1/system/versions/check'),
};
