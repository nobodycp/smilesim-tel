import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import type { Prisma } from '../../generated/prisma/client';
import type { UnitOfWork } from '../platform/unit-of-work';
import { LinesRepository } from './lines.repository';

// PostgreSQL only (TEST_DATABASE_URL). `taskNoteSent` is the mark the settlement reads under the operation's lock
// (activation-settlement.ts, `tellUnknown`). Since DB.2 it filters the text key `payload->>'taskId'` that the
// index `Notice_kind_taskId` serves: these cases pin that it answers exactly what the Prisma JSON-path query it
// replaced answered, and that the planner can use the index for it. Everything runs in a rolled-back transaction.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Tx = Prisma.TransactionClient;
const ROLLBACK = new Error('rolled back on purpose');
const WORDS = 'the fixed words of the note';

suite('taskNoteSent (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const before = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  const repo = new LinesRepository(undefined as unknown as UnitOfWork);

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = before;
  });

  const scratch = (run: (tx: Tx) => Promise<void>) =>
    prisma.$transaction(async (tx) => {
      await run(tx);
      throw ROLLBACK;
    }, { timeout: 20_000 }).catch((error: unknown) => (error === ROLLBACK ? undefined : Promise.reject(error)));

  /** The query `taskNoteSent` sent until DB.2, kept here as the reference answer. */
  const previously = async (tx: Tx, taskId: string, words: string) =>
    (await tx.notice.findFirst({
      where: { kind: 'task.note', AND: [{ payload: { path: ['taskId'], equals: taskId } }, { payload: { path: ['excerpt'], equals: words } }] },
      select: { id: true },
    })) !== null;

  it('is true for a note on the task with those words, false for another task, kind or words, as before', async () => {
    await scratch(async (tx) => {
      const user = await tx.user.create({ data: { loginName: `tns-${randomUUID()}`, nickname: 'tns', passwordHash: 'x', layer: 'branch' } });
      const [told, other, otherKind, otherWords, numeric] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), String(Date.now())];
      const notice = (kind: string, payload: Prisma.InputJsonValue) => ({ userId: user.id, kind, payload, href: '/tasks/x' });
      await tx.notice.createMany({
        data: [
          notice('task.note', { taskId: told, excerpt: WORDS, action: 'activate' }),
          notice('task.note', { taskId: other, excerpt: WORDS }),
          notice('task.done', { taskId: otherKind, excerpt: WORDS }),
          notice('task.note', { taskId: otherWords, excerpt: 'other words' }),
          // A task id stored as a JSON number: the text key matches, the JSON equality (as before) does not.
          notice('task.note', { taskId: Number(numeric), excerpt: WORDS }),
        ],
      });
      const cases: [string, string, boolean][] = [
        [told, WORDS, true],
        [randomUUID(), WORDS, false],
        [otherKind, WORDS, false],
        [otherWords, WORDS, false],
        [told, 'other words', false],
        [numeric, WORDS, false],
      ];
      for (const [taskId, words, expected] of cases) {
        expect([taskId, words, await repo.taskNoteSent(tx, taskId, words)]).toEqual([taskId, words, expected]);
        expect(await previously(tx, taskId, words)).toBe(expected);
      }
      // The note on the other task answers for that task only.
      expect(await repo.taskNoteSent(tx, other, WORDS)).toBe(true);
    });
  });

  it('can be served by the index on the kind and the text key', async () => {
    await scratch(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const plan = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (COSTS OFF) SELECT 1 FROM "Notice" WHERE "kind" = 'task.note' AND "payload" ->> 'taskId' = $1 AND "payload" -> 'taskId' = to_jsonb($1::text) AND "payload" -> 'excerpt' = to_jsonb($2::text)`,
        randomUUID(), WORDS,
      );
      expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('Notice_kind_taskId');
    });
  });
});
