import type { Prisma } from '../../generated/prisma/client';

/**
 * The notice writer's one query: the rows go in through the caller's transaction, so they are taken back with
 * everything else when it fails. A function in a file of its own, with no import of the unit of work: the unit of
 * work builds the notice writer, and the writer is built without a database in specs.
 */
export function insertNotices(tx: Prisma.TransactionClient, rows: Prisma.NoticeCreateManyInput[]) {
  return tx.notice.createMany({ data: rows });
}
