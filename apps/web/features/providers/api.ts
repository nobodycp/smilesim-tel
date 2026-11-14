import { queryString, request, segment } from '../../lib/http';
import type { ProviderAccount, ProviderAccountDetail, ReconRun, ReconRunSummary, StatementMap, StatementPreview } from '../../lib/api-types';

/** Our account with each provider (roadmap N7). Composed into `api` by lib/api.ts. */
export const providerAccountsApi = {
  providerAccounts: () => request<{ rows: ProviderAccount[]; totals: { balance: number; held: number; owed: number } }>('GET', '/v1/provider-accounts'),
  providerAccount: (code: string, query: { from?: string; to?: string }) =>
    request<ProviderAccountDetail>('GET', `/v1/provider-accounts/${segment(code)}${queryString(query)}`),
  providerAccountExportHref: (code: string, query: { from?: string; to?: string }) => `/api/v1/provider-accounts/${segment(code)}/export${queryString(query)}`,
  addProviderEntry: (code: string, body: { kind: 'payment' | 'settlement'; amount: number; note: string }) =>
    request<{ ok: true }>('POST', `/v1/provider-accounts/${segment(code)}/entries`, body),
  previewStatement: (code: string, file: { fileName: string; content: string }) =>
    request<StatementPreview>('POST', `/v1/provider-accounts/${segment(code)}/statements/preview`, file),
  runReconciliation: (code: string, body: { fileName: string; content: string; map: StatementMap }) =>
    request<ReconRun>('POST', `/v1/provider-accounts/${segment(code)}/reconciliations`, body),
  reconciliations: (code: string) => request<{ runs: ReconRunSummary[] }>('GET', `/v1/provider-accounts/${segment(code)}/reconciliations`),
  reconciliation: (id: string) => request<ReconRun>('GET', `/v1/reconciliations/${segment(id)}`),
  updateReconItem: (id: string, body: { status: 'open' | 'resolved'; note: string }) =>
    request<{ ok: true }>('PATCH', `/v1/reconciliation-items/${segment(id)}`, body),
  setProviderMatching: (code: string, body: { matchSource: 'api' | 'statement'; matchEveryDays: number }) =>
    request<{ ok: true }>('PATCH', `/v1/provider-accounts/${segment(code)}/matching`, body),
  simulateProviderStatement: (code: string) =>
    request<{ ok: true; lastMatchedAt: string }>('POST', `/v1/provider-accounts/${segment(code)}/simulate-statement`),
  setProviderCredit: (code: string, creditLimit: number, alertFloor?: number) =>
    request<{ ok: true }>('PATCH', `/v1/provider-accounts/${segment(code)}/credit`, { creditLimit, ...(alertFloor !== undefined ? { alertFloor } : {}) }),
};
