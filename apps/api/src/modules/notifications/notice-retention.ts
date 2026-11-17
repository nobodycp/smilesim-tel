import type { Prisma } from '../../generated/prisma/client';
import { READ_NOTICE_RETENTION_DAYS, RETENTION_BATCH_ROWS, UNREAD_NOTICE_RETENTION_DAYS, daysBefore, inBatches } from '../platform';

export type NoticePurge = { read: number; unread: number };

/**
 * The notices' share of the worker's daily purge (plan DB.13): a read notice written more than
 * `READ_NOTICE_RETENTION_DAYS` ago, and any notice written more than `UNREAD_NOTICE_RETENTION_DAYS` ago (by then
 * only unread ones are left), in statements of `batch` rows. Both walk `Notice(createdAt)`. Answers the counts.
 */
export async function purgeNotices(db: Pick<Prisma.TransactionClient, '$executeRaw'>, now: Date = new Date(), batch: number = RETENTION_BATCH_ROWS): Promise<NoticePurge> {
  const readBefore = daysBefore(READ_NOTICE_RETENTION_DAYS, now);
  const unreadBefore = daysBefore(UNREAD_NOTICE_RETENTION_DAYS, now);
  const read = await inBatches(
    (limit) => db.$executeRaw`DELETE FROM "Notice" WHERE "id" IN (SELECT "id" FROM "Notice" WHERE "createdAt" < ${readBefore} AND "readAt" IS NOT NULL LIMIT ${limit})`,
    batch,
  );
  const unread = await inBatches(
    (limit) => db.$executeRaw`DELETE FROM "Notice" WHERE "id" IN (SELECT "id" FROM "Notice" WHERE "createdAt" < ${unreadBefore} LIMIT ${limit})`,
    batch,
  );
  return { read, unread };
}
