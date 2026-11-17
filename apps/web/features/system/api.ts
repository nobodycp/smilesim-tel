import { request, queryString } from '../../lib/http';
import type { RequestLogPage, RequestLogSummary } from '../../lib/api-types';

/** The filters of the request log, as `GET /v1/system/requests` and its summary read them. */
export type RequestLogFilters = {
  status?: string;
  code?: string;
  route?: string;
  account?: string;
  ip?: string;
  slowerThan?: string;
  from?: string;
  to?: string;
};

/** The system monitor's calls (spec 2026-11-17-system-monitor), the branch owner's alone. Composed into `api` by lib/api.ts. */
export const systemApi = {
  requestLog: (query: RequestLogFilters & { cursor?: string | null } = {}) =>
    request<RequestLogPage>('GET', `/v1/system/requests${queryString(query)}`),
  requestLogSummary: (query: RequestLogFilters = {}) =>
    request<RequestLogSummary>('GET', `/v1/system/requests/summary${queryString(query)}`),
  clearRequestLog: () => request<{ removed: number }>('DELETE', '/v1/system/requests'),
};
