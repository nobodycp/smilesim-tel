import { z } from 'zod';

/** One notice by id; left out, every unread notice is marked. */
export const NoticeReadBody = z.object({ id: z.string().max(64).optional() });
export type NoticeReadBody = z.input<typeof NoticeReadBody>;
