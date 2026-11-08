import { request, segment, queryString } from '../../lib/http';
import type { FinanceRow, FinanceSummary, ProfitReport, LedgerRow, ProviderOpRow, ProviderOpStats } from '../../lib/api-types';

/** The wallets calls of the office API. Composed into `api` by lib/api.ts. */
export const walletsApi = {
  fundWallet: (loginName: string, amount: number, note: string, reason: 'deposit' | 'correction' | 'settlement' = 'deposit') =>
    request<{ ok: true }>('POST', `/office/wallets/${segment(loginName)}/fund`, { amount, note, reason }),
  /** Takes money back from a child to its parent (roadmap N6): a return, a correction or a settlement, with a note. */
  deductWallet: (loginName: string, amount: number, reason: 'return' | 'correction' | 'settlement', note: string) =>
    request<{ ok: true }>('POST', `/office/wallets/${segment(loginName)}/deduct`, { amount, note, reason }),
  setCeiling: (loginName: string, ceiling: number) =>
    request<{ ok: true }>('PATCH', `/office/wallets/${segment(loginName)}/ceiling`, { ceiling }),
  profitReport: (query: { from?: string; to?: string; q?: string }) =>
    request<ProfitReport>('GET', `/office/finance/profits${queryString(query)}`),
  profitExportHref: (query: { from?: string; to?: string; q?: string }) => `/api/office/finance/profits/export${queryString(query)}`,
  financeSummary: () => request<FinanceSummary>('GET', '/office/finance/summary'),
  /** A link, not a call: the browser downloads the CSV with the session cookie. */
  financeExportHref: (query: { kind?: string; layer?: string; q?: string; from?: string; to?: string; scope?: string }) =>
    `/api/office/finance/export${queryString(query)}`,
  officeFinance: (query?: { kind?: string; layer?: string; q?: string; from?: string; to?: string; scope?: string; cursor?: string | null }) =>
    request<{ entries: FinanceRow[]; nextCursor: string | null; total: number }>('GET', `/office/finance${queryString(query)}`),
  officeProviderOperations: (query?: { kind?: string; provider?: string; q?: string; from?: string; to?: string; cursor?: string | null }) =>
    request<{ entries: ProviderOpRow[]; nextCursor: string | null; total: number; stats: ProviderOpStats; providers: { code: string; name: string }[] }>('GET', `/office/provider-operations${queryString(query)}`),
  officeLedger: (scope: string, query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string | null }) =>
    request<{ entries: LedgerRow[]; nextCursor: string | null; total: number }>('GET', `/office/ledger/${segment(scope)}${queryString(query)}`),
};
