import { request, segment, queryString } from '../../lib/http';
import type { FinanceRow, FinanceSummary, ProfitReport, LedgerRow, ProviderOpRow, ProviderOpStats, Page } from '../../lib/api-types';

/** The wallets calls of the office API. Composed into `api` by lib/api.ts. */
export const walletsApi = {
  fundWallet: (loginName: string, amount: number, note: string, reason: 'deposit' | 'correction' | 'settlement' = 'deposit') =>
    request<{ ok: true }>('POST', `/v1/wallets/${segment(loginName)}/fund`, { amount, note, reason }),
  /** Takes money back from a child to its parent (roadmap N6): a return, a correction or a settlement, with a note. */
  deductWallet: (loginName: string, amount: number, reason: 'return' | 'correction' | 'settlement', note: string) =>
    request<{ ok: true }>('POST', `/v1/wallets/${segment(loginName)}/deduct`, { amount, note, reason }),
  setCeiling: (loginName: string, ceiling: number) =>
    request<{ ok: true }>('PATCH', `/v1/wallets/${segment(loginName)}/ceiling`, { ceiling }),
  profitReport: (query: { from?: string; to?: string; q?: string }) =>
    request<ProfitReport>('GET', `/v1/finance/profits${queryString(query)}`),
  profitExportHref: (query: { from?: string; to?: string; q?: string }) => `/api/v1/finance/profits/export${queryString(query)}`,
  financeSummary: (days = 30) => request<FinanceSummary>('GET', `/v1/finance/summary${days === 30 ? '' : `?days=${days}`}`),
  /** A link, not a call: the browser downloads the CSV with the session cookie. */
  financeExportHref: (query: { kind?: string; layer?: string; q?: string; from?: string; to?: string; scope?: string; loss?: string }) =>
    `/api/v1/finance/export${queryString(query)}`,
  finance: (query?: { kind?: string; layer?: string; q?: string; from?: string; to?: string; scope?: string; loss?: string; cursor?: string | null }) =>
    request<Page<FinanceRow>>('GET', `/v1/finance${queryString(query)}`),
  providerOperations: (query?: { kind?: string; provider?: string; q?: string; from?: string; to?: string; match?: string; loss?: string; cursor?: string | null }) =>
    request<Page<ProviderOpRow> & { stats: ProviderOpStats; providers: { code: string; name: string }[] }>('GET', `/v1/provider-operations${queryString(query)}`),
  /** Charges the point of sale for an operation given back after the provider's success (spec DB.5 P.9): no body, the amount is the row's. */
  chargeGivenBack: (entryId: string) =>
    request<{ ok: true; amount: number }>('POST', `/v1/provider-operations/${segment(entryId)}/charge`),
  /** The signed-in account's own wallet ledger. */
  ledger: (query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string | null }) =>
    request<Page<LedgerRow>>('GET', `/v1/ledger${queryString(query)}`),
};
