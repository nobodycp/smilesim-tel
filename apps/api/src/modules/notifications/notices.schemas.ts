import { NOTICES_PAGE, queryCursor, queryFlag, queryOneOf, queryText } from '../platform';
import { NOTICE_GROUPS } from './notice-kinds';
import { z } from 'zod';

/** One notice by id; left out, every unread notice is marked. */
export const NoticeReadBody = z.object({ id: z.string().max(64).optional() });
export type NoticeReadBody = z.input<typeof NoticeReadBody>;

/** How many rows one answer carries: a whole number from 1 to the inbox's page; left out, the full page. */
const noticeLimit = queryText(2).refine((value) => value === undefined || (/^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= NOTICES_PAGE));

/**
 * GET notices — the inbox's filters: one group of kinds, unread only. `limit` asks for fewer rows than the page (the
 * shell's bell shows ten); the counts are the same with or without it.
 */
export const NoticesQuery = z.object({
  cursor: queryCursor,
  group: queryOneOf(Object.keys(NOTICE_GROUPS) as (keyof typeof NOTICE_GROUPS)[]),
  unread: queryFlag,
  limit: noticeLimit,
});
export type NoticesQuery = z.input<typeof NoticesQuery>;
