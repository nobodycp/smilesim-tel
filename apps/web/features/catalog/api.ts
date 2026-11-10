import { queryString, request, segment } from '../../lib/http';
import type { NewPackage, PackageAddon, PackageRow, PackageSheet, ProviderCatalogCompany, ProviderCatalogProduct, ProviderRow, ProviderSettings, Shelf, SimRules } from '../../lib/api-types';

/** The catalog calls of the office API. Composed into `api` by lib/api.ts. */
export const catalogApi = {
  officePackages: () => request<{ packages: PackageRow[]; companies: { name: string; image: string }[]; capped?: boolean }>('GET', '/office/packages'),
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
  setPackageDetails: (code: string, body: { dataGb: number | null; smsCount: number | null; minutes: number | null; details: string; suspendAfterDays?: number; esimAvailable?: boolean }) =>
    request<{ ok: true }>('PATCH', `/office/packages/${segment(code)}/details`, body),
  packageAddons: (code: string) => request<{ addons: PackageAddon[] }>('GET', `/office/packages/${segment(code)}/addons`),
  addPackageAddon: (code: string, body: { name: string; price: number }) => request<{ addons: PackageAddon[] }>('POST', `/office/packages/${segment(code)}/addons`, body),
  savePackageAddon: (code: string, id: string, body: Partial<Pick<PackageAddon, 'name' | 'price' | 'active' | 'position'>>) =>
    request<{ addons: PackageAddon[] }>('PATCH', `/office/packages/${segment(code)}/addons/${segment(id)}`, body),
  removePackageAddon: (code: string, id: string) => request<{ addons: PackageAddon[] }>('DELETE', `/office/packages/${segment(code)}/addons/${segment(id)}`),
  // Adding from the provider (spec 2026-11-09-admin-review, 3): query, then add.
  providerCatalogCompanies: (code: string) =>
    request<{ simulated: boolean; companies: ProviderCatalogCompany[] }>('GET', `/office/providers/${segment(code)}/catalog/companies`),
  providerCatalogProducts: (code: string, company: string) =>
    request<{ simulated: boolean; products: ProviderCatalogProduct[] }>('GET', `/office/providers/${segment(code)}/catalog/products${queryString({ company })}`),
  createCompany: (body: { providerCode: string; companyCode: string; name: string; simLength: number | null; simPrefix: string; esim: boolean; esimPrice: number }) =>
    request<{ ok: true; code: string }>('POST', '/office/companies', body),
  createPackage: (body: NewPackage) => request<{ ok: true; code: string; companyCode: string }>('POST', '/office/packages', body),
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
