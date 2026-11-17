import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import { createPrismaClient } from '../../db';
import { purgeMonitoring } from './retention';
import { CLOSED_ALERT_RETENTION_DAYS, REQUEST_LOG_RETENTION_DAYS } from './thresholds';

// The system monitor's retention in PostgreSQL (slice M.8): the purge the worker runs daily, with its clock handed
// in (never a sleep). PostgreSQL only (see wallet-concurrency.db.spec.ts for how to give it one). Other files write
// these tables at the same time (the app's middleware, request-log.db.spec.ts on days of the 2000s, alerts.db.spec.ts
// on days of the 1980s, whose rounds close any open alert quiet for 30 minutes). So every test here writes its rows
// and runs the purge inside one transaction that is rolled back: no other session sees its rows (none can close its
// open alert), and nothing it deleted stays deleted. Its clock is a day of the 1950s picked by the run, so the
// purge's cut-offs fall before every row any other file writes.

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

class RolledBack extends Error {}

suite('the system monitor\'s retention in PostgreSQL: the daily purge', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  let prisma: ReturnType<typeof createPrismaClient>;
  const now = new Date(Date.parse('1950-01-01T08:00:00.000Z') + (Number.parseInt(tag, 16) % 3650) * DAY);
  const ago = (ms: number) => new Date(now.getTime() - ms);

  /** Runs `body` in a transaction and rolls it back, whatever it did; a failed expectation inside still fails. */
  const rolledBack = async (body: (tx: Prisma.TransactionClient) => Promise<void>) => {
    await prisma
      .$transaction(async (tx) => {
        await body(tx);
        throw new RolledBack();
      }, { timeout: 30_000 })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });
  };

  let serial = 0;
  const request = (at: Date) => ({
    id: randomUUID(), at, durationMs: 5, method: 'GET', route: `/t-${tag}/a`, path: `/t-${tag}/a`, status: 200, requestId: `${tag}-${(serial += 1)}`,
  });
  const error = (at: Date) => ({ id: randomUUID(), requestId: `${tag}-e${(serial += 1)}`, at, method: 'GET', route: `/t-${tag}/a`, name: 'TypeError', message: 'unclassified' });
  const alert = (state: 'open' | 'closed', lastAt: Date) => ({
    id: randomUUID(), kind: 'probing', key: `${tag}-${(serial += 1)}`, state, ip: '192.0.2.9', count: 30,
    firstAt: new Date(lastAt.getTime() - HOUR), lastAt, closedAt: state === 'closed' ? new Date(lastAt.getTime() + 30 * 60_000) : null,
  });

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('deletes requests and server errors older than 14 days, in batches, and keeps the younger ones', async () => {
    expect(REQUEST_LOG_RETENTION_DAYS).toBe(14);
    const limit = REQUEST_LOG_RETENTION_DAYS * DAY;
    await rolledBack(async (tx) => {
      const kept = request(ago(limit - HOUR)); // 13 days 23 hours
      // Four past the limit, purged two a statement: three statements, the last removing none.
      const gone = [request(ago(limit + HOUR)), request(ago(limit + 2 * HOUR)), request(ago(limit + DAY)), request(ago(400 * DAY))];
      await tx.requestLog.createMany({ data: [kept, ...gone] });
      const keptError = error(ago(limit - HOUR));
      const goneError = error(ago(limit + HOUR));
      await tx.requestError.createMany({ data: [keptError, goneError] });

      const purged = await purgeMonitoring(tx, now, 2);

      expect(purged).toEqual({ requests: 4, errors: 1, alerts: 0 });
      const left = await tx.requestLog.findMany({ where: { id: { in: [kept, ...gone].map((row) => row.id) } }, select: { id: true } });
      expect(left).toEqual([{ id: kept.id }]);
      const leftErrors = await tx.requestError.findMany({ where: { id: { in: [keptError.id, goneError.id] } }, select: { id: true } });
      expect(leftErrors).toEqual([{ id: keptError.id }]);
    });
  });

  it('deletes closed alerts older than 90 days and never an open one, however old', async () => {
    expect(CLOSED_ALERT_RETENTION_DAYS).toBe(90);
    await rolledBack(async (tx) => {
      const closedOld = alert('closed', ago(91 * DAY));
      const closedYoung = alert('closed', ago(89 * DAY));
      const openOld = alert('open', ago(200 * DAY));
      await tx.alert.createMany({ data: [closedOld, closedYoung, openOld] });

      const purged = await purgeMonitoring(tx, now);

      expect(purged).toEqual({ requests: 0, errors: 0, alerts: 1 });
      const left = await tx.alert.findMany({ where: { id: { in: [closedOld.id, closedYoung.id, openOld.id] } }, select: { id: true, state: true }, orderBy: { lastAt: 'asc' } });
      expect(left).toEqual([{ id: openOld.id, state: 'open' }, { id: closedYoung.id, state: 'closed' }]);
    });
  });

  it('leaves nothing behind: the rows of the tests above were rolled back', async () => {
    expect(await prisma.requestLog.count({ where: { requestId: { startsWith: `${tag}-` } } })).toBe(0);
    expect(await prisma.alert.count({ where: { key: { startsWith: `${tag}-` } } })).toBe(0);
  });
});
