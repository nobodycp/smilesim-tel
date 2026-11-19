import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client';
import { createPrismaClient } from '../../db';
import { purgeActivity } from '../auditing/activity-log';
import { purgeSessions } from '../auth/session-retention';
import { purgeNotices } from '../notifications/notice-retention';
import { purgeLineSnapshots } from '../reporting/desk/line-snapshot-retention';
import { ACTIVITY_RETENTION_DAYS, ENDED_SESSION_RETENTION_DAYS, LINE_SNAPSHOT_RETENTION_DAYS, READ_NOTICE_RETENTION_DAYS, UNREAD_NOTICE_RETENTION_DAYS, inBatches } from './retention';

// The office's retention in PostgreSQL (plan DB.13): the worker's daily purges of notices, sessions, line counts and
// activity events, with the clock handed in (never a sleep). The outbox's purge has its own spec, beside it
// (`providers/integration/operations/outbox-retention.db.spec.ts`). PostgreSQL only (see
// wallet-concurrency.db.spec.ts for how to give it one). Other files write these tables at the same time, so every
// test writes its rows and runs the purge inside one transaction that is rolled back: no other session sees its
// rows, and nothing it deleted stays deleted. Its clock is a day of the 1950s picked by the run, so the purge's
// cut-offs fall before every row any other file writes, and only this test's rows are old enough to go.

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

class RolledBack extends Error {}

describe('the batches of a purge', () => {
  it('runs bounded deletes until one removes fewer rows than its bound', async () => {
    const answers = [2, 2, 1];
    const asked: number[] = [];
    expect(await inBatches(async (limit) => (asked.push(limit), answers.shift() ?? 0), 2)).toBe(5);
    expect(asked).toEqual([2, 2, 2]);
    // An exact multiple ends with one statement that removes nothing.
    const exact = [2, 0];
    expect(await inBatches(async () => exact.shift() ?? 0, 2)).toBe(2);
    await expect(inBatches(async () => 0, 0)).rejects.toThrow(RangeError);
  });
});

suite('the office\'s retention in PostgreSQL: the daily purges (plan DB.13)', () => {
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

  /** An account of this run, inside the transaction: notices and sessions belong to one. */
  const account = async (tx: Prisma.TransactionClient) =>
    (await tx.user.create({ data: { loginName: `ret-${tag}-${randomUUID().slice(0, 6)}`, nickname: 'retention', passwordHash: 'x', layer: 'pos' }, select: { id: true } })).id;

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('deletes read notices after 180 days and unread ones after 365, in batches, and keeps the younger ones', async () => {
    expect([READ_NOTICE_RETENTION_DAYS, UNREAD_NOTICE_RETENTION_DAYS]).toEqual([180, 365]);
    const read = READ_NOTICE_RETENTION_DAYS * DAY;
    const unread = UNREAD_NOTICE_RETENTION_DAYS * DAY;
    await rolledBack(async (tx) => {
      const userId = await account(tx);
      const notice = (createdAt: Date, readAt: Date | null) => ({ id: randomUUID(), userId, kind: 'task_created', href: '/tasks', createdAt, readAt });
      const kept = [
        notice(ago(read - HOUR), ago(read - HOUR)), // read, 179 days 23 hours old
        notice(ago(read + DAY), null), // unread, 181 days old
        notice(ago(unread - HOUR), null), // unread, 364 days 23 hours old
      ];
      const gone = [
        // Three read past 180 days, purged two a statement: two statements.
        notice(ago(read + HOUR), ago(read + HOUR)),
        notice(ago(read + DAY), ago(2 * DAY)), // written long ago, read lately: its age is from when it was written
        notice(ago(unread + DAY), ago(unread)),
        // Two unread past a year: one full statement, then one that removes none.
        notice(ago(unread + HOUR), null),
        notice(ago(3 * unread), null),
      ];
      await tx.notice.createMany({ data: [...kept, ...gone] });

      expect(await purgeNotices(tx, now, 2)).toEqual({ read: 3, unread: 2 });
      const left = await tx.notice.findMany({ where: { userId }, select: { id: true } });
      expect(left.map((row) => row.id).sort()).toEqual(kept.map((row) => row.id).sort());
    });
  });

  it('deletes sessions revoked or expired more than 30 days ago, in batches, and keeps live and recently ended ones', async () => {
    expect(ENDED_SESSION_RETENTION_DAYS).toBe(30);
    const limit = ENDED_SESSION_RETENTION_DAYS * DAY;
    await rolledBack(async (tx) => {
      const userId = await account(tx);
      const session = (expiresAt: Date, revokedAt: Date | null) => ({
        id: randomUUID(), userId, userAgent: 'spec', ip: '192.0.2.1', scope: 'full', kind: 'account', tokenHash: randomUUID(), createdAt: ago(400 * DAY), lastSeenAt: ago(400 * DAY), expiresAt, revokedAt,
      });
      const kept = [
        session(new Date(now.getTime() + DAY), null), // live
        session(ago(limit - HOUR), null), // expired 29 days 23 hours ago
        session(new Date(now.getTime() + DAY), ago(limit - HOUR)), // revoked 29 days 23 hours ago, not yet expired
      ];
      const gone = [
        session(ago(limit + HOUR), null), // expired 30 days and an hour ago
        session(new Date(now.getTime() + DAY), ago(limit + HOUR)), // revoked 30 days and an hour ago
        session(ago(limit + DAY), ago(limit + DAY)),
      ];
      await tx.session.createMany({ data: [...kept, ...gone] });

      // Three past the limit, two a statement: two statements, the second removing one.
      expect(await purgeSessions(tx, now, 2)).toBe(3);
      const left = await tx.session.findMany({ where: { userId }, select: { id: true } });
      expect(left.map((row) => row.id).sort()).toEqual(kept.map((row) => row.id).sort());
    });
  });

  it('deletes the line counts of days more than 400 days ago, in batches, and keeps the later days', async () => {
    expect(LINE_SNAPSHOT_RETENTION_DAYS).toBe(400);
    const day = (daysAgo: number) => ago(daysAgo * DAY).toISOString().slice(0, 10);
    // The account is a made-up id: the table has no foreign key.
    const userId = `ret-${tag}`;
    await rolledBack(async (tx) => {
      const counts = { active: 1, expiring: 0, frozen: 0, disconnected: 0, suspended: 0 };
      const keptDays = [day(0), day(31), day(399)];
      const goneDays = [day(401), day(402), day(500), day(800), day(1200)];
      await tx.postpaidLineCountSnapshot.createMany({ data: [...keptDays, ...goneDays].map((value) => ({ userId, day: value, ...counts })) });

      // Five past the limit, two a statement: three statements.
      expect(await purgeLineSnapshots(tx, now, 2)).toBe(5);
      const left = await tx.postpaidLineCountSnapshot.findMany({ where: { userId }, select: { day: true }, orderBy: { day: 'desc' } });
      expect(left.map((row) => row.day)).toEqual(keptDays);
    });
  });

  it('deletes activity events older than 90 days, in batches, and keeps the younger ones', async () => {
    expect(ACTIVITY_RETENTION_DAYS).toBe(90);
    const limit = ACTIVITY_RETENTION_DAYS * DAY;
    await rolledBack(async (tx) => {
      const event = (at: Date) => ({ id: randomUUID(), at, action: 'login', result: 'ok', subjectKind: 'spec', subjectRef: tag });
      const kept = [event(ago(limit - HOUR)), event(now)];
      const gone = [event(ago(limit + HOUR)), event(ago(limit + DAY)), event(ago(4 * limit))];
      await tx.activityEvent.createMany({ data: [...kept, ...gone] });

      expect(await purgeActivity(tx, now, 2)).toBe(3);
      const left = await tx.activityEvent.findMany({ where: { subjectRef: tag }, select: { id: true } });
      expect(left.map((row) => row.id).sort()).toEqual(kept.map((row) => row.id).sort());
    });
  });
});
