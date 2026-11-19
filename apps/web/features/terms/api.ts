import { request, segment } from '../../lib/http';
import type { CustomPriceRow, LinePriceChange, LinePrices, UserOps, UserPackageRow, UserPackagesSheet, UserPackagesSummary } from '../../lib/api-types';

/** The terms calls of the office API. Composed into `api` by lib/api.ts. */
export const termsApi = {
  linePrices: (code: string, scope: string) =>
    request<LinePrices>('GET', `/v1/postpaid/packages/${segment(code)}/line-prices?scope=${encodeURIComponent(scope)}`),
  setLinePrices: (code: string, scope: string, groups: LinePriceChange[]) =>
    request<{ ok: true; lines: number }>('PUT', `/v1/postpaid/packages/${segment(code)}/line-prices`, { scope, groups }),
  customPrices: (code: string) => request<CustomPriceRow[]>('GET', `/v1/postpaid/packages/${segment(code)}/custom-prices`),
  setCustomPrice: (code: string, loginName: string, body: { price?: number | null; renewalPrice?: number | null }) =>
    request<CustomPriceRow>('PUT', `/v1/postpaid/packages/${segment(code)}/custom-prices/${segment(loginName)}`, body),
  clearCustomPrice: (code: string, loginName: string) =>
    request<{ ok: true }>('DELETE', `/v1/postpaid/packages/${segment(code)}/custom-prices/${segment(loginName)}`),
  userPackages: (loginName: string) => request<UserPackagesSheet>('GET', `/v1/postpaid/users/${segment(loginName)}/packages`),
  setUserPackage: (loginName: string, code: string, body: { hidden?: boolean; price?: number | null; renewalPrice?: number | null }) =>
    request<UserPackageRow>('PUT', `/v1/postpaid/users/${segment(loginName)}/packages/${segment(code)}`, body),
  setUserPackagesBulk: (loginName: string, codes: string[], hidden: boolean) =>
    request<{ summary: UserPackagesSummary }>('PUT', `/v1/postpaid/users/${segment(loginName)}/packages`, { codes, hidden }),
  userOps: (loginName: string) => request<UserOps>('GET', `/v1/postpaid/users/${segment(loginName)}/ops`),
  setUserOps: (loginName: string, denied: string[]) => request<UserOps>('PUT', `/v1/postpaid/users/${segment(loginName)}/ops`, { denied }),
};
