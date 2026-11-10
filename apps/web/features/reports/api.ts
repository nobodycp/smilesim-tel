import { request, segment, queryString } from '../../lib/http';
import { allPages } from '../../lib/all-pages';
import type { ApiResult, BalanceReportRow, Page, ReportPayload, SupplyReportRow } from '../../lib/api-types';

type BalanceTotals = { count: number; balance: number; used: number };

/** The reports calls of the office API. Composed into `api` by lib/api.ts. */
export const reportsApi = {
  /** The balances report whole: the screen sorts and sums its rows, so the pages are read one after another. */
  reportBalances: async (query: { q?: string; layer?: string; negative?: string }): Promise<ApiResult<{ rows: BalanceReportRow[]; totals: BalanceTotals }>> => {
    const read = await allPages((cursor) =>
      request<Page<BalanceReportRow> & { totals: BalanceTotals }>('GET', `/office/reports/balances${queryString({ ...query, cursor })}`));
    return read.ok ? { ...read, data: { rows: read.data.rows, totals: read.data.first.totals } } : read;
  },
  reportSupply: (query: { from?: string; to?: string }) =>
    request<{ rows: SupplyReportRow[]; totals: { operations: number; cost: number; profit: number }; capped: boolean }>('GET', `/office/reports/supply${queryString(query)}`),
  officeReport: (kind: string, cursor?: string | null) =>
    request<ReportPayload>('GET', `/office/reports/${segment(kind)}${queryString({ cursor })}`),
};
