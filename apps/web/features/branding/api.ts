import { request } from '../../lib/http';
import type { BrandingBody, BrandingSummary } from '../../lib/api-types';

/** The branding calls of the office API. Composed into `api` by lib/api.ts. */
export const brandingApi = {
  branding: () => request<BrandingSummary>('GET', '/branding'),
  saveBranding: (body: BrandingBody) => request<BrandingSummary>('PUT', '/branding', body),
};
