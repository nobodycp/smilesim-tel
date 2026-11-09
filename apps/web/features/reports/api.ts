import { request, segment, queryString } from '../../lib/http';
import type { BalanceReportRow, ReportPayload, SupplyReportRow } from '../../lib/api-types';

/** The reports calls of the office API. Composed into `api` by lib/api.ts. */
export const reportsApi = {
  reportBalances: (query: { q?: string; layer?: string; negative?: string }) =>
    request<{ rows: BalanceReportRow[]; totals: { count: number; balance: number; used: number }; capped: boolean }>('GET', `/office/reports/balances${queryString(query)}`),
  reportSupply: (query: { from?: string; to?: string }) =>
    request<{ rows: SupplyReportRow[]; totals: { operations: number; cost: number; profit: number }; capped: boolean }>('GET', `/office/reports/supply${queryString(query)}`),
  officeReport: (kind: string, cursor?: string | null) =>
    request<ReportPayload>('GET', `/office/reports/${segment(kind)}${queryString({ cursor })}`),
};
