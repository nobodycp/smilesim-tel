import type { Prisma } from '../../generated/prisma/client';
import { CLOSED_ALERT_RETENTION_DAYS, PURGE_BATCH_ROWS, REQUEST_LOG_RETENTION_DAYS } from './thresholds';

const DAY_MS = 24 * 60 * 60 * 1000;

export type MonitoringPurge = { requests: number; errors: number; alerts: number };

/** The moments before which each table's rows are deleted. */
export function monitoringPurgeBefore(now: Date = new Date()): { requests: Date; alerts: Date } {
  return {
    requests: new Date(now.getTime() - REQUEST_LOG_RETENTION_DAYS * DAY_MS),
    alerts: new Date(now.getTime() - CLOSED_ALERT_RETENTION_DAYS * DAY_MS),
  };
}

/** Runs one bounded delete until it removes fewer rows than its bound; answers the rows removed in all. */
async function inBatches(deleteSome: (limit: number) => Promise<number>, batch: number): Promise<number> {
  let removed = 0;
  for (;;) {
    const count = await deleteSome(batch);
    removed += count;
    if (count < batch) return removed;
  }
}

/**
 * The system monitor's share of the worker's daily purge (spec D2, slice M.8), called beside `purgeActivity`:
 * requests and server errors older than `REQUEST_LOG_RETENTION_DAYS`, in statements of `batch` rows (see
 * `PURGE_BATCH_ROWS`), and closed alerts whose last event is older than `CLOSED_ALERT_RETENTION_DAYS`, in one
 * statement (one row an incident: few). An open alert is never deleted. Names these three tables alone; answers
 * the three counts. The clock is handed in.
 */
export async function purgeMonitoring(db: Pick<Prisma.TransactionClient, '$executeRaw'>, now: Date = new Date(), batch: number = PURGE_BATCH_ROWS): Promise<MonitoringPurge> {
  const before = monitoringPurgeBefore(now);
  const requests = await inBatches(
    (limit) => db.$executeRaw`DELETE FROM "RequestLog" WHERE "id" IN (SELECT "id" FROM "RequestLog" WHERE "at" < ${before.requests} LIMIT ${limit})`,
    batch,
  );
  const errors = await inBatches(
    (limit) => db.$executeRaw`DELETE FROM "RequestError" WHERE "id" IN (SELECT "id" FROM "RequestError" WHERE "at" < ${before.requests} LIMIT ${limit})`,
    batch,
  );
  const alerts = await db.$executeRaw`DELETE FROM "Alert" WHERE "state" = 'closed' AND "lastAt" < ${before.alerts}`;
  return { requests, errors, alerts };
}
