import { queryString, request, segment } from '../../lib/http';
import type { ProviderAccount, ProviderAccountDetail } from '../../lib/api-types';

/** Our account with each provider (roadmap N7). Composed into `api` by lib/api.ts. */
export const providerAccountsApi = {
  providerAccounts: () => request<{ rows: ProviderAccount[]; totals: { balance: number; held: number; owed: number } }>('GET', '/office/provider-accounts'),
  providerAccount: (code: string, query: { from?: string; to?: string }) =>
    request<ProviderAccountDetail>('GET', `/office/provider-accounts/${segment(code)}${queryString(query)}`),
  providerAccountExportHref: (code: string, query: { from?: string; to?: string }) => `/api/office/provider-accounts/${segment(code)}/export${queryString(query)}`,
  addProviderEntry: (code: string, body: { kind: 'payment' | 'settlement'; amount: number; note: string }) =>
    request<{ ok: true }>('POST', `/office/provider-accounts/${segment(code)}/entries`, body),
  setProviderCredit: (code: string, creditLimit: number) =>
    request<{ ok: true }>('PATCH', `/office/provider-accounts/${segment(code)}/credit`, { creditLimit }),
};
