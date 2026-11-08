import { request } from '../../lib/http';
import type { Directory, HomePayload, OverviewPayload, OfficeMe } from '../../lib/api-types';

/** The desk calls of the office API. Composed into `api` by lib/api.ts. */
export const deskApi = {
  officeMe: () => request<OfficeMe>('GET', '/office/me'),
  officeDirectory: () => request<{ names: Directory }>('GET', '/office/directory'),
  officeHome: () => request<HomePayload>('GET', '/office/home'),
  officeOverview: (period: string) => request<OverviewPayload>('GET', `/office/overview?period=${encodeURIComponent(period)}`),
  postAnnouncement: (body: string) => request<{ ok: true }>('POST', '/office/announcements', { body }),
};
