import { request, queryString } from '../../lib/http';
import type { NoticeRow, Page } from '../../lib/api-types';

/** The notices calls of the office API. Composed into `api` by lib/api.ts. */
export const noticesApi = {
  // `limit` (1–40) asks for fewer rows than the inbox page: the shell's bell asks for the ten it shows.
  notices: (query?: { cursor?: string | null; group?: string; unread?: boolean; limit?: number }) =>
    request<Page<NoticeRow> & { unread: number }>(
      'GET',
      `/v1/notices${queryString({
        cursor: query?.cursor ?? undefined,
        group: query?.group,
        unread: query?.unread ? '1' : undefined,
        limit: query?.limit ? String(query.limit) : undefined,
      })}`,
    ),
  readNotices: (id?: string) => request<{ ok: true }>('POST', '/v1/notices/read', id ? { id } : {}),
};
