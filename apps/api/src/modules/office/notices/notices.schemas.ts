import { queryCursor, queryFlag, queryOneOf } from '../../shared/schemas';
import { NOTICE_GROUPS } from './notice-kinds';
import { z } from 'zod';

/** One notice by id; left out, every unread notice is marked. */
export const NoticeReadBody = z.object({ id: z.string().max(64).optional() });
export type NoticeReadBody = z.input<typeof NoticeReadBody>;

/** GET notices — the inbox's filters: one group of kinds, unread only. */
export const NoticesQuery = z.object({
  cursor: queryCursor,
  group: queryOneOf(Object.keys(NOTICE_GROUPS) as (keyof typeof NOTICE_GROUPS)[]),
  unread: queryFlag,
});
export type NoticesQuery = z.input<typeof NoticesQuery>;
