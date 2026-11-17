import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../db';
import type { Actor } from '../modules/access/types';
import { UnitOfWork } from '../modules/platform/unit-of-work';
import { ProviderAccountsService } from '../modules/providers/account/provider-accounts.service';
import { ProvidersRepository } from '../modules/providers/providers.repository';
import { entriesStoredBeforeTheCheck, theCheckValidatedAgain } from '../modules/wallets/testing/entries-before-the-check';
import { WalletsRepository } from '../modules/wallets/wallets.repository';
import { WalletsService } from '../modules/wallets/wallets.service';
import { backfillLines, backfillProviderLedger, run, type BackfillScope } from './provider-ledger-backfill';

// PostgreSQL only (TEST_DATABASE_URL). ADR 0025, slice P.2: the backfill fills the operation entries written before
// release 1 with the provider and cost today's books give them, and commits only when the stored figures equal
// today's books to the agora. The fixture holds every case the ADR names: a cost kept on the entry, a plain
// activation (the line's saved terms), a package renamed since (the line's package), a line switched since to a
// package of another provider (the package the entry names), a disconnect's used share and fee, kinds that cost
// nothing, an entry with no line, and one written by release 1 (left as it is). Every run is limited to this spec's
// point of sale and providers: other specs keep rows of their own in the same database.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the provider ledger\'s backfill (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const ids = {
    owner: randomUUID(), pos: randomUUID(), providerA: randomUUID(), providerB: randomUUID(), company: randomUUID(),
    a1: randomUUID(), a2: randomUUID(), b1: randomUUID(), line1: randomUUID(), line2: randomUUID(), line3: randomUUID(),
  };
  const codeA = `pl-${tag}-a`;
  const codeB = `pl-${tag}-b`;
  const scope: BackfillScope = { userIds: [ids.pos], providerCodes: [codeA, codeB] };
  const owner: Actor = { id: ids.owner, loginName: `pl-${tag}-owner`, nickname: 'owner', layer: 'branch', isBranchOwner: true, grants: [], operatorId: ids.owner, impersonating: false };
  let prisma: ReturnType<typeof createPrismaClient>;
  let accounts: ProviderAccountsService;
  const entryId = (name: string) => `${tag}-${name}`;

  const entry = (name: string, kind: string, lineId: string | null, packageName: string, providerCost: number | null, at: string, extra: { providerId?: string } = {}) => ({
    id: entryId(name), userId: ids.pos, actorId: ids.owner, amount: 0, balanceAfter: 0, kind, lineId, msisdn: `05${tag.replace(/\D/g, '1').slice(0, 7)}${name.length}`,
    packageName, companyName: `pl-${tag}-co`, providerCost, createdAt: new Date(at), ...extra,
  });
  const stored = async () =>
    (await prisma.walletEntry.findMany({ where: { userId: ids.pos }, orderBy: { id: 'asc' }, select: { id: true, providerId: true, providerCost: true } })).map((row) => [row.id.slice(tag.length + 1), row.providerId, row.providerCost]);
  const ours = <T extends { code: string }>(rows: T[]) => rows.filter((row) => row.code === codeA || row.code === codeB);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient('tool');
    const uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as never);
    uow.prismaClient = prisma;
    accounts = new ProviderAccountsService(uow, new WalletsService(uow, null as never, null as never, null as never, new WalletsRepository(uow)), new ProvidersRepository(uow));

    const user = (id: string, layer: string, parentId: string | null) => ({ id, loginName: `pl-${tag}-${layer}`, nickname: layer, passwordHash: 'x', layer, parentId, isBranchOwner: layer === 'branch' });
    await prisma.user.create({ data: user(ids.owner, 'branch', null) });
    await prisma.user.create({ data: { ...user(ids.pos, 'pos', ids.owner), wallet: { create: { balance: 0, ceiling: 0 } } } });
    await prisma.provider.create({ data: { id: ids.providerA, code: codeA, name: `pl-${tag}-A`, creditLimit: 50_000 } });
    await prisma.provider.create({ data: { id: ids.providerB, code: codeB, name: `pl-${tag}-B` } });
    await prisma.company.create({ data: { id: ids.company, code: `pl-${tag}`, name: `pl-${tag}-co` } });
    const flags = { autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false };
    const prices = (branchCost: number, renewalBranchCost: number) => ({
      branchCost, mainPrice: branchCost + 500, agentPrice: branchCost + 1000, posPrice: branchCost + 1500, subscriberPrice: branchCost + 2000,
      renewalBranchCost, renewalMainPrice: renewalBranchCost + 500, renewalAgentPrice: renewalBranchCost + 1000, renewalPosPrice: renewalBranchCost + 1500, renewalSubscriberPrice: renewalBranchCost + 2000,
    });
    const pkg = (id: string, name: string, providerId: string, branchCost: number, renewal: number) => ({ id, code: `pl-${tag}-${name}`, name: `pl-${tag}-${name}`, providerId, companyId: ids.company, ...prices(branchCost, renewal), ...flags });
    await prisma.package.create({ data: pkg(ids.a1, 'A1', ids.providerA, 2000, 1800) });
    // Renamed since its entries were written: they name `pl-…-A2-old`, which no package carries now.
    await prisma.package.create({ data: pkg(ids.a2, 'A2', ids.providerA, 2600, 2200) });
    await prisma.package.create({ data: pkg(ids.b1, 'B1', ids.providerB, 3000, 2500) });
    const line = (id: string, n: number, packageId: string, terms: object) => ({ id, msisdn: `05${tag.replace(/\D/g, '2').slice(0, 7)}${n}`, status: 'active', endsAt: new Date('2027-01-01T00:00:00Z'), packageId, posId: ids.pos, terms });
    await prisma.line.create({ data: line(ids.line1, 1, ids.a1, { subscription: { branchCost: 2100 }, renewal: { branchCost: 1700 } }) });
    await prisma.line.create({ data: line(ids.line2, 2, ids.a2, { subscription: { branchCost: 2650 } }) });
    // Sold on A1 (provider A), on B1 (provider B) since.
    await prisma.line.create({ data: line(ids.line3, 3, ids.b1, { subscription: { branchCost: 3100 } }) });
    const A1 = `pl-${tag}-A1`;
    const B1 = `pl-${tag}-B1`;
    await entriesStoredBeforeTheCheck(prisma, [
      entry('kept', 'activate', ids.line1, A1, 2100, '2026-10-01T10:00:00.000Z'), // a cost kept on the entry: 2100
      entry('plain', 'activate', ids.line1, A1, null, '2026-10-02T10:00:00.000Z'), // the line's saved terms: 2100
      entry('renewal', 'charge', ids.line1, A1, null, '2026-10-03T10:00:00.000Z'), // the line's saved renewal: 1700
      entry('renamed', 'activate', ids.line2, `pl-${tag}-A2-old`, null, '2026-10-04T10:00:00.000Z'), // the line's package A2, its terms: 2650
      entry('switched', 'activate', ids.line3, A1, null, '2026-10-05T10:00:00.000Z'), // A1 by name, not the line's: A1's price 2000, provider A
      entry('disconnect', 'disconnect', ids.line1, A1, 783, '2026-10-06T10:00:00.000Z'), // used share and fee, as stored
      entry('freeze', 'freeze', ids.line1, A1, null, '2026-10-07T10:00:00.000Z'), // costs nothing: 0
      entry('rename', 'rename', ids.line1, A1, 0, '2026-10-08T10:00:00.000Z'), // recorded with 0
      entry('noline', 'charge', null, B1, null, '2026-10-09T10:00:00.000Z'), // no line: B1's renewal price, 2500
      entry('fund', 'fund', null, '', null, '2026-10-10T10:00:00.000Z'), // not an operation: left alone
    ]);
    // Written by release 1: carries both already, and is never rewritten.
    await prisma.walletEntry.create({ data: entry('release1', 'extend', ids.line1, A1, 1600, '2026-11-01T10:00:00.000Z', { providerId: ids.providerA }) });
    await prisma.providerEntry.createMany({
      data: [
        { providerId: ids.providerA, kind: 'payment', amount: 10_000, note: 'p', actorLoginName: owner.loginName, createdAt: new Date('2026-10-15T00:00:00Z') },
        { providerId: ids.providerB, kind: 'settlement', amount: -500, note: 's', actorLoginName: owner.loginName, createdAt: new Date('2026-10-16T00:00:00Z') },
      ],
    });
  });

  afterAll(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: ids.pos } });
    await prisma.line.deleteMany({ where: { posId: ids.pos } });
    await prisma.providerEntry.deleteMany({ where: { providerId: { in: [ids.providerA, ids.providerB] } } });
    await prisma.package.deleteMany({ where: { id: { in: [ids.a1, ids.a2, ids.b1] } } });
    await prisma.company.deleteMany({ where: { id: ids.company } });
    await prisma.provider.deleteMany({ where: { id: { in: [ids.providerA, ids.providerB] } } });
    await prisma.wallet.deleteMany({ where: { userId: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.pos } });
    await prisma.user.deleteMany({ where: { id: ids.owner } });
    await theCheckValidatedAgain(prisma);
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  const BEFORE = [
    ['disconnect', null, 783], ['freeze', null, null], ['fund', null, null], ['kept', null, 2100], ['noline', null, null], ['plain', null, null],
    ['release1', 'A', 1600], ['rename', null, 0], ['renamed', null, null], ['renewal', null, null], ['switched', null, null],
  ];
  const named = (rows: unknown[][]) => rows.map(([id, provider, cost]) => [id, provider === ids.providerA ? 'A' : provider === ids.providerB ? 'B' : provider, cost]);

  it('lists an entry today\'s books give to no provider and stops, changing nothing', async () => {
    await entriesStoredBeforeTheCheck(prisma, [entry('gone', 'activate', null, `pl-${tag}-gone`, null, '2026-10-11T10:00:00.000Z')]);
    const done = await backfillProviderLedger(prisma, { scope });
    expect(done.unattributed.map((row) => [row.id, row.kind, row.packageName])).toEqual([[entryId('gone'), 'activate', `pl-${tag}-gone`]]);
    expect(done).toMatchObject({ committed: false, filled: 0 });
    expect(backfillLines(done).at(-1)).toMatch(/Nothing was changed/);
    await prisma.walletEntry.delete({ where: { id: entryId('gone') } });
    expect(named(await stored())).toEqual(BEFORE);
  });

  it('rolls everything back when a stored figure differs from today\'s books', async () => {
    // Written by release 1 on provider B, while today's books give the package it names to provider A.
    await prisma.walletEntry.create({ data: entry('odd', 'freeze', ids.line1, `pl-${tag}-A1`, 0, '2026-11-02T10:00:00.000Z', { providerId: ids.providerB }) });
    const done = await backfillProviderLedger(prisma, { scope });
    expect(done.entryDifferences).toEqual([{ id: entryId('odd'), books: { providerId: ids.providerA, cost: 0 }, stored: { providerId: ids.providerB, cost: 0 } }]);
    expect(done.committed).toBe(false);
    expect(backfillLines(done).at(-1)).toMatch(/rolled back, nothing was changed/);
    await prisma.walletEntry.delete({ where: { id: entryId('odd') } });
    expect(named(await stored())).toEqual(BEFORE);
  });

  it('a dry run fills, proves every provider equal to the agora, and rolls back', async () => {
    const done = await backfillProviderLedger(prisma, { scope, dryRun: true });
    expect(done).toMatchObject({ entries: 10, filled: 9, alreadyStored: 1, entryDifferences: [], ledgerDifferences: [], committed: false });
    expect(done.providers.map((row) => [row.code, row.equal, row.books.purchases, row.stored.purchases]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      [codeA, true, 2100 + 2100 + 1700 + 2650 + 2000 + 783 + 0 + 0 + 1600, 2100 + 2100 + 1700 + 2650 + 2000 + 783 + 1600],
      [codeB, true, 2500, 2500],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(backfillLines(done).at(-1)).toBe('equal to the agora; dry run: rolled back, nothing was changed');
    expect(named(await stored())).toEqual(BEFORE);
  });

  it('commits the frozen figures; today\'s books read the same before and after, and a second run has nothing to fill', async () => {
    const books = ours(await accounts.summaries());
    const ledgers = [await accounts.detail(owner, codeA), await accounts.detail(owner, codeB)];
    const done = await backfillProviderLedger(prisma, { scope });
    expect(done).toMatchObject({ filled: 9, committed: true });
    expect(done.providers.every((row) => row.equal && row.ledgerRows > 0)).toBe(true);
    expect(named(await stored())).toEqual([
      ['disconnect', 'A', 783], ['freeze', 'A', 0], ['fund', null, null], ['kept', 'A', 2100], ['noline', 'B', 2500], ['plain', 'A', 2100],
      ['release1', 'A', 1600], ['rename', 'A', 0], ['renamed', 'A', 2650], ['renewal', 'A', 1700], ['switched', 'A', 2000],
    ]);
    expect(ours(await accounts.summaries())).toEqual(books);
    expect([await accounts.detail(owner, codeA), await accounts.detail(owner, codeB)]).toEqual(ledgers);
    // The figures are frozen: a later price change moves nothing the books read.
    await prisma.line.update({ where: { id: ids.line1 }, data: { terms: { subscription: { branchCost: 9999 }, renewal: { branchCost: 9999 } } } });
    await prisma.package.update({ where: { id: ids.a1 }, data: { branchCost: 9999 } });
    expect(ours(await accounts.summaries())).toEqual(books);
    const again = await backfillProviderLedger(prisma, { scope });
    expect(again).toMatchObject({ filled: 0, alreadyStored: 10, committed: true });
  });

  it('the command refuses an argument it does not know before it reads anything, and prints each provider\'s comparison', async () => {
    // Unscoped, the command reads the whole database: other specs' rows are in this one, so only the refusal runs here.
    expect(await run(['--force'])).toBe(2);
    const done = await backfillProviderLedger(prisma, { scope, dryRun: true });
    expect(backfillLines(done).filter((line) => line.startsWith('provider '))).toEqual([
      expect.stringMatching(new RegExp(`^provider ${codeA}: EQUAL: purchases \\d+ \\(books\\) / \\d+ \\(stored\\), balance -?\\d+ \\(books\\) / -?\\d+ \\(stored\\), available -?\\d+ \\(books\\) / -?\\d+ \\(stored\\); \\d+ operation entr\\(ies\\); \\d+ ledger row\\(s\\) compared$`)),
      expect.stringMatching(new RegExp(`^provider ${codeB}: EQUAL`)),
    ]);
  });
});
