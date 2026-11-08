import { request, segment } from '../../lib/http';
import type { PackageRow, PackageSheet, ProviderRow, ProviderSettings, Shelf, SimRules } from '../../lib/api-types';

/** The catalog calls of the office API. Composed into `api` by lib/api.ts. */
export const catalogApi = {
  officePackages: () => request<{ packages: PackageRow[]; companies: { name: string; image: string }[] }>('GET', '/office/packages'),
  officeCompanies: () => request<Shelf>('GET', '/office/companies'),
  setCompanyImage: (name: string, image: string) => request<{ ok: true }>('POST', '/office/companies/image', { name, image }),
  setCompanySim: (code: string, sim: SimRules & { esimPrice: number }) =>
    request<{ ok: true; sim: SimRules; esimPrice: number }>('PUT', `/office/companies/${segment(code)}/sim`, sim),
  setSellPrice: (code: string, price: number, renewalPrice?: number | null) =>
    request<{ price: number; renewalPrice: number | null }>('PUT', `/office/sell-prices/${segment(code)}`, { price, renewalPrice }),
  clearSellPrice: (code: string) => request<{ ok: true }>('DELETE', `/office/sell-prices/${segment(code)}`),
  officeProviders: () => request<{ providers: ProviderRow[] }>('GET', '/office/providers'),
  providerSettings: (code: string) =>
    request<ProviderSettings>('GET', `/office/providers/${segment(code)}/settings`),
  setProviderEsimPrice: (code: string, price: number | null) =>
    request<{ ok: true; esimPrice: number | null }>('PATCH', `/office/providers/${segment(code)}/esim-price`, { price }),
  setProviderMode: (code: string, action: string, mode: string) =>
    request<{ ok: true }>('PATCH', `/office/providers/${segment(code)}/settings`, { action, mode }),
  setPackageMode: (code: string, body: Record<string, boolean | string>) =>
    request<{ ok: true }>('PATCH', `/office/packages/${segment(code)}/mode`, body),
  setPackageDetails: (code: string, body: { dataGb: number | null; smsCount: number | null; minutes: number | null; details: string; suspendAfterDays?: number }) =>
    request<{ ok: true }>('PATCH', `/office/packages/${segment(code)}/details`, body),
  packageSheet: (code: string) => request<PackageSheet>('GET', `/office/packages/${segment(code)}/sheet`),
  setChain: (code: string, body: Partial<{
    branchCost: number;
    mainPrice: number;
    agentPrice: number;
    posPrice: number;
    subscriberPrice: number;
    renewalBranchCost: number;
    renewalMainPrice: number;
    renewalAgentPrice: number;
    renewalPosPrice: number;
    renewalSubscriberPrice: number;
    esimPrice: number | null;
  }>) =>
    request<{ ok: true }>('PATCH', `/office/packages/${segment(code)}/chain`, body),
  setPackageRenewals: (code: string, targets: string[]) =>
    request<{ ok: true }>('PUT', `/office/packages/${segment(code)}/renewals`, { targets }),
  setPackageSwitches: (code: string, targets: string[]) =>
    request<{ ok: true }>('PUT', `/office/packages/${segment(code)}/switches`, { targets }),
};
