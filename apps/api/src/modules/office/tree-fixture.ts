import 'reflect-metadata';
import { MemoryAuthStore } from '../auth/auth.store';
import { hashPassword } from '../auth/password';
import { NoticeService } from './notice.service';
import { OfficeFacade } from './testing/office-facade';
import { captureTerms } from './office-rules';
import { packageTermsOf, type PackagePriceRow } from './office-terms';

// The tree the office service specs run on: branch → ma1 → ag1 → pos1 and ma1 → ag2 → pos2, plus a second
// main agent, ma2, with nothing under it. It lives here and not in a spec file because importing a spec
// registers its tests again in the importer.
// Prisma is an in-memory stand-in; every table the terms feature reads is a plain array here.
// The notice writer is the real one over a silent bus, so what it writes lands in `notices`, and a
// transaction that fails takes those rows back with everything else.

export type Row = Record<string, unknown> & { id: string };
export type Data = Record<string, unknown>;

// Hashing is slow on purpose and every account here shares one password, so it is done once per spec file.
let sharedHash: Promise<string> | null = null;
const passwordHash = () => (sharedHash ??= hashPassword('secret123'));

export const account = (id: string, layer: string, parentId: string | null, extra: Record<string, unknown> = {}) => ({
  id, loginName: id, nickname: id, layer, parentId, isBranchOwner: id === 'branch', liveGrants: '', extraGrants: '', deniedGrants: '',
  deniedOps: '', roleId: null, role: null, extraRoles: [], disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false,
  ...extra,
});

export async function tree() {
  const accounts = [
    account('branch', 'branch', null),
    account('ma1', 'main_agent', 'branch'),
    account('ma2', 'main_agent', 'branch'),
    account('ag1', 'agent', 'ma1'),
    account('ag2', 'agent', 'ma1'),
    account('pos1', 'pos', 'ag1'),
    account('pos2', 'pos', 'ag2'),
  ];
  const company = { id: 'co', code: 'alloha', name: 'الوها', image: '', iccidLength: 19, iccidPrefix: '8997202', esim: true, esimPrice: 400 };
  const provider = { id: 'pv', code: 'sky', name: 'سكاي', actionModes: {}, esimPrice: null };
  const flags = {
    autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true, autoRename: true, autoSim: true,
    allowActivate: true, allowCharge: true, allowDisconnect: true, allowFreeze: true, allowSwitch: true, allowExtend: true, allowRename: true, allowSim: true,
  };
  const prices = {
    branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800,
    renewalBranchCost: 1800, renewalMainPrice: 2200, renewalAgentPrice: 2700, renewalPosPrice: 3200, renewalSubscriberPrice: 3500,
  };
  const pkgA: Row = { id: 'pa', code: 'alloha-150', name: '150 جيجا', dataGb: 150, months: 1, enabled: true, forSale: true, actionModes: {}, esimPrice: null, companyId: 'co', providerId: 'pv', company, provider, renewals: [], ...flags, ...prices };
  const pkgB: Row = { id: 'pb', code: 'alloha-400', name: '400 جيجا', dataGb: 400, months: 1, enabled: true, forSale: true, actionModes: {}, esimPrice: null, companyId: 'co', providerId: 'pv', company, provider, renewals: [], ...flags, ...prices };
  const packages = [pkgA, pkgB];
  const userPackages: Row[] = [];
  const sellPrices: Row[] = [];
  const line: Row = {
    id: 'ln1', msisdn: '0521000001', iccid: '8997202000000000001', esim: false, esimQr: null, status: 'active',
    endsAt: new Date('2026-12-04T23:00:00.000Z'), opsLocked: false, originAgentId: null, packageId: 'pa', posId: 'pos1',
    terms: captureTerms(packageTermsOf(pkgA as unknown as PackagePriceRow), []),
    createdAt: new Date('2026-11-04T23:00:00.000Z'), package: pkgA, pos: { loginName: 'pos1' },
  };
  const lines: Row[] = [line];
  const tasks: Row[] = [];
  const entries: Row[] = [];
  const notices: Row[] = [];
  // Every account has a wallet, as the office creates them; only the first point of sale carries a balance.
  const wallet = { id: 'w-pos1', userId: 'pos1', balance: 100000, ceiling: 0 };
  const wallets: Row[] = accounts.map((row) => (row.id === 'pos1' ? wallet : { id: `w-${row.id}`, userId: row.id, balance: 0, ceiling: 0 }));

  const auth = new MemoryAuthStore();
  const gates: Record<string, { sessionId: string }> = {};
  for (const row of accounts) {
    auth.addUser({ ...row, passwordHash: await passwordHash() } as Parameters<MemoryAuthStore['addUser']>[0]);
    gates[row.id] = { sessionId: await auth.saveSession({ userId: row.id, scope: 'full', userAgent: '', ip: '' }) };
  }
  const notice = new NoticeService({ publish: async () => undefined, subscribe: async () => async () => undefined });
  const service = new OfficeFacade(auth, notice);

  const whereMatch = (row: Row, where: Record<string, unknown> | undefined) =>
    !where ||
    Object.entries(where).every(([key, value]) => {
      // A column the stored row does not carry is NULL, as it is in the database.
      if (value === null) return row[key] == null;
      if (value && typeof value === 'object' && 'not' in value) return row[key] !== (value as { not: unknown }).not;
      if (value && typeof value === 'object' && 'in' in value) return ((value as { in: unknown[] }).in).includes(row[key]);
      return row[key] === value;
    });
  const byId = (rows: Row[]) => ({
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      if (where.packageId_userId) {
        const key = where.packageId_userId as { packageId: string; userId: string };
        return rows.find((row) => row.packageId === key.packageId && row.userId === key.userId) ?? null;
      }
      if (where.packageId_ownerId) {
        const key = where.packageId_ownerId as { packageId: string; ownerId: string };
        return rows.find((row) => row.packageId === key.packageId && row.ownerId === key.ownerId) ?? null;
      }
      return rows.find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null;
    },
    findMany: async (args?: { where?: Record<string, unknown> }) => rows.filter((row) => whereMatch(row, args?.where)),
    upsert: async ({ where, update, create }: { where: Record<string, unknown>; update: Data; create: Data }) => {
      const key = (where.packageId_userId ?? where.packageId_ownerId) as Record<string, string>;
      const found = rows.find((row) => Object.entries(key).every(([k, v]) => row[k] === v));
      if (found) return Object.assign(found, update);
      const row = { id: `r${rows.length + 1}`, ...create };
      rows.push(row);
      return row;
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (whereMatch(rows[i], where)) { rows.splice(i, 1); count += 1; }
      return { count };
    },
    delete: async ({ where }: { where: Record<string, unknown> }) => {
      const key = (where.packageId_userId ?? where.packageId_ownerId ?? where) as Record<string, string>;
      const i = rows.findIndex((row) => Object.entries(key).every(([k, v]) => row[k] === v));
      const [row] = i >= 0 ? rows.splice(i, 1) : [null];
      return row;
    },
  });
  const userModel = {
    findUnique: async ({ where }: { where: { id?: string; loginName?: string } }) =>
      accounts.find((row) => (where.id ? row.id === where.id : row.loginName === where.loginName)) ?? null,
    // The database hands back a fresh object per row, so a list read before a write does not see that write.
    findMany: async () => accounts.map((row) => ({ ...row })),
    count: async ({ where }: { where: { parentId: string } }) => accounts.filter((row) => row.parentId === where.parentId).length,
    update: async ({ where, data }: { where: { id: string }; data: Data }) => Object.assign(accounts.find((row) => row.id === where.id) as Row, data),
    updateMany: async ({ where, data }: { where?: Record<string, unknown>; data: Data }) => {
      const matched = accounts.filter((row) => whereMatch(row, where));
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      // Mirrors the database: a user with terms or sell rows cannot be deleted (ON DELETE RESTRICT).
      if (userPackages.some((row) => row.userId === where.id) || sellPrices.some((row) => row.ownerId === where.id)) throw new Error('P2003');
      const i = accounts.findIndex((row) => row.id === where.id);
      return accounts.splice(i, 1)[0];
    },
  };
  const lineModel = {
    // The database hands back a fresh object, so a number the service holds keeps the point of sale it was read with
    // after a write moves it, and what the service adds to it (`posPath`, `denied`) is not stored.
    findUnique: async ({ where }: { where: { id?: string; msisdn?: string } }) => {
      const row = lines.find((item) => (where.id ? item.id === where.id : item.msisdn === where.msisdn));
      return row ? { ...row, terms: structuredClone(row.terms) } : null;
    },
    findMany: async (args?: { where?: Record<string, unknown> }) => lines.filter((row) => whereMatch(row, args?.where)),
    findFirst: async (args?: { where?: Record<string, unknown> }) => lines.find((row) => whereMatch(row, args?.where)) ?? null,
    count: async (args?: { where?: Record<string, unknown> }) => lines.filter((row) => whereMatch(row, args?.where)).length,
    groupBy: async ({ by, where, _count }: { by: string[]; where?: Record<string, unknown>; _count: { _all: true } }) => {
      if (by.join(',') !== 'packageId' || !_count?._all) return [];
      const matched = lines.filter((row) => whereMatch(row, where));
      const tallies = new Map<string, number>();
      for (const row of matched) {
        const id = row.packageId as string;
        tallies.set(id, (tallies.get(id) ?? 0) + 1);
      }
      return [...tallies.entries()].map(([packageId, count]) => ({ packageId, _count: { _all: count } }));
    },
    update: async ({ where, data }: { where: { id: string }; data: Data }) => Object.assign(lines.find((row) => row.id === where.id) as Row, data),
    updateMany: async ({ where, data }: { where?: Record<string, unknown>; data: Data }) => {
      const matched = lines.filter((row) => whereMatch(row, where));
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    },
    create: async ({ data }: { data: Data }) => {
      const row = { id: `ln${lines.length + 1}`, createdAt: new Date(), opsLocked: false, originAgentId: null, ...data, package: packages.find((p) => p.id === data.packageId), pos: { loginName: 'pos1' } };
      lines.push(row);
      return row;
    },
  };
  const taskModel = {
    create: async ({ data }: { data: Data }) => { const row = { id: `t${tasks.length + 1}`, createdAt: new Date(), updatedAt: new Date(), log: '', assigneeId: null, ...data }; tasks.push(row); return row; },
    findUnique: async ({ where }: { where: { id: string } }) => tasks.find((row) => row.id === where.id) ?? null,
    findFirst: async (args?: { where?: Record<string, unknown> }) => tasks.find((row) => whereMatch(row, args?.where)) ?? null,
    findMany: async () => [],
    count: async () => 0,
    update: async ({ where, data }: { where: { id: string }; data: Data }) => Object.assign(tasks.find((row) => row.id === where.id) as Row, data),
    // A compare-and-set on the id and the scalar fields given (the task claim, take, reject).
    updateMany: async ({ where, data }: { where: Data; data: Data }) => {
      const row = tasks.find((item) => Object.entries(where).every(([key, value]) => (value && typeof value === 'object' ? true : item[key] === value)));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  };
  const packageModel = {
    findMany: async (args?: { where?: Record<string, unknown> }) => packages.filter((row) => whereMatch(row, args?.where)),
    findUnique: async ({ where }: { where: { code?: string; id?: string } }) => packages.find((row) => (where.code ? row.code === where.code : row.id === where.id)) ?? null,
  };
  // The renewal targets each package lists, as `activate` reads them through `renewals`; none unless a test sets them.
  const packageRenewal = {
    findMany: async (args?: { where?: Record<string, unknown> }) =>
      packages
        .flatMap((pkg) => (pkg.renewals as { target: Row }[]).map(({ target }) => ({ id: `${pkg.id}>${target.id}`, packageId: pkg.id, target })))
        .filter((row) => whereMatch(row, args?.where)),
  };
  const userPackage = byId(userPackages);
  const sellPrice = byId(sellPrices);
  const walletModel = {
    findUnique: async ({ where }: { where: { userId: string } }) => wallets.find((row) => row.userId === where.userId) ?? null,
    findMany: async (args?: { where?: Record<string, unknown> }) => wallets.filter((row) => whereMatch(row, args?.where)),
    // `held` moves by increment and decrement, as the ledger writes it; every other field is set.
    update: async ({ where, data }: { where: { userId: string }; data: Data }) => {
      const row = wallets.find((item) => item.userId === where.userId) as Row;
      for (const [key, value] of Object.entries(data)) {
        const step = value as { increment?: number; decrement?: number } | null;
        if (step && typeof step === 'object' && ('increment' in step || 'decrement' in step)) row[key] = ((row[key] as number) ?? 0) + (step.increment ?? 0) - (step.decrement ?? 0);
        else row[key] = value;
      }
      return row;
    },
  };
  const tx = {
    // `move()` locks the wallet row with raw SQL; the in-memory store has nothing to lock.
    $queryRaw: async () => [],
    wallet: walletModel,
    walletEntry: {
      create: async ({ data }: { data: Data }) => { const row = { id: `e${entries.length + 1}`, createdAt: new Date(), ...data }; entries.push(row); return row; },
      // A switch quote reads the line's paid periods; none are stored here, so it prices the open window.
      findMany: async () => [],
    },
    line: lineModel,
    officeTask: taskModel,
    package: packageModel,
    packageRenewal,
    packageAddon: { findMany: async () => [], findUnique: async () => null },
    user: userModel,
    userPackage,
    sellPrice,
    notice: {
      createMany: async ({ data }: { data: Data[] }) => {
        for (const row of data) notices.push({ id: `n${notices.length + 1}`, ...row });
        return { count: data.length };
      },
    },
  };
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: userModel,
    line: lineModel,
    officeTask: taskModel,
    package: packageModel,
    packageRenewal,
    packageAddon: { findMany: async () => [], findUnique: async () => null },
    packageSwitch: { findMany: async () => [{ target: { code: 'alloha-400' }, targetId: 'pb' }] },
    userPackage,
    sellPrice,
    wallet: { ...tx.wallet, deleteMany: async () => ({ count: 0 }) },
    session: { deleteMany: async () => ({ count: 0 }) },
    provider: { findMany: async () => [provider] },
    role: null,
    walletEntry: { findMany: async () => [], findFirst: async () => null, count: async () => 0 },
    // A failed transaction puts back everything a write in it can touch, as the database would: the accounts
    // (their parent and stops), both terms tables, every line (its terms and its point of sale), the wallet
    // entries, and the notices written so far.
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      const keep = {
        accounts: new Map(accounts.map((row) => [row, { ...row }] as const)),
        userPackages: userPackages.map((row) => ({ ...row })),
        sellPrices: sellPrices.map((row) => ({ ...row })),
        lines: new Map(lines.map((row) => [row, { ...row, terms: structuredClone(row.terms) }] as const)),
        entries: entries.map((row) => ({ ...row })),
        notices: notices.map((row) => ({ ...row })),
        tasks: tasks.map((row) => ({ ...row })),
        wallets: new Map(wallets.map((row) => [row, { ...row }] as const)),
      };
      try {
        return await run(tx);
      } catch (error) {
        for (const [row, stored] of keep.accounts) Object.assign(row, stored);
        userPackages.splice(0, userPackages.length, ...keep.userPackages);
        sellPrices.splice(0, sellPrices.length, ...keep.sellPrices);
        for (const [row, stored] of keep.lines) Object.assign(row, stored);
        entries.splice(0, entries.length, ...keep.entries);
        notices.splice(0, notices.length, ...keep.notices);
        tasks.splice(0, tasks.length, ...keep.tasks);
        for (const [row, stored] of keep.wallets) Object.assign(row, stored);
        throw error;
      }
    },
  };
  return { service, auth, notice, notices, gates, accounts, packages, pkgA, pkgB, userPackages, sellPrices, line, lines, tasks, entries, wallet, wallets };
}
