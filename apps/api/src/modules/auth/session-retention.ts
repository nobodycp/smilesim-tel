import type { Prisma } from '../../generated/prisma/client';
import { ENDED_SESSION_RETENTION_DAYS, RETENTION_BATCH_ROWS, daysBefore, inBatches } from '../platform';

/**
 * The sessions' share of the worker's daily purge (plan DB.13): a session revoked, or expired, more than
 * `ENDED_SESSION_RETENTION_DAYS` ago, in statements of `batch` rows. Nothing reads such a row any more: the sessions
 * screens list unrevoked sessions with a live key only, a live key never outlasts `expiresAt` by more than the
 * minute `touchSession` lets the row lag, and the request log names a session's account when the request is
 * written, seconds after it came. Answers how many rows went.
 */
export function purgeSessions(db: Pick<Prisma.TransactionClient, '$executeRaw'>, now: Date = new Date(), batch: number = RETENTION_BATCH_ROWS): Promise<number> {
  const before = daysBefore(ENDED_SESSION_RETENTION_DAYS, now);
  return inBatches(
    (limit) => db.$executeRaw`DELETE FROM "Session" WHERE "id" IN (SELECT "id" FROM "Session" WHERE "revokedAt" < ${before} OR "expiresAt" < ${before} LIMIT ${limit})`,
    batch,
  );
}
