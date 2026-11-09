import { request, queryString } from '../../lib/http';
import type { ActivityRow } from '../../lib/api-types';

/** The audit calls of the office API. Composed into `api` by lib/api.ts. */
export const auditApi = {
  officeAudit: (query?: { action?: string; result?: string; layer?: string; q?: string; from?: string; to?: string; cursor?: string | null; addresses?: string }) =>
    request<{ entries: ActivityRow[]; nextCursor: string | null; total: number; addresses?: number }>('GET', `/office/audit${queryString(query)}`),
  /** The log under the same filters as a CSV. */
  auditExportHref: (query: { action?: string; result?: string; layer?: string; q?: string; from?: string; to?: string }) => `/api/office/audit/export${queryString(query)}`,
};
