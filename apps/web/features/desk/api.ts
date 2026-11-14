import { queryString, request } from '../../lib/http';
import type { DirectoryRow, HomePayload, Offer, OfferInput, OverviewPayload, DeskMe, Page } from '../../lib/api-types';

/** The desk calls of the office API. Composed into `api` by lib/api.ts. */
export const deskApi = {
  me: () => request<DeskMe>('GET', '/v1/me'),
  /** One page of the accounts the viewer may meet; `mine` keeps its own tree. Read whole through lib/directory.ts. */
  directory: (query?: { mine?: '1'; cursor?: string | null }) => request<Page<DirectoryRow>>('GET', `/v1/directory${queryString(query)}`),
  home: () => request<HomePayload>('GET', '/v1/home'),
  /** Offers (spec 2026-11-09, 1): the live ones for the home hero, and the «الإعلانات» page's management. */
  liveOffers: () => request<{ offers: Offer[] }>('GET', '/v1/offers/live'),
  offers: () => request<{ offers: Offer[]; capped?: boolean }>('GET', '/v1/offers'),
  addOffer: (body: OfferInput) => request<{ offers: Offer[] }>('POST', '/v1/offers', body),
  saveOffer: (id: string, body: OfferInput) => request<{ offers: Offer[] }>('PATCH', `/v1/offers/${encodeURIComponent(id)}`, body),
  moveOffer: (id: string, direction: 'up' | 'down') => request<{ offers: Offer[] }>('POST', `/v1/offers/${encodeURIComponent(id)}/move`, { direction }),
  removeOffer: (id: string) => request<{ offers: Offer[] }>('DELETE', `/v1/offers/${encodeURIComponent(id)}`),
  overview: (period: string) => request<OverviewPayload>('GET', `/v1/overview?period=${encodeURIComponent(period)}`),
};
