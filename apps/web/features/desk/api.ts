import { request } from '../../lib/http';
import type { Directory, HomePayload, OfficeMe } from '../../lib/api-types';

/** The desk calls of the office API. Composed into `api` by lib/api.ts. */
export const deskApi = {
  officeMe: () => request<OfficeMe>('GET', '/office/me'),
  officeDirectory: () => request<{ names: Directory }>('GET', '/office/directory'),
  officeHome: () => request<HomePayload>('GET', '/office/home'),
  postAnnouncement: (body: string) => request<{ ok: true }>('POST', '/office/announcements', { body }),
};
