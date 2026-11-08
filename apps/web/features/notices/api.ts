import { request, queryString } from '../../lib/http';
import type { NoticeRow } from '../../lib/api-types';

/** The notices calls of the office API. Composed into `api` by lib/api.ts. */
export const noticesApi = {
  officeNotices: (query?: { cursor?: string | null; group?: string; unread?: boolean }) =>
    request<{ unread: number; notices: NoticeRow[]; nextCursor: string | null; total: number }>(
      'GET',
      `/office/notices${queryString({ cursor: query?.cursor ?? undefined, group: query?.group, unread: query?.unread ? '1' : undefined })}`,
    ),
  readNotices: (id?: string) => request<{ ok: true }>('POST', '/office/notices/read', id ? { id } : {}),
};
