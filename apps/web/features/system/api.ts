import { request, queryString } from '../../lib/http';
import type { AlertSeen, AlertsCleared, ErrorGroups, RequestLogCleared, RequestLogPage, RequestLogSummary, SystemAlertPage, SystemStatus } from '../../lib/api-types';

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
};
