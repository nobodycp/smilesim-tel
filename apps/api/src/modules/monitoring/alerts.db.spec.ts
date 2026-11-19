import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../db';
import { NoticeService, type NoticeBus } from '../notifications/notice.service';
import { UnitOfWork } from '../platform/unit-of-work';
import { DeskRepository } from '../reporting/desk/desk.repository';
import type { Actor } from '../access/types';
import { AlertPass, startAlertPass, type PartsProbe } from './alert-pass';
import { AlertRepository } from './alert.repository';
import { AlertsService } from './alerts.service';
import { ALERT_QUIET_MINUTES, CRACKING_FAILS, PROBING_ANSWERS } from './thresholds';

// The alerts in PostgreSQL (system monitor M.6): the pass over real rows of the request log and the activity log,
// with its clock handed in (never a sleep), and the owner's routes over what it wrote. PostgreSQL only (see
// wallet-concurrency.db.spec.ts for how to give it one). Other files write requests, activity and owners at the
// same time, so this one works on its own day (a day of the 1980s picked by the run: every window the pass reads
// is on it) with its own login names and addresses, and asks only about its own alerts and its own accounts'
// notices. Every round may also close an open alert another run of this file left on an older day: that is the
// rule (quiet for 30 minutes), and it touches nothing of the others.

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the alerts in PostgreSQL: the pass, its notices, and the owner\'s routes', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ownerId = randomUUID();
  const mainId = randomUUID();
  const ghost = `ghost-${tag}`;
  const probeIp = `198.51.${Number.parseInt(tag.slice(0, 2), 16)}.${Number.parseInt(tag.slice(2, 4), 16)}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let uow: UnitOfWork;
  let repo: AlertRepository;
  /** The real audience query, kept for its own test: the pass below is handed this file's owner alone. */
  let everyOwner: AlertRepository['branchOwners'];
  let service: AlertsService;
  const down = { worker: false, postgres: false, redis: false, outbox: false };
  const probe: PartsProbe = async () => ({ ...down });
  let pass: AlertPass;

  const owner = (): Actor => ({ id: ownerId, loginName: `al-${tag}-owner`, nickname: 'owner', layer: 'branch', isBranchOwner: true, grants: [], operatorId: ownerId, impersonating: false });
  const day = new Date(Date.parse('1980-01-01T00:00:00.000Z') + (Number.parseInt(tag, 16) % 3650) * 86_400_000).toISOString().slice(0, 10);
  const base = Date.parse(`${day}T08:00:00.000Z`);
  /** `minutes` after 08:00 of this file's day. */
  const at = (minutes: number) => new Date(base + minutes * 60_000);
  const dayRange = { gte: new Date(`${day}T00:00:00.000Z`), lte: new Date(`${day}T23:59:59.999Z`) };

  const failedSignIns = (n: number, minute: number, loginName = ghost) =>
    prisma.activityEvent.createMany({ data: Array.from({ length: n }, (_, i) => ({ at: new Date(at(minute).getTime() + i * 1000), actorLoginName: loginName, action: 'login', result: 'fail', reason: 'BAD_CREDENTIALS', ip: '192.0.2.7' })) });
  const notFound = (n: number, minute: number) =>
    prisma.requestLog.createMany({
      data: Array.from({ length: n }, (_, i) => ({ at: new Date(at(minute).getTime() + i * 1000), durationMs: 3, method: 'GET', route: '', path: `/t-${tag}/x${i}`, status: 404, code: 'NOT_FOUND', ip: probeIp, requestId: `${tag}-${minute}-${i}` })),
    });
  const ours = () => prisma.alert.findMany({ where: { firstAt: dayRange }, orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] });
  const noticesOf = (userId: string) => prisma.notice.findMany({ where: { userId, kind: 'system.alert' }, orderBy: { createdAt: 'asc' } });
  const clearOwn = async () => {
    await prisma.alert.deleteMany({ where: { firstAt: dayRange } });
    await prisma.notice.deleteMany({ where: { userId: { in: [ownerId, mainId] } } });
    await prisma.activityEvent.deleteMany({ where: { at: dayRange } });
    await prisma.requestLog.deleteMany({ where: { at: dayRange } });
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    await prisma.user.create({ data: { id: ownerId, loginName: `al-${tag}-owner`, nickname: 'owner', passwordHash: 'x', layer: 'branch', isBranchOwner: true } });
    await prisma.user.create({ data: { id: mainId, loginName: `al-${tag}-main`, nickname: 'main', passwordHash: 'x', layer: 'main_agent', parentId: ownerId } });
    const bus: NoticeBus = { publish: async () => undefined, subscribe: async () => async () => undefined };
    uow = new UnitOfWork(new NoticeService(bus));
    uow.prismaClient = prisma;
    repo = new AlertRepository(uow);
    // The alerts' audience is every branch owner in the database, and other spec files keep owners of their own in
    // it at the same time: a notice written to one of theirs kept that file from deleting its account afterwards
    // (`Notice_userId_fkey`; seen in a wide run on 2026-11-17, `request-log.db.spec.ts`). So the pass of this file
    // tells this file's owner only; the audience query itself is read, and judged, in its own test.
    everyOwner = repo.branchOwners.bind(repo);
    repo.branchOwners = (async () => [{ id: ownerId }]) as unknown as AlertRepository['branchOwners'];
    service = new AlertsService(repo);
  });

  beforeEach(async () => {
    await clearOwn();
    Object.assign(down, { worker: false, postgres: false, redis: false, outbox: false });
    pass = new AlertPass(repo, uow, probe);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await clearOwn();
    await prisma.user.deleteMany({ where: { id: mainId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('the audience is the branch owners who are not frozen: this file\'s owner is in it, its main agent is not', async () => {
    const audience = (await prisma.$transaction((tx) => everyOwner(tx))).map((row) => row.id);
    expect(audience).toContain(ownerId);
    expect(audience).not.toContain(mainId);
    await prisma.user.update({ where: { id: ownerId }, data: { disabledAt: new Date() } });
    try {
      expect((await prisma.$transaction((tx) => everyOwner(tx))).map((row) => row.id)).not.toContain(ownerId);
    } finally {
      await prisma.user.update({ where: { id: ownerId }, data: { disabledAt: null } });
    }
  });

  it('opens at the threshold and not under it, telling the branch owner once and no one else', async () => {
    await failedSignIns(CRACKING_FAILS - 1, 0);
    await notFound(PROBING_ANSWERS - 1, 0);
    await pass.round(at(2));
    expect(await ours()).toEqual([]);
    // One more of each: both rules are passed.
    await failedSignIns(1, 1);
    await notFound(1, 1);
    await pass.round(at(2));
    const alerts = await ours();
    expect(alerts.map(({ kind, key, state, count, loginName, ip, detail }) => ({ kind, key, state, count, loginName, ip, detail }))).toEqual([
      { kind: 'password_cracking', key: ghost, state: 'open', count: CRACKING_FAILS, loginName: ghost, ip: '192.0.2.7', detail: '' },
      { kind: 'probing', key: `404 ${probeIp}`, state: 'open', count: PROBING_ANSWERS, loginName: '', ip: probeIp, detail: '404' },
    ]);
    const notices = await noticesOf(ownerId);
    expect(notices.map((notice) => (notice.payload as { alertId: string }).alertId).sort()).toEqual(alerts.map((alert) => alert.id).sort());
    expect(notices.find((notice) => (notice.payload as { alertKind: string }).alertKind === 'password_cracking')).toMatchObject({
      href: `/system/alerts?id=${alerts[0].id}`,
      payload: { alertId: alerts[0].id, alertKind: 'password_cracking', loginName: ghost, ip: '192.0.2.7', method: '', route: '', path: '', part: '', detail: '', count: CRACKING_FAILS },
    });
    expect(await noticesOf(mainId)).toEqual([]);
  });

  it('a 429 opens the rate-limit alert, but not the version check\'s own: «فحص الآن» pressed again is no limit being hit', async () => {
    const refused = (route: string, ip: string) => prisma.requestLog.create({
      data: { at: at(1), durationMs: 2, method: 'POST', route, path: route, status: 429, code: 'RATE_LIMITED', ip, requestId: `${tag}-429-${ip}`, bytesIn: 0, bytesOut: 0 },
    });
    await refused('/v1/system/versions/check', `${probeIp.replace(/\.\d+$/, '')}.1`);
    await pass.round(at(2));
    expect((await ours()).filter((alert) => alert.kind === 'rate_limit')).toEqual([]);
    await refused('/v1/postpaid/lines/:id/extend', `${probeIp.replace(/\.\d+$/, '')}.2`);
    await pass.round(at(2));
    expect((await ours()).filter((alert) => alert.kind === 'rate_limit').map((alert) => alert.path)).toEqual(['/v1/postpaid/lines/:id/extend']);
  });

  it('raises an open alert by what came after it, with no second notice, and closes it after 30 quiet minutes', async () => {
    await notFound(PROBING_ANSWERS, 0);
    await pass.round(at(1));
    const [opened] = await ours();
    expect(opened).toMatchObject({ kind: 'probing', count: PROBING_ANSWERS, lastAt: new Date(at(0).getTime() + (PROBING_ANSWERS - 1) * 1000) });
    // The next round sees the same rows: nothing new, nothing changes.
    await pass.round(at(1.5));
    expect((await ours())[0]).toMatchObject({ id: opened.id, count: PROBING_ANSWERS });
    // Ten more answers within the window: counted once each, and still the same alert and one notice.
    await notFound(10, 2);
    await pass.round(at(3));
    const raised = (await ours())[0];
    expect(raised).toMatchObject({ id: opened.id, state: 'open', count: PROBING_ANSWERS + 10, lastAt: new Date(at(2).getTime() + 9 * 1000), firstAt: opened.firstAt });
    expect(await noticesOf(ownerId)).toHaveLength(1);
    // Quiet: open until 30 minutes after its last answer, then closed.
    await pass.round(new Date(raised.lastAt.getTime() + ALERT_QUIET_MINUTES * 60_000 - 1000));
    expect((await ours())[0].state).toBe('open');
    await pass.round(new Date(raised.lastAt.getTime() + ALERT_QUIET_MINUTES * 60_000));
    expect((await ours())[0]).toMatchObject({ id: opened.id, state: 'closed', closedAt: new Date(raised.lastAt.getTime() + ALERT_QUIET_MINUTES * 60_000) });
    // The same rule passed again after it closed is a new alert, and a new notice.
    await notFound(PROBING_ANSWERS, 60);
    await pass.round(at(61));
    expect((await ours()).map((alert) => alert.state)).toEqual(['closed', 'open']);
    expect(await noticesOf(ownerId)).toHaveLength(2);
  });

  it('keeps one open alert a kind and key: a second open one is refused by the index', async () => {
    await notFound(PROBING_ANSWERS, 0);
    await pass.round(at(1));
    const [open] = await ours();
    const again = await uow.runTx((tx) => repo.open(tx, { kind: 'probing', key: open.key, count: 1, firstAt: at(1), lastAt: at(1), recent: [], subject: { loginName: '', accountId: null, ip: '', method: '', route: '', path: '', part: '', detail: '' } }));
    expect(again).toBeNull();
    await expect(prisma.alert.create({ data: { kind: 'probing', key: open.key, count: 1, firstAt: at(1), lastAt: at(1) } })).rejects.toThrow();
    expect(await ours()).toHaveLength(1);
  });

  it('a part down for two minutes opens "a service is down"; PostgreSQL down is written once it answers again', async () => {
    down.redis = true;
    await pass.round(at(0));
    await pass.round(at(1));
    expect(await ours()).toEqual([]);
    await pass.round(at(2));
    expect((await ours()).map(({ kind, key, part, count }) => ({ kind, key, part, count }))).toEqual([{ kind: 'service_down', key: 'redis', part: 'redis', count: 1 }]);
    await pass.round(at(2.5));
    expect((await ours())[0].count).toBe(2);
    // PostgreSQL down: the rounds cannot write; the spell is kept and written by the first round after it answers.
    down.redis = false;
    down.postgres = true;
    // The same pass (its spells), its database away while PostgreSQL is down: every read fails.
    let away = true;
    const reach = repo.openAlerts.bind(repo);
    jest.spyOn(repo, 'openAlerts').mockImplementation(() => (away ? Promise.reject(new Error('down')) : reach()));
    await expect(pass.round(at(10))).rejects.toThrow('down');
    await expect(pass.round(at(13))).rejects.toThrow('down');
    down.postgres = false;
    away = false;
    await pass.round(at(14));
    expect((await ours()).filter((alert) => alert.key === 'postgres').map(({ firstAt, lastAt, state }) => ({ firstAt, lastAt, state }))).toEqual([{ firstAt: at(10), lastAt: at(13), state: 'open' }]);
    // Redis's spell, kept through the failed rounds, is the same spell its alert already counted: nothing added.
    expect((await ours()).find((alert) => alert.key === 'redis')).toMatchObject({ count: 2, lastAt: at(2.5) });
  });

  it('the owner lists open first, with the filters behind each, marks one seen (the count of /v1/me falls) and clears only closed ones', async () => {
    await notFound(PROBING_ANSWERS, 0);
    await pass.round(at(1));
    await pass.round(at(40));
    await failedSignIns(CRACKING_FAILS, 41);
    await pass.round(at(42));
    const [closed, open] = [(await ours()).find((alert) => alert.state === 'closed'), (await ours()).find((alert) => alert.state === 'open')];
    expect([closed?.kind, open?.kind]).toEqual(['probing', 'password_cracking']);
    const listed = (await service.list(owner())).items.filter((item) => item.id === open?.id || item.id === closed?.id);
    expect(listed.map((item) => item.state)).toEqual(['open', 'closed']);
    expect(listed[1].link).toEqual({ from: new Date(at(0).getTime() - 60_000).toISOString(), to: new Date(at(0).getTime() + (PROBING_ANSWERS - 1) * 1000 + 60_000).toISOString(), status: '404', ip: probeIp });
    expect(listed[0]).toMatchObject({ kind: 'password_cracking', loginName: ghost, seenAt: null, closedAt: null, link: { route: '/auth/login', ip: '192.0.2.7' } });
    expect((await service.list(owner(), { state: 'closed' })).items.some((item) => item.id === open?.id)).toBe(false);
    const desk = new DeskRepository(uow);
    const before = await desk.openUnseenAlerts();
    const seen = await service.markSeen(owner(), open?.id as string);
    expect(seen).toMatchObject({ id: open?.id, seenByLoginName: `al-${tag}-owner` });
    expect(await desk.openUnseenAlerts()).toBe(before - 1);
    // Seen twice, the first stays; seen does not close it.
    expect(await service.markSeen(owner(), open?.id as string)).toEqual(seen);
    expect((await prisma.alert.findUnique({ where: { id: open?.id } }))?.state).toBe('open');
    await expect(service.markSeen(owner(), randomUUID())).rejects.toMatchObject({ status: 404 });
    const cleared = await service.clear(owner());
    expect(cleared.removed).toBeGreaterThanOrEqual(1);
    expect((await ours()).map((alert) => alert.id)).toEqual([open?.id]);
    // Nobody but the owner in person.
    await expect(service.list({ ...owner(), isBranchOwner: false })).rejects.toMatchObject({ status: 403 });
    await expect(service.clear({ ...owner(), impersonating: true })).rejects.toMatchObject({ status: 403 });
  });

  it('runs on its timer one round at a time, and a stop waits for the round in flight and starts no other', async () => {
    let release: () => void = () => undefined;
    let rounds = 0;
    const slow = { round: () => { rounds += 1; return new Promise<{ opened: number; raised: number; closed: number }>((resolve) => { release = () => resolve({ opened: 0, raised: 0, closed: 0 }); }); } } as unknown as AlertPass;
    const running = startAlertPass(uow, 20, slow);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Five ticks went by: the first round still holds, no second one started.
    expect(rounds).toBe(1);
    let stopped = false;
    const stopping = running.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stopped).toBe(false);
    release();
    await stopping;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rounds).toBe(1);
    // A round that fails is logged and the next tick runs again.
    let failures = 0;
    const broken = { round: async () => { failures += 1; throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); } } as unknown as AlertPass;
    const again = startAlertPass(uow, 20, broken);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await again.stop();
    expect(failures).toBeGreaterThan(1);
  });
});
