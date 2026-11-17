import type { Prisma } from '../../generated/prisma/client';
import { ACTIVITY_RETENTION_DAYS, RETENTION_BATCH_ROWS, daysBefore, inBatches } from '../platform';

// The actions an event may name are the platform's (`platform/activity.ts`): every module records through the port.
export { ACTIVITY_ACTIONS, type ActivityAction } from '../platform';

/** The moment before which activity events are purged: `ACTIVITY_RETENTION_DAYS` (`platform/retention.ts`) ago. */
export function purgeBefore(now: Date = new Date()): Date {
  return daysBefore(ACTIVITY_RETENTION_DAYS, now);
}

/**
 * The worker's daily purge: activity events older than the retention window, and nothing else, in statements of
 * `batch` rows (plan DB.13), so a backlog after downtime is never one statement over weeks of rows. The permanent
 * record of decisions on provider operations (`ProviderDecisionEvent`, ADR 0019 D15) is another table, which this
 * never names; the database refuses a delete there in any case. Answers how many events were removed.
 */
export function purgeActivity(db: Pick<Prisma.TransactionClient, '$executeRaw'>, now: Date = new Date(), batch: number = RETENTION_BATCH_ROWS): Promise<number> {
  const before = purgeBefore(now);
  return inBatches(
    (limit) => db.$executeRaw`DELETE FROM "ActivityEvent" WHERE "id" IN (SELECT "id" FROM "ActivityEvent" WHERE "at" < ${before} LIMIT ${limit})`,
    batch,
  );
}

/** Dates outside the retention window are pulled back inside it. */
export function clampActivityRange(from: Date | null, to: Date | null, now: Date = new Date()): { gte: Date; lte: Date } {
  const start = purgeBefore(now);
  const gte = !from || Number.isNaN(from.getTime()) || from < start ? start : from;
  let lte = !to || Number.isNaN(to.getTime()) || to > now ? now : to;
  if (lte < gte) lte = gte;
  return { gte, lte };
}

/**
 * Branch sees every row, including unknown-login failures (`actorId` null).
 * Any other layer sees rows whose actor is in `visibleIds` only.
 */
export function activityActorFilter(layer: string, visibleIds: string[]): { actorId?: { in: string[] } | null; OR?: Array<{ actorId: { in: string[] } | null }> } {
  if (layer === 'branch') return {};
  return { actorId: { in: visibleIds } };
}
