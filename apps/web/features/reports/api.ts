import { request, segment, queryString } from '../../lib/http';
import type { ReportPayload } from '../../lib/api-types';

/** The reports calls of the office API. Composed into `api` by lib/api.ts. */
export const reportsApi = {
  officeReport: (kind: string, cursor?: string | null) =>
    request<ReportPayload>('GET', `/office/reports/${segment(kind)}${queryString({ cursor })}`),
};
