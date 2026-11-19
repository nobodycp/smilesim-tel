import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../db';
import { entriesStoredBeforeTheCheck, theCheckValidatedAgain } from '../modules/wallets/testing/entries-before-the-check';
import { backfillLines, backfillProviderLedger, run, type BackfillScope } from './provider-ledger-backfill';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0025, amendment (slice P.4b): the backfill gives every operation entry the
// provider of its line's package and, where it stored none, the cost its writer stores today; it moves an entry
// stored under another provider; it corrects a disconnect stored before slice P.6; it stops on an entry it cannot
// resolve unless told to leave it; it validates the CHECK when no row breaks it; a second run changes nothing. Every run is limited to this spec's point of sale:
// other specs keep rows of their own in the same database.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the provider ledger\'s backfill (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = {
    owner: randomUUID(), pos: randomUUID(), providerA: randomUUID(), providerB: randomUUID(), company: randomUUID(),
    a1: randomUUID(), b1: randomUUID(), lineA: randomUUID(), lineB: randomUUID(), lineC: randomUUID(), lineD: randomUUID(),
  };
  const scope: BackfillScope = { userIds: [ids.pos] };
  let prisma: ReturnType<typeof createPrismaClient>;
  const entryId = (name: string) => `${tag}-${name}`;
  const A1 = `pl-${tag}-A1`;

  // A sale moves money (an activation or renewal that moved 0 is a sale at 0, which the P.7 pass marks: spec DB.5 P.7).
  const SALES = ['activate', 'charge', 'extend', 'reactivate'];
  const entry = (name: string, kind: string, lineId: string | null, providerCost: number | null, at: string, extra: Record<string, unknown> = {}) => ({
    id: entryId(name), userId: ids.pos, actorId: ids.owner, amount: SALES.includes(kind) ? -3500 : 0, balanceAfter: 0, kind, lineId, msisdn: `05${tag.replace(/\D/g, '1').slice(0, 7)}${name.length}`,
    packageName: A1, companyName: `pl-${tag}-co`, providerCost, createdAt: new Date(at), ...extra,
  });
  const stored = async () =>
    (await prisma.walletEntry.findMany({ where: { userId: ids.pos }, orderBy: { id: 'asc' }, select: { id: true, providerId: true, providerCost: true } }))
      .map((row) => [row.id.slice(tag.length + 1), row.providerId === ids.providerA ? 'A' : row.providerId === ids.providerB ? 'B' : row.providerId, row.providerCost]);
  const validated = async () => (await prisma.$queryRaw<{ convalidated: boolean }[]>`SELECT convalidated FROM pg_constraint WHERE conname = 'WalletEntry_operation_priced'`)[0]?.convalidated;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient('tool');
    const user = (id: string, layer: string, parentId: string | null) => ({ id, loginName: `pl-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    await prisma.user.create({ data: user(ids.owner, 'branch', null) });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.provider.create({ data: { id: ids.providerA, code: `pl-${tag}-a`, name: `pl-${tag}-A` } });
    await prisma.provider.create({ data: { id: ids.providerB, code: `pl-${tag}-b`, name: `pl-${tag}-B` } });
    await prisma.postpaidCompany.create({ data: { id: ids.company, code: `pl-${tag}`, name: `pl-${tag}-co` } });
    const flags = { autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false };
    const prices = (branchCost: number, renewalBranchCost: number) => ({
      branchCost, mainPrice: branchCost + 500, agentPrice: branchCost + 1000, posPrice: branchCost + 1500, subscriberPrice: branchCost + 2000,
      renewalBranchCost, renewalMainPrice: renewalBranchCost + 500, renewalAgentPrice: renewalBranchCost + 1000, renewalPosPrice: renewalBranchCost + 1500, renewalSubscriberPrice: renewalBranchCost + 2000,
    });
    // The same name and company under two providers, as on the dev data («500 جيجا», ويكوم).
    await prisma.postpaidPackage.create({ data: { id: ids.a1, code: `pl-${tag}-A1`, name: A1, providerId: ids.providerA, companyId: ids.company, ...prices(2000, 1800), ...flags } });
    await prisma.postpaidPackage.create({ data: { id: ids.b1, code: `pl-${tag}-B1`, name: A1, providerId: ids.providerB, companyId: ids.company, ...prices(3000, 2500), ...flags } });
    const line = (id: string, n: number, packageId: string, terms: object) => ({ id, msisdn: `05${tag.replace(/\D/g, '2').slice(0, 7)}${n}`, status: 'active', endsAt: new Date('2027-01-01T00:00:00Z'), packageId, posId: ids.pos, terms });
    await prisma.postpaidLine.create({ data: line(ids.lineA, 1, ids.a1, { subscription: { branchCost: 2100 }, renewal: { branchCost: 1700 } }) });
    await prisma.postpaidLine.create({ data: line(ids.lineB, 2, ids.b1, { subscription: { branchCost: 3100 }, renewal: { branchCost: 2600 } }) });
    // Two lines sold on 2026-10-11 for a 30-day period that cost the branch 3000, disconnected ten days in (10 days used).
    const priced = { branchCost: 3000, mainPrice: 3100, agentPrice: 3200, posPrice: 3500, subscriberPrice: 4000 };
    const terms = { packageCode: `pl-${tag}-A1`, months: 1, subscription: priced, renewal: priced, renewalTargets: [] };
    await prisma.postpaidLine.create({ data: { ...line(ids.lineC, 3, ids.a1, terms), status: 'disconnected', endsAt: new Date('2026-11-10T10:00:00Z') } });
    await prisma.postpaidLine.create({ data: { ...line(ids.lineD, 4, ids.a1, terms), status: 'disconnected', endsAt: new Date('2026-11-10T10:00:00Z') } });
    const sold = { periodCost: 3000, periodDays: 30, periodEndsAt: new Date('2026-11-10T10:00:00Z'), packagePrice: 3500 };
    const ladder = { kind: 'subscription', chain: [ids.pos, ids.owner], costs: { [ids.pos]: 3500, [ids.owner]: 1950 }, posSell: 4000 };
    await entriesStoredBeforeTheCheck(prisma, [
      entry('kept', 'activate', ids.lineA, 2100, '2026-10-01T10:00:00.000Z'), // provider filled, cost kept
      entry('period', 'activate', ids.lineA, null, '2026-10-02T10:00:00.000Z', { periodCost: 2050, esimPrice: 500 }), // 2050 + 500
      // The branch on the ladder: 1950. Its margins as the stored margins' backfill leaves them, which runs first
      // (ADR 0026, amendment): the CHECK `WalletEntry_sale_margins` refuses an update of a ladder without them.
      entry('ladder', 'activate', ids.lineA, null, '2026-10-03T10:00:00.000Z', { ladder, chainPosId: ids.pos, posMargin: 500, branchMargin: 1550 }),
      entry('renewal', 'charge', ids.lineA, null, '2026-10-04T10:00:00.000Z'), // the line's renewal terms: 1700
      entry('freeze', 'freeze', ids.lineA, null, '2026-10-05T10:00:00.000Z'), // 0
      entry('esim', 'esim', ids.lineA, null, '2026-10-06T10:00:00.000Z', { esimPrice: 500 }), // the fee: 500
      entry('fund', 'fund', null, null, '2026-10-07T10:00:00.000Z', { packageName: '' }), // not an operation: left alone
      entry('cact', 'activate', ids.lineC, 3000, '2026-10-11T10:00:00.000Z', sold),
      // Stored before P.6: the used share and the fee, 1000 + 50. Corrected to minus what the provider gives back: 1050 − 3000.
      entry('cdisc', 'disconnect', ids.lineC, 1050, '2026-10-21T09:00:00.000Z', { packagePrice: 3500 }),
      entry('dact', 'activate', ids.lineD, 3000, '2026-10-11T10:00:00.000Z', sold),
      // No cost kept: the settlement at its own time, by today's rule: 1000 + 50 − 3000.
      entry('ddisc', 'disconnect', ids.lineD, null, '2026-10-21T09:00:00.000Z', { packagePrice: 3500 }),
      // Stored under A by name matching, while its line holds B's package of the same name: moved to B, cost kept.
      entry('named', 'activate', ids.lineB, 2000, '2026-10-08T10:00:00.000Z', { providerId: ids.providerA }),
    ]);
    // Written by today's writers: already right, never touched. A sale keeps its ladder and margins (F.3).
    await prisma.walletEntry.create({ data: entry('today', 'extend', ids.lineA, 1600, '2026-11-01T10:00:00.000Z', { providerId: ids.providerA, ladder, chainPosId: ids.pos, posMargin: 500, branchMargin: 1550 }) });
  });

  afterAll(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    await theCheckValidatedAgain(prisma);
    await prisma.postpaidLine.deleteMany({ where: { posId: ids.pos } });
    await prisma.postpaidPackage.deleteMany({ where: { id: { in: [ids.a1, ids.b1] } } });
    await prisma.postpaidCompany.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: { in: [ids.providerA, ids.providerB] } } });
    await prisma.wallet.deleteMany({ where: { userId: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  const BEFORE = [
    ['cact', null, 3000], ['cdisc', null, 1050], ['dact', null, 3000], ['ddisc', null, null],
    ['esim', null, null], ['freeze', null, null], ['fund', null, null], ['kept', null, 2100], ['ladder', null, null], ['named', 'A', 2000],
    ['period', null, null], ['renewal', null, null], ['today', 'A', 1600],
  ];
  const AFTER = [
    ['cact', 'A', 3000], ['cdisc', 'A', -1950], ['dact', 'A', 3000], ['ddisc', 'A', -1950],
    ['esim', 'A', 500], ['freeze', 'A', 0], ['fund', null, null], ['kept', 'A', 2100], ['ladder', 'A', 1950], ['named', 'B', 2000],
    ['period', 'A', 2550], ['renewal', 'A', 1700], ['today', 'A', 1600],
  ];

  it('stops on an entry with no line and no provider, and on a switch that kept no cost, changing nothing', async () => {
    await entriesStoredBeforeTheCheck(prisma, [entry('gone', 'activate', null, null, '2026-10-09T10:00:00.000Z'), entry('switch', 'switch', ids.lineA, null, '2026-10-10T10:00:00.000Z')]);
    const done = await backfillProviderLedger(prisma, { scope });
    expect(done.unresolved).toEqual([
      { id: entryId('gone'), kind: 'activate', reason: 'no line and no provider stored' },
      { id: entryId('switch'), kind: 'switch', reason: 'a switch keeps no record of its quoted difference' },
    ]);
    expect(done).toMatchObject({ stopped: true, committed: false, written: 0 });
    expect(backfillLines(done).at(-1)).toMatch(/--leave-unresolved .*Nothing was changed\.$/);
    expect(await stored()).toEqual([...BEFORE, ['gone', null, null], ['switch', null, null]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(await validated()).toBe(false);

    // Told to leave them: everything else is written, those two stay as they are and the CHECK stays NOT VALID.
    const left = await backfillProviderLedger(prisma, { scope, leaveUnresolved: true, dryRun: true });
    expect(left).toMatchObject({ stopped: false, written: 11, validated: false, committed: false });
    expect(left.breaking).toBeGreaterThanOrEqual(2);
    expect(backfillLines(left)).toContain(`check WalletEntry_operation_priced: left NOT VALID, ${left.breaking} operation entr(ies) without a provider or a cost (new rows are still checked)`);
    await prisma.walletEntry.deleteMany({ where: { id: { in: [entryId('gone'), entryId('switch')] } } });
  });

  it('a dry run prints every change and each provider\'s purchases, and rolls back', async () => {
    const done = await backfillProviderLedger(prisma, { scope, dryRun: true });
    expect(done).toMatchObject({ entries: 12, written: 11, unresolved: [], committed: false, validated: true });
    expect(done.moved.map((row) => [row.id, row.kind, row.from.provider, row.to.provider])).toEqual([[entryId('named'), 'activate', `pl-${tag}-a`, `pl-${tag}-b`]]);
    expect(done.priced.map((row) => [row.id.slice(tag.length + 1), row.from.cost, row.to.cost, row.source])).toEqual([
      ['period', null, 2550, 'the period cost kept on the entry + the eSIM fee kept on the entry'],
      ['ladder', null, 1950, "the branch's cost on the entry's ladder"],
      ['renewal', null, 1700, "the line's terms"],
      ['freeze', null, 0, 'a kind the provider does not price'],
      ['esim', null, 500, 'the eSIM fee kept on the entry'],
      ['cdisc', 1050, -1950, "the provider gives back the open periods' cost 3000 (slice P.6)"],
      ['ddisc', null, -1950, 'the disconnect settlement at its own time'],
    ]);
    expect(done.purchases).toEqual([
      // Each disconnected line's net cost: 3000 − 1950 = 1050 (the owner's example, ADR 0025 answer 3).
      { code: `pl-${tag}-a`, before: 2000 + 1600, after: 2100 + 2550 + 1950 + 1700 + 0 + 500 + 1600 + (3000 - 1950) * 2 },
      { code: `pl-${tag}-b`, before: 0, after: 2000 },
    ]);
    const lines = backfillLines(done);
    expect(lines).toContain(`moved: entry ${entryId('named')} (activate) pl-${tag}-a -> pl-${tag}-b`);
    expect(lines).toContain(`provider pl-${tag}-a: purchases 3600 -> 12500`);
    expect(lines).toContain(`cost: entry ${entryId('cdisc')} (disconnect, pl-${tag}-a) 1050 -> -1950 (the provider gives back the open periods' cost 3000 (slice P.6))`);
    expect(lines.slice(-2)).toEqual(['check WalletEntry_operation_priced: validated', 'dry run: rolled back, nothing was changed']);
    // The old sales it writes keep no ladder (stored before the margins): the sale ladder CHECK is lifted around the
    // write and added again NOT VALID (spec F.3), and the run says so.
    expect(done.liftedSaleCheck).toBe(6);
    expect(lines).toContain('check WalletEntry_sale_has_ladder: lifted around 6 old sale(s) without a ladder and added again NOT VALID (stored-margins-backfill lists them under "no ladder")');
    expect(await stored()).toEqual(BEFORE);
  });

  it('commits, validates the CHECK, and a second run changes nothing', async () => {
    const done = await backfillProviderLedger(prisma, { scope });
    expect(done).toMatchObject({ written: 11, committed: true, validated: true, breaking: 0 });
    expect(await stored()).toEqual(AFTER);
    expect(await validated()).toBe(true);
    const again = await backfillProviderLedger(prisma, { scope });
    expect(again).toMatchObject({ entries: 12, written: 0, attributed: [], moved: [], priced: [], committed: true, validated: true });
    expect(again.purchases.map((row) => row.before === row.after)).toEqual([true, true]);
    expect(await stored()).toEqual(AFTER);
  });

  it('the command refuses an argument it does not know before it reads anything', async () => {
    // Unscoped, the command reads the whole database: other specs' rows are in this one, so only the refusal runs here.
    expect(await run(['--force'])).toBe(2);
  });
});
