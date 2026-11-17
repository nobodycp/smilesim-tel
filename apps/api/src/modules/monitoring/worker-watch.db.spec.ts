import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import { NoticeService, type NoticeBus } from '../notifications/notice.service';
import { UnitOfWork } from '../platform/unit-of-work';
import { AlertPass, type PartsProbe } from './alert-pass';
import { AlertRepository } from './alert.repository';
import { WORKER_DOWN_AFTER_S } from './thresholds';
import { WorkerWatch, startWorkerWatch, type HeartbeatReader } from './worker-watch';

// The API's watch on the worker in PostgreSQL (system monitor M.9): its looks against the real alerts table and the
// pass's own opening, with the clock, the heartbeat and the API's uptime handed in (never the shared
// `WorkerHeartbeat` table, which other files and their workers write). PostgreSQL only (see
// wallet-concurrency.db.spec.ts for how to give it one).
//
// "A service is down" for `worker` has one key for the whole database, so this file is the only one that may open
// it: its clock is a day of the 1990s picked by the run, later than every day of alerts.db.spec.ts (the 1980s),
// whose rounds close only alerts quiet for 30 minutes before its own clock, so never one of these; and the pass this
// file races reads only this file's day's open alerts, so it closes nothing of the others. The notices go to this
// file's own owner alone, as in alerts.db.spec.ts (the real audience is every branch owner of the shared database).

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the API watches the worker: a stopped worker opens "a service is down", once', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ownerId = randomUUID();
  let prisma: ReturnType<typeof createPrismaClient>;
  let uow: UnitOfWork;
  let repo: AlertRepository;

  const day = new Date(Date.parse('1990-01-01T00:00:00.000Z') + (Number.parseInt(tag, 16) % 3650) * 86_400_000).toISOString().slice(0, 10);
  const base = Date.parse(`${day}T08:00:00.000Z`);
  /** `minutes` after 08:00 of this file's day. */
  const at = (minutes: number) => new Date(base + minutes * 60_000);
  const dayRange = { gte: new Date(`${day}T00:00:00.000Z`), lte: new Date(`${day}T23:59:59.999Z`) };
  /** Every worker alert this file may have left, on any day of the 1990s. */
  const nineties = { gte: new Date('1990-01-01T00:00:00.000Z'), lt: new Date('2000-01-01T00:00:00.000Z') };

  let beat: { lastBeatAgeS: number | null } = { lastBeatAgeS: 5 };
  const heartbeat: HeartbeatReader = async () => ({ ...beat });
  let uptimeS = 3600;
  const watch = () => new WorkerWatch(repo, uow, heartbeat, () => uptimeS);

  const workerAlerts = () => prisma.alert.findMany({ where: { kind: 'service_down', key: 'worker', firstAt: nineties }, orderBy: { createdAt: 'asc' } });
  const notices = () => prisma.notice.findMany({ where: { userId: ownerId, kind: 'system.alert' } });
  const clearOwn = async () => {
    await prisma.alert.deleteMany({ where: { OR: [{ kind: 'service_down', key: 'worker', firstAt: nineties }, { firstAt: dayRange }] } });
    await prisma.notice.deleteMany({ where: { userId: ownerId } });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    await prisma.user.create({ data: { id: ownerId, loginName: `ww-${tag}-owner`, nickname: 'owner', passwordHash: 'x', layer: 'branch', isBranchOwner: true } });
    const bus: NoticeBus = { publish: async () => undefined, subscribe: async () => async () => undefined };
    uow = new UnitOfWork(new NoticeService(bus));
    uow.prismaClient = prisma;
    repo = new AlertRepository(uow);
    repo.branchOwners = (async () => [{ id: ownerId }]) as unknown as AlertRepository['branchOwners'];
  });

  beforeEach(async () => {
    await clearOwn();
    beat = { lastBeatAgeS: 5 };
    uptimeS = 3600;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await clearOwn();
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('opens nothing while the worker beats, nor while it is only late (warn)', async () => {
    expect(await watch().check(at(0))).toBe('none');
    beat = { lastBeatAgeS: WORKER_DOWN_AFTER_S };
    expect(await watch().check(at(1))).toBe('none');
    expect(await workerAlerts()).toEqual([]);
    expect(await notices()).toEqual([]);
  });

  it('opens nothing in the API\'s first minutes when no worker ever beat, and opens once the API has waited the down limit', async () => {
    beat = { lastBeatAgeS: null };
    uptimeS = 20;
    expect(await watch().check(at(0))).toBe('none');
    uptimeS = WORKER_DOWN_AFTER_S - 1;
    expect(await watch().check(at(1))).toBe('none');
    expect(await workerAlerts()).toEqual([]);
    uptimeS = WORKER_DOWN_AFTER_S;
    expect(await watch().check(at(2))).toBe('opened');
    expect((await workerAlerts()).map(({ state, part, firstAt, lastAt }) => ({ state, part, firstAt, lastAt }))).toEqual([
      { state: 'open', part: 'worker', firstAt: new Date(at(2).getTime() - WORKER_DOWN_AFTER_S * 1000), lastAt: at(2) },
    ]);
  });

  it('two API copies and the worker\'s own pass racing open one alert, and the owner hears of it once', async () => {
    beat = { lastBeatAgeS: 600 };
    // The pass has seen the worker down for its 2 minutes (a worker whose heartbeat stopped while its pass still ran).
    const probe: PartsProbe = async () => ({ worker: true, postgres: false, redis: false, outbox: false });
    const ownDay = new AlertRepository(uow);
    ownDay.branchOwners = repo.branchOwners;
    ownDay.openAlerts = () => prisma.alert.findMany({ where: { state: 'open', firstAt: dayRange }, select: { id: true, kind: true, key: true, count: true, lastAt: true } });
    const pass = new AlertPass(ownDay, uow, probe);
    await pass.round(at(10));
    const [first, second, round] = await Promise.all([watch().check(at(12)), watch().check(at(12)), pass.round(at(12))]);
    const opened = [first === 'opened', second === 'opened', round.opened === 1].filter(Boolean);
    expect(opened).toHaveLength(1);
    const alerts = await workerAlerts();
    expect(alerts.map(({ kind, key, part, state }) => ({ kind, key, part, state }))).toEqual([{ kind: 'service_down', key: 'worker', part: 'worker', state: 'open' }]);
    const told = await notices();
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ href: `/system/alerts?id=${alerts[0].id}`, payload: { alertId: alerts[0].id, alertKind: 'service_down', part: 'worker' } });
  });

  it('while the worker stays down each look raises the alert\'s last time, with no second notice; it never closes it', async () => {
    beat = { lastBeatAgeS: 300 };
    expect(await watch().check(at(0))).toBe('opened');
    const [opened] = await workerAlerts();
    expect(opened).toMatchObject({ count: 1, lastAt: at(0), firstAt: new Date(at(0).getTime() - 300_000) });
    beat = { lastBeatAgeS: 330 };
    expect(await watch().check(at(0.5))).toBe('raised');
    // The same look again sees nothing later than the alert: nothing changes.
    expect(await watch().check(at(0.5))).toBe('none');
    // An hour later, still down: still the same open alert, raised; the watch never closes.
    beat = { lastBeatAgeS: 3930 };
    expect(await watch().check(at(60.5))).toBe('raised');
    expect(await workerAlerts()).toEqual([expect.objectContaining({ id: opened.id, state: 'open', count: 3, lastAt: at(60.5), firstAt: opened.firstAt })]);
    // Back: the watch does nothing, the alert stays open for the pass to close after its quiet minutes.
    beat = { lastBeatAgeS: 4 };
    expect(await watch().check(at(61))).toBe('none');
    expect((await workerAlerts())[0].state).toBe('open');
    expect(await notices()).toHaveLength(1);
  });

  it('runs on its timer one look at a time; a failing look logs a known code and never throws; a stop waits for the look in flight', async () => {
    const warned: string[] = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => void warned.push(String(message)));
    let release: () => void = () => undefined;
    let looks = 0;
    const slow = { check: () => { looks += 1; return new Promise<'none'>((resolve) => { release = () => resolve('none'); }); } };
    const running = startWorkerWatch(slow, 20);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(looks).toBe(1);
    let stopped = false;
    const stopping = running.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stopped).toBe(false);
    release();
    await stopping;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(looks).toBe(1);
    // The database refuses: a code, never the error's words, and the next tick looks again.
    let failures = 0;
    const broken = { check: async () => { failures += 1; throw Object.assign(new Error('password=hunter2 host=db'), { code: 'P1001' }); } };
    const again = startWorkerWatch(broken, 20);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await again.stop();
    expect(failures).toBeGreaterThan(1);
    expect(warned.length).toBeGreaterThan(1);
    expect(new Set(warned)).toEqual(new Set(['worker watch failed: P1001']));
  });
});
