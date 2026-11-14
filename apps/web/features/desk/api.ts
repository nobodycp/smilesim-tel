import { queryString, request } from '../../lib/http';
import type { DirectoryRow, HomePayload, Offer, OfferInput, OverviewPayload, DeskMe, Page } from '../../lib/api-types';

/** The desk calls of the office API. Composed into `api` by lib/api.ts. */
export const deskApi = {
  me: () => request<DeskMe>('GET', '/office/me'),
  /** One page of the accounts the viewer may meet; `mine` keeps its own tree. Read whole through lib/directory.ts. */
  directory: (query?: { mine?: '1'; cursor?: string | null }) => request<Page<DirectoryRow>>('GET', `/office/directory${queryString(query)}`),
  home: () => request<HomePayload>('GET', '/office/home'),
  /** Offers (spec 2026-11-09, 1): the live ones for the home hero, and the «الإعلانات» page's management. */
  liveOffers: () => request<{ offers: Offer[] }>('GET', '/office/offers/live'),
  offers: () => request<{ offers: Offer[]; capped?: boolean }>('GET', '/office/offers'),
  addOffer: (body: OfferInput) => request<{ offers: Offer[] }>('POST', '/office/offers', body),
  saveOffer: (id: string, body: OfferInput) => request<{ offers: Offer[] }>('PATCH', `/office/offers/${encodeURIComponent(id)}`, body),
  moveOffer: (id: string, direction: 'up' | 'down') => request<{ offers: Offer[] }>('POST', `/office/offers/${encodeURIComponent(id)}/move`, { direction }),
  removeOffer: (id: string) => request<{ offers: Offer[] }>('DELETE', `/office/offers/${encodeURIComponent(id)}`),
  overview: (period: string) => request<OverviewPayload>('GET', `/office/overview?period=${encodeURIComponent(period)}`),
};
