import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../db';
import { entriesStoredBeforeTheCheck, theCheckValidatedAgain } from '../modules/wallets/testing/entries-before-the-check';
import { backfillLines, backfillStoredMargins, checkStoredMargins, run, type BackfillScope } from './stored-margins-backfill';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0026, amendment (slice M.2): the backfill gives every sale and refund entry
// its chain by layer and each layer's margin, `marginOf` of its ladder: the kept ladder when there is one (its old
// prices win over today's); for an old sale without one, a ladder built once on the path of its time (a point of sale
// moved since is put back under the agent it had, from the transfer notice: the owner's answer 1) and stored; for an
// old refund, its sale's ladder scaled by its share. An entry whose ladder cannot be built stays without one; a chain
// with two accounts of one layer stops the run; an old operation row without its provider is written around the
// provider ledger's CHECK. It checks the invariant in Node, validates the CHECK, and a second run writes nothing.
// Every run is limited to this spec's points of sale: other specs keep rows of their own in the same database.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the stored margins\' backfill (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const u = { owner: randomUUID(), main: randomUUID(), agent1: randomUUID(), agent2: randomUUID(), agentX: randomUUID(), pos: randomUUID(), pos2: randomUUID(), pos3: randomUUID() };
  const ids = { provider: randomUUID(), pkg: randomUUID(), lineA: randomUUID(), lineB: randomUUID(), lineC: randomUUID(), lineD: randomUUID() };
  const scope: BackfillScope = { userIds: [u.pos, u.pos2] };
  const code = `smb-${tag}`;
  const login = (name: string) => `smb-${tag}-${name}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  const entryId = (name: string) => `${tag}-${name}`;

  const entry = (name: string, userId: string, kind: string, lineId: string, amount: number, packagePrice: number, at: string, extra: Record<string, unknown> = {}) => ({
    id: entryId(name), userId, actorId: u.owner, amount, balanceAfter: 0, kind, lineId, packagePrice, packageName: code, companyName: code,
    providerId: ids.provider, providerCost: 0, createdAt: new Date(at), ...extra,
  });
  // The ladder kept at a sale made at the old prices: it wins over today's.
  const keptLadder = { kind: 'subscription', chain: [u.pos, u.agent1, u.main, u.owner], costs: { [u.pos]: 3500, [u.agent1]: 3000, [u.main]: 2500, [u.owner]: 2000 }, posSell: 4200 };
  const stored = async () =>
    (await prisma.walletEntry.findMany({ where: { userId: { in: [u.pos, u.pos2] } }, orderBy: { id: 'asc' } }))
      .map((row) => [row.id.slice(tag.length + 1), row.chainPosId === u.pos ? 'pos' : row.chainPosId === u.pos2 ? 'pos2' : row.chainPosId, row.chainAgentId === u.agent1 ? 'agent1' : row.chainAgentId === u.agent2 ? 'agent2' : row.chainAgentId, row.chainMainAgentId === u.main ? 'main' : row.chainMainAgentId, row.posMargin, row.agentMargin, row.mainAgentMargin, row.branchMargin, row.ladder !== null]);
  const validated = async () => (await prisma.$queryRaw<{ convalidated: boolean }[]>`SELECT convalidated FROM pg_constraint WHERE conname = 'WalletEntry_sale_margins'`)[0]?.convalidated;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient('tool');
    const user = (id: string, name: string, layer: string, parentId: string | null) => ({ id, loginName: login(name), nickname: name, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    for (const row of [
      user(u.owner, 'owner', 'branch', null), user(u.main, 'main', 'main_agent', u.owner), user(u.agent1, 'agent1', 'agent', u.main), user(u.agent2, 'agent2', 'agent', u.main),
      // A broken tree the code never builds: an agent under an agent.
      user(u.agentX, 'agentX', 'agent', u.agent1),
      // The point of sale was under agent1 until 2026-10-10, when it was moved under agent2.
      user(u.pos, 'pos', 'pos', u.agent2), user(u.pos2, 'pos2', 'pos', u.agent1), user(u.pos3, 'pos3', 'pos', u.agentX),
    ]) await prisma.user.create({ data: row });
    await prisma.notice.create({ data: { userId: u.agent1, kind: 'transfer.out', payload: { kind: 'pos', subject: login('pos'), actorName: 'x', toLoginName: login('agent2') }, href: '/', createdAt: new Date('2026-10-10T00:00:00Z') } });
    await prisma.provider.create({ data: { id: ids.provider, code, name: code } });
    const flags = { autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false };
    await prisma.postpaidPackage.create({
      data: {
        id: ids.pkg, code, name: code, providerId: ids.provider, ...flags,
        branchCost: 2000, mainPrice: 2400, agentPrice: 2900, posPrice: 3500, subscriberPrice: 4000,
        renewalBranchCost: 1800, renewalMainPrice: 2100, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3600,
      },
    });
    const line = (id: string, n: number, posId: string, packageCode: string) => ({ id, msisdn: `05${tag.replace(/\D/g, '3').slice(0, 7)}${n}`, status: 'active', endsAt: new Date('2027-01-01T00:00:00Z'), packageId: ids.pkg, posId, terms: { packageCode } });
    await prisma.postpaidLine.create({ data: line(ids.lineA, 1, u.pos, code) });
    await prisma.postpaidLine.create({ data: line(ids.lineB, 2, u.pos2, code) });
    await prisma.postpaidLine.create({ data: line(ids.lineC, 3, u.pos, `${code}-gone`) });
    await prisma.postpaidLine.create({ data: line(ids.lineD, 4, u.pos3, code) });
    await entriesStoredBeforeTheCheck(prisma, [
      entry('kept', u.pos, 'activate', ids.lineA, -3500, 3500, '2026-10-01T10:00:00.000Z', { ladder: keptLadder }),
      entry('old', u.pos, 'activate', ids.lineA, -3500, 3500, '2026-10-02T10:00:00.000Z'),
      entry('oldRefund', u.pos, 'disconnect', ids.lineA, 1750, 3500, '2026-10-03T10:00:00.000Z'),
      entry('after', u.pos, 'charge', ids.lineA, -3200, 3200, '2026-10-12T10:00:00.000Z'),
      entry('keptRefund', u.pos, 'disconnect', ids.lineA, 1000, 3000, '2026-10-13T10:00:00.000Z', { ladder: { ...keptLadder, share: -1 / 3 } }),
      entry('noLadder', u.pos, 'activate', ids.lineC, -3500, 3500, '2026-10-04T10:00:00.000Z'),
      entry('switch', u.pos, 'switch', ids.lineA, -100, 0, '2026-10-05T10:00:00.000Z'),
      // Not yet given its provider by provider-ledger-backfill.
      entry('unpriced', u.pos2, 'activate', ids.lineB, -3500, 3500, '2026-10-06T10:00:00.000Z', { providerId: null, providerCost: null }),
      entry('broken', u.pos3, 'activate', ids.lineD, -3500, 3500, '2026-10-07T10:00:00.000Z'),
    ]);
  });

  afterAll(async () => {
    const all = Object.values(u);
    await prisma.walletEntry.deleteMany({ where: { userId: { in: all } } });
    await theCheckValidatedAgain(prisma).catch(() => undefined);
    await prisma.notice.deleteMany({ where: { userId: { in: all } } });
    await prisma.postpaidLine.deleteMany({ where: { id: { in: [ids.lineA, ids.lineB, ids.lineC, ids.lineD] } } });
    await prisma.postpaidPackage.deleteMany({ where: { id: ids.pkg } });
    await prisma.provider.deleteMany({ where: { id: ids.provider } });
    for (const id of [u.pos3, u.pos2, u.pos, u.agentX, u.agent2, u.agent1, u.main, u.owner]) await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  const BEFORE = [
    ['after', null, null, null, null, null, null, null, false],
    ['kept', null, null, null, null, null, null, null, true],
    ['keptRefund', null, null, null, null, null, null, null, true],
    ['noLadder', null, null, null, null, null, null, null, false],
    ['old', null, null, null, null, null, null, null, false],
    ['oldRefund', null, null, null, null, null, null, null, false],
    ['switch', null, null, null, null, null, null, null, false],
    ['unpriced', null, null, null, null, null, null, null, false],
  ];
  const AFTER = [
    // After the move, today's path: renewal, pos 3600 − 3200, agent2 3200 − 2700, main 2700 − 2100, branch 2100 − 1800.
    ['after', 'pos', 'agent2', 'main', 400, 500, 600, 300, true],
    // The kept ladder's old prices: pos 4200 − 3500, agent1 3500 − 3000, main 3000 − 2500, branch 2500 − 2000.
    ['kept', 'pos', 'agent1', 'main', 700, 500, 500, 500, true],
    // A third of the kept sale's margins back, JavaScript's rounding: −233.33, −166.67.
    ['keptRefund', 'pos', 'agent1', 'main', -233, -167, -167, -167, true],
    ['noLadder', null, null, null, null, null, null, null, false],
    // Before the move: built on the path of its time, under agent1, at today's prices: pos 4000 − 3500, agent1 3500 − 2900, main 2900 − 2400, branch 2400 − 2000.
    ['old', 'pos', 'agent1', 'main', 500, 600, 500, 400, true],
    // Half of what was paid back: half of the sale before it ('old'), for the same accounts.
    ['oldRefund', 'pos', 'agent1', 'main', -250, -300, -250, -200, true],
    ['switch', null, null, null, null, null, null, null, false],
    ['unpriced', 'pos2', 'agent1', 'main', 500, 600, 500, 400, true],
  ];

  it('stops on a chain with two accounts of one layer, changing nothing', async () => {
    const done = await backfillStoredMargins(prisma, { scope: { userIds: [u.pos3] } });
    expect(done.unresolved).toEqual([{ id: entryId('broken'), kind: 'activate', reason: `its chain holds two accounts of one layer (${login('pos3')}:pos > ${login('agentX')}:agent > ${login('agent1')}:agent > ${login('main')}:main_agent > ${login('owner')}:branch)` }]);
    expect(done).toMatchObject({ stopped: true, committed: false, written: 0 });
    expect(backfillLines(done).at(-1)).toMatch(/share table\)\. Nothing was changed\.$/);
    expect((await prisma.walletEntry.findUniqueOrThrow({ where: { id: entryId('broken') } })).ladder).toBeNull();
  });

  it('a dry run prints every ladder it builds, the entries left without one, and rolls back', async () => {
    const done = await backfillStoredMargins(prisma, { scope, dryRun: true });
    expect(done).toMatchObject({ sales: 5, refunds: 2, written: 6, unresolved: [], breaks: [], liftedProviderCheck: 1, committed: false });
    expect(done.stored.map((row) => [row.id.slice(tag.length + 1), row.source, row.movedFrom ? row.movedFrom.map((name) => name.slice(login('').length)) : null])).toEqual([
      ['kept', 'kept', null],
      ['old', 'rebuilt', ['pos', 'agent2', 'main', 'owner']],
      ['unpriced', 'rebuilt', null],
      ['after', 'rebuilt', null],
      ['oldRefund', 'rebuilt from its sale', ['pos', 'agent2', 'main', 'owner']],
      ['keptRefund', 'kept', null],
    ]);
    expect(done.without).toEqual([{ id: entryId('noLadder'), kind: 'activate', reason: 'its line\'s package cannot be found' }]);
    expect(done.totals).toEqual([
      { layer: 'branch', login: 'the branch', margin: 400 + 500 - 167 + 400 - 200 + 300 },
      { layer: 'main_agent', login: login('main'), margin: 500 + 500 - 167 + 500 - 250 + 600 },
      { layer: 'agent', login: login('agent1'), margin: 500 - 167 + 600 - 300 + 600 },
      { layer: 'agent', login: login('agent2'), margin: 500 },
      { layer: 'pos', login: login('pos'), margin: 700 - 233 + 500 - 250 + 400 },
      { layer: 'pos', login: login('pos2'), margin: 500 },
    ]);
    const lines = backfillLines(done);
    expect(lines[0]).toBe('sale entries: 5; refund entries: 2; kept ladders given their margins 2; ladders built 3 (sales) and 1 (refunds); left without a ladder 1; rows written 6');
    expect(lines).toContain(`built: entry ${entryId('old')} (activate, 2026-10-02T10:00:00.000Z) chain ${login('pos')} > ${login('agent1')} > ${login('main')} > ${login('owner')}: pos 500, agent 600, main agent 500, branch 400; on the path of its time, today ${login('pos')} > ${login('agent2')} > ${login('main')} > ${login('owner')}`);
    expect(lines).toContain(`no ladder: entry ${entryId('noLadder')} (activate): its line's package cannot be found`);
    expect(lines).toContain('check WalletEntry_operation_priced: lifted around 1 old operation entr(ies) without a provider and added again NOT VALID: run provider-ledger-backfill next');
    expect(lines.slice(-2)).toEqual(['check WalletEntry_sale_margins: validated', 'dry run: rolled back, nothing was changed']);
    expect(await stored()).toEqual(BEFORE);
  });

  it('commits, holds the invariant, validates the CHECK, and a second run changes nothing', async () => {
    const done = await backfillStoredMargins(prisma, { scope });
    expect(done).toMatchObject({ written: 6, committed: true, validated: true, breaking: 0, breaks: [] });
    expect(await stored()).toEqual(AFTER);
    expect(await validated()).toBe(true);
    expect(await checkStoredMargins(prisma, scope)).toEqual([]);
    const again = await backfillStoredMargins(prisma, { scope });
    expect(again).toMatchObject({ written: 0, stored: [], liftedProviderCheck: 0, committed: true, validated: true });
    expect(again.without.map((row) => row.id)).toEqual([entryId('noLadder')]);
    expect(await stored()).toEqual(AFTER);
  });

  it('the check finds a stored margin that is not marginOf its ladder', async () => {
    await prisma.$executeRaw`UPDATE "WalletEntry" SET "agentMargin" = 601 WHERE "id" = ${entryId('old')}`;
    try {
      expect(await checkStoredMargins(prisma, scope)).toEqual([{ id: entryId('old'), reason: 'agentMargin 601 (expected 600)' }]);
    } finally {
      await prisma.$executeRaw`UPDATE "WalletEntry" SET "agentMargin" = 600 WHERE "id" = ${entryId('old')}`;
    }
  });

  it('the command refuses an argument it does not know before it reads anything', async () => {
    // Unscoped, the command reads the whole database: other specs' rows are in this one, so only the refusals run here.
    expect(await run(['--force'])).toBe(2);
    expect(await run(['--check', '--dry-run'])).toBe(2);
  });
});
