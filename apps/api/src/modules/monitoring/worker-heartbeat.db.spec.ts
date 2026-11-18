import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import { UnitOfWork } from '../platform/unit-of-work';
import type { NoticeWriter } from '../platform/notices';
import { StatusRepository } from './status.repository';
import { startHeartbeat } from './worker-heartbeat';

// The worker's heartbeat and the status's reads of PostgreSQL (system monitor M.5). PostgreSQL only. Other files
// may write heartbeats beside this one, so only this file's own worker row is asked about, and the latest beat of
// the table is read as at most as old as this file's.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the worker heartbeat in PostgreSQL', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  let repo: StatusRepository;
  const workerId = `hb-${randomUUID()}`;
  const row = () => prisma.workerHeartbeat.findUnique({ where: { workerId } });

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const uow = new UnitOfWork({} as NoticeWriter);
    uow.prismaClient = prisma;
    repo = new StatusRepository(uow);
  });

  afterAll(async () => {
    await prisma.workerHeartbeat.deleteMany({ where: { workerId: { startsWith: 'hb-' } } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('beats at once and on its timer by the database\'s clock, and beats no more once stopped', async () => {
    const heartbeat = startHeartbeat(prisma, workerId, 200);
    await heartbeat.beat();
    const first = await row();
    expect(first).not.toBeNull();
    // The worker's own Node.js, for the versions page (M.11).
    expect(first?.nodeVersion).toBe(process.version);
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`;
    expect(Math.abs(now.getTime() - (first?.beatAt.getTime() ?? 0))).toBeLessThan(5_000);
    // The timer's next beat, however long its statements take on this machine (a beat may open a connection of its
    // own: on CI one was still in flight after a fixed 600 ms). Waited for, at most 5 s; never assumed.
    let later = await row();
    for (const until = Date.now() + 5_000; Date.now() < until && (later?.beatAt.getTime() ?? 0) <= (first?.beatAt.getTime() ?? 0); later = await row()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(later?.beatAt.getTime()).toBeGreaterThan(first?.beatAt.getTime() ?? 0);
    expect(later?.startedAt.getTime()).toBe(first?.startedAt.getTime());
    await heartbeat.stop();
    const stopped = await row();
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Left to go stale: the row stays, its time no longer moves.
    expect((await row())?.beatAt.getTime()).toBe(stopped?.beatAt.getTime());
    await heartbeat.beat();
    expect((await row())?.beatAt.getTime()).toBe(stopped?.beatAt.getTime());
  });

  it('the status reads the latest beat\'s age on the database\'s clock, and a day-old row is removed by any beat', async () => {
    const old = `hb-old-${randomUUID()}`;
    await prisma.$executeRaw`INSERT INTO "WorkerHeartbeat" ("workerId", "startedAt", "beatAt") VALUES (${old}, now() - interval '2 days', now() - interval '25 hours')`;
    const heartbeat = startHeartbeat(prisma, workerId, 60_000);
    await heartbeat.beat();
    await heartbeat.stop();
    expect(await prisma.workerHeartbeat.findUnique({ where: { workerId: old } })).toBeNull();
    const read = await repo.heartbeat();
    expect(read.workers).toBeGreaterThanOrEqual(1);
    expect(read.lastBeatAgeS).not.toBeNull();
    expect(read.lastBeatAgeS as number).toBeLessThan(5);
  });

  it('reads the database\'s figures and finds every migration the build carries applied', async () => {
    await repo.ping();
    const database = await repo.database();
    expect(database.connections).toBeGreaterThan(0);
    expect(database.sizeBytes).toBeGreaterThan(0);
    const outbox = await repo.outbox();
    expect(outbox.unpublished).toBeGreaterThanOrEqual(0);
    const [carried, applied] = await Promise.all([repo.carriedMigrations(), repo.appliedMigrations()]);
    expect(carried).toContain('20261117120000_worker_heartbeat');
    expect(carried.filter((name) => !applied.includes(name))).toEqual([]);
  });
});
