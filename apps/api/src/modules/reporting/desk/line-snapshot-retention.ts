import type { Prisma } from '../../../generated/prisma/client';
import { LINE_SNAPSHOT_RETENTION_DAYS, RETENTION_BATCH_ROWS, daysBefore, inBatches } from '../../platform';

/**
 * The line counts' share of the worker's daily purge (plan DB.13): an account's counts of a UTC day more than
 * `LINE_SNAPSHOT_RETENTION_DAYS` ago, in statements of `batch` rows, by `LineCountSnapshot(day)`. The home's change
 * compares with the last snapshot before today or before this month (`OverviewService.lineChange`), so at most
 * about 31 days back. Answers how many rows went.
 */
export function purgeLineSnapshots(db: Pick<Prisma.TransactionClient, '$executeRaw'>, now: Date = new Date(), batch: number = RETENTION_BATCH_ROWS): Promise<number> {
  // The day is stored as `YYYY-MM-DD`, which orders as the dates do.
  const before = daysBefore(LINE_SNAPSHOT_RETENTION_DAYS, now).toISOString().slice(0, 10);
  return inBatches(
    (limit) => db.$executeRaw`DELETE FROM "PostpaidLineCountSnapshot" WHERE ("userId", "day") IN (SELECT "userId", "day" FROM "PostpaidLineCountSnapshot" WHERE "day" < ${before} LIMIT ${limit})`,
    batch,
  );
}
