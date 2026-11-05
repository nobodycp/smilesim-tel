import 'reflect-metadata';
import { MemoryAuthStore } from '../auth/auth.store';
import { hashPassword } from '../auth/password';
import type { NoticeService } from './notice.service';
import { OfficeService } from './office.service';
import { captureTerms } from './office-rules';
import { packageTermsOf, type PackagePriceRow } from './office-terms';

// The tree: branch → ma1 → ag1 → pos1, plus ag2 under ma1 for transfers.
// Prisma is an in-memory stand-in; every table the terms feature reads is a plain array here.

type Row = Record<string, unknown> & { id: string };
type Data = Record<string, unknown>;

const account = (id: string, layer: string, parentId: string | null, extra: Record<string, unknown> = {}) => ({
  id, loginName: id, nickname: id, layer, parentId, isBranchOwner: id === 'branch', liveGrants: '', extraGrants: '', deniedGrants: '',
  deniedOps: '', roleId: null, role: null, extraRoles: [], disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false,
  ...extra,
});

export async function tree() {
  const accounts = [
    account('branch', 'branch', null),
    account('ma1', 'main_agent', 'branch'),
    account('ag1', 'agent', 'ma1'),
    account('ag2', 'agent', 'ma1'),
    account('pos1', 'pos', 'ag1'),
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
    endsAt: new Date('2026-12-04T23:00:00.000Z'), opsLocked: false, packageId: 'pa', posId: 'pos1',
    terms: captureTerms(packageTermsOf(pkgA as unknown as PackagePriceRow), []),
    createdAt: new Date('2026-11-04T23:00:00.000Z'), package: pkgA, pos: { loginName: 'pos1' },
  };
  const lines: Row[] = [line];
  const tasks: Row[] = [];
  const entries: Row[] = [];
  const wallet = { userId: 'pos1', balance: 100000, ceiling: 0 };

  const auth = new MemoryAuthStore();
  const gates: Record<string, { sessionId: string }> = {};
  for (const row of accounts) {
    auth.addUser({ ...row, passwordHash: await hashPassword('secret123') } as Parameters<MemoryAuthStore['addUser']>[0]);
    gates[row.id] = { sessionId: await auth.saveSession({ userId: row.id, scope: 'full', userAgent: '', ip: '' }) };
  }
  const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
  const service = new OfficeService(auth, notice);

  const whereMatch = (row: Row, where: Record<string, unknown> | undefined) =>
    !where ||
    Object.entries(where).every(([key, value]) => {
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
    findMany: async () => accounts,
    count: async ({ where }: { where: { parentId: string } }) => accounts.filter((row) => row.parentId === where.parentId).length,
    update: async ({ where, data }: { where: { id: string }; data: Data }) => Object.assign(accounts.find((row) => row.id === where.id) as Row, data),
    delete: async ({ where }: { where: { id: string } }) => {
      // Mirrors the database: a user with terms or sell rows cannot be deleted (ON DELETE RESTRICT).
      if (userPackages.some((row) => row.userId === where.id) || sellPrices.some((row) => row.ownerId === where.id)) throw new Error('P2003');
      const i = accounts.findIndex((row) => row.id === where.id);
      return accounts.splice(i, 1)[0];
    },
  };
  const lineModel = {
    findUnique: async ({ where }: { where: { id?: string; msisdn?: string } }) => lines.find((row) => (where.id ? row.id === where.id : row.msisdn === where.msisdn)) ?? null,
    findMany: async () => lines,
    count: async (args?: { where?: Record<string, unknown> }) => lines.filter((row) => whereMatch(row, args?.where)).length,
    update: async ({ where, data }: { where: { id: string }; data: Data }) => Object.assign(lines.find((row) => row.id === where.id) as Row, data),
    updateMany: async () => ({ count: 0 }),
    create: async ({ data }: { data: Data }) => {
      const row = { id: `ln${lines.length + 1}`, createdAt: new Date(), opsLocked: false, ...data, package: packages.find((p) => p.id === data.packageId), pos: { loginName: 'pos1' } };
      lines.push(row);
      return row;
    },
  };
  const taskModel = {
    create: async ({ data }: { data: Data }) => { const row = { id: `t${tasks.length + 1}`, createdAt: new Date(), updatedAt: new Date(), log: '', assigneeId: null, ...data }; tasks.push(row); return row; },
    findUnique: async ({ where }: { where: { id: string } }) => tasks.find((row) => row.id === where.id) ?? null,
    findMany: async () => [],
    count: async () => 0,
    update: async ({ where, data }: { where: { id: string }; data: Data }) => Object.assign(tasks.find((row) => row.id === where.id) as Row, data),
    updateMany: async () => ({ count: 0 }),
  };
  const packageModel = {
    findMany: async () => packages,
    findUnique: async ({ where }: { where: { code?: string; id?: string } }) => packages.find((row) => (where.code ? row.code === where.code : row.id === where.id)) ?? null,
  };
  const userPackage = byId(userPackages);
  const sellPrice = byId(sellPrices);
  const tx = {
    wallet: { findUnique: async () => wallet, update: async ({ data }: { data: { balance: number } }) => { wallet.balance = data.balance; return wallet; } },
    walletEntry: { create: async ({ data }: { data: Data }) => { const row = { id: `e${entries.length + 1}`, createdAt: new Date(), ...data }; entries.push(row); return row; } },
    line: lineModel,
    officeTask: taskModel,
    package: packageModel,
    user: userModel,
    userPackage,
    sellPrice,
    notice: { createMany: async () => ({ count: 0 }) },
  };
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: userModel,
    line: lineModel,
    officeTask: taskModel,
    package: packageModel,
    packageSwitch: { findMany: async () => [{ target: { code: 'alloha-400' }, targetId: 'pb' }] },
    userPackage,
    sellPrice,
    wallet: { ...tx.wallet, deleteMany: async () => ({ count: 0 }) },
    session: { deleteMany: async () => ({ count: 0 }) },
    provider: { findMany: async () => [provider] },
    role: null,
    walletEntry: { findMany: async () => [], findFirst: async () => null, count: async () => 0 },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  return { service, gates, accounts, packages, pkgA, pkgB, userPackages, sellPrices, line, lines, tasks, entries, wallet };
}

describe('catalog through user terms', () => {
  it('omits a package hidden on the agent from the point of sale, not from the main agent', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'ag1', hidden: true, price: null, renewalPrice: null });
    const pos = await service.packages(gates.pos1);
    expect(pos.packages.map((row) => row.code)).toEqual(['alloha-150']);
    const ma = await service.packages(gates.ma1);
    expect(ma.packages.map((row) => row.code).sort()).toEqual(['alloha-150', 'alloha-400']);
  });

  it('shows the point of sale its own price and whether it may activate', async () => {
    const { service, gates, userPackages, accounts } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: 2900, renewalPrice: null });
    (accounts.find((row) => row.id === 'ma1') as Row).deniedOps = 'activate';
    const pos = await service.packages(gates.pos1);
    const row = pos.packages.find((item) => item.code === 'alloha-150');
    expect(row).toMatchObject({ price: 2900, renewalPrice: 3200, canActivate: false });
    const plain = pos.packages.find((item) => item.code === 'alloha-400');
    expect(plain).toMatchObject({ price: 3500, renewalPrice: 3200, canActivate: false });
  });

  it('shows an agent its own sell price and the layer default it replaces', async () => {
    const { service, gates, sellPrices } = await tree();
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: null });
    const agent = await service.packages(gates.ag1);
    const row = agent.packages.find((item) => item.code === 'alloha-150');
    expect(row).toMatchObject({ sellPrice: 3700, sellRenewalPrice: null, sellDefault: 3500, sellRenewalDefault: 3200 });
    const plain = agent.packages.find((item) => item.code === 'alloha-400');
    expect(plain).toMatchObject({ sellPrice: null, sellRenewalPrice: null, sellDefault: 3500 });
    const pos = await service.packages(gates.pos1);
    expect(pos.packages.find((item) => item.code === 'alloha-150')).toMatchObject({ price: 3700, sellDefault: null });
  });
});

describe('run path through user terms', () => {
  it('refuses to activate a package hidden above the point of sale', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'ag1', hidden: true, price: null, renewalPrice: null });
    await expect(service.activate(gates.branch, { packageCode: 'alloha-150', posLogin: 'pos1', iccid: '8997202000000000002', outcome: 'success' }))
      .rejects.toMatchObject({ code: 'PACKAGE_HIDDEN' });
  });

  it('a charge stopped on the main agent is refused and absent for the point of sale', async () => {
    const { service, gates, accounts, line } = await tree();
    (accounts.find((row) => row.id === 'ma1') as Row).deniedOps = 'charge';
    line.status = 'disconnected';
    await expect(service.operate(gates.pos1, 'ln1', 'charge', { outcome: 'success' })).rejects.toMatchObject({ code: 'OPERATION_DENIED', status: 403 });
    const card = await service.line(gates.pos1, 'ln1');
    expect(card.line.operations).not.toContain('charge');
  });

  it('the user stop is checked before the package mode', async () => {
    const { service, gates, accounts, pkgA } = await tree();
    (accounts.find((row) => row.id === 'pos1') as Row).deniedOps = 'freeze';
    pkgA.actionModes = { freeze: 'off' };
    await expect(service.operate(gates.pos1, 'ln1', 'freeze', { outcome: 'success' })).rejects.toMatchObject({ code: 'OPERATION_DENIED' });
  });

  it('an eSIM request stopped on the account is refused', async () => {
    const { service, gates, accounts } = await tree();
    (accounts.find((row) => row.id === 'pos1') as Row).deniedOps = 'esim';
    await expect(service.requestEsim(gates.pos1, 'ln1')).rejects.toMatchObject({ code: 'OPERATION_DENIED' });
  });

  it('a switch target hidden above the point of sale is not offered', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'ag1', hidden: true, price: null, renewalPrice: null });
    const card = await service.line(gates.pos1, 'ln1');
    expect(card.line.switchTargets).toEqual([]);
    await expect(service.switchPackage(gates.pos1, 'ln1', { packageCode: 'alloha-400', outcome: 'success' })).rejects.toMatchObject({ code: 'PACKAGE_HIDDEN' });
  });

  it('activation debits the special price, else the parent sell price, else the layer price', async () => {
    const activate = (iccid: string) => ({ packageCode: 'alloha-150', posLogin: 'pos1', iccid, outcome: 'success' as const });
    const custom = await tree();
    custom.userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: 2900, renewalPrice: null });
    await custom.service.activate(custom.gates.pos1, activate('8997202000000000002'));
    expect(custom.entries[0]).toMatchObject({ kind: 'activate', amount: -2900 });

    const sold = await tree();
    sold.sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: null });
    await sold.service.activate(sold.gates.pos1, activate('8997202000000000003'));
    expect(sold.entries[0]).toMatchObject({ kind: 'activate', amount: -3700 });

    const plain = await tree();
    await plain.service.activate(plain.gates.pos1, activate('8997202000000000004'));
    expect(plain.entries[0]).toMatchObject({ kind: 'activate', amount: -3500 });
  });

  it('moving a point of sale drops the terms its old parent wrote', async () => {
    const { service, gates, userPackages, accounts, wallet } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: 2900, renewalPrice: null });
    userPackages.push({ id: 'r2', packageId: 'pa', userId: 'ag1', hidden: true, price: null, renewalPrice: null });
    wallet.balance = 0;
    await service.transferPos(gates.branch, 'pos1', { parentLogin: 'ag2' });
    expect(userPackages.map((row) => row.userId)).toEqual(['ag1']);
    expect((accounts.find((row) => row.id === 'pos1') as Row).parentId).toBe('ag2');
  });
});

describe('writing user terms', () => {
  const row = (userId: string, patch: Record<string, unknown> = {}) => ({ id: `x-${userId}`, packageId: 'pa', userId, hidden: false, price: null, renewalPrice: null, setById: '', ...patch });

  it('the parent may not price below what it pays itself; zero margin passes', async () => {
    const { service, gates, userPackages } = await tree();
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { price: 2800 })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
    const saved = await service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { price: 3000 });
    expect(saved).toMatchObject({ code: 'alloha-150', price: 3000, effective: 3000, source: 'custom', parentBuy: 3000 });
    expect(userPackages).toHaveLength(1);
    expect(userPackages[0]).toMatchObject({ userId: 'pos1', price: 3000, setById: 'ag1' });
  });

  it('a later rise of the parent buy price does not block the hide switch on an older row', async () => {
    const { service, gates, userPackages, sellPrices } = await tree();
    userPackages.push(row('pos1', { price: 3000 }));
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ma1', price: 3200, renewalPrice: null });
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { hidden: true })).resolves.toMatchObject({ hidden: true, price: 3000, parentBuy: 3200 });
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { renewalPrice: 3300 })).resolves.toMatchObject({ renewalPrice: 3300 });
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { price: 3000 })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
  });

  it('deleting an account removes its terms and sell rows first', async () => {
    const { service, gates, userPackages, sellPrices, accounts } = await tree();
    userPackages.push({ ...row('ag2', { hidden: true }), packageId: 'pb' });
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag2', price: 3100, renewalPrice: null });
    await expect(service.removeUser(gates.branch, 'ag2')).resolves.toEqual({ ok: true });
    expect(accounts.some((item) => item.id === 'ag2')).toBe(false);
    expect(userPackages).toHaveLength(0);
    expect(sellPrices).toHaveLength(0);
  });

  it('only the direct parent or the branch may write', async () => {
    const { service, gates } = await tree();
    await expect(service.setUserPackage(gates.ma1, 'pos1', 'alloha-150', { hidden: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setUserPackage(gates.pos1, 'pos1', 'alloha-150', { hidden: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setUserPackage(gates.branch, 'pos1', 'alloha-150', { hidden: true })).resolves.toMatchObject({ hidden: true });
  });

  it('a parent cannot unhide what an ancestor hid; the branch can clear the ancestor row', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push(row('ma1', { hidden: true }));
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { hidden: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setUserPackage(gates.branch, 'ma1', 'alloha-150', { hidden: false })).resolves.toMatchObject({ hidden: false });
    expect(userPackages).toHaveLength(0);
  });

  it('a row back on its defaults is deleted, not kept', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push(row('pos1', { price: 3100, renewalPrice: 3000 }));
    await service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { price: null, renewalPrice: null });
    expect(userPackages).toHaveLength(0);
  });

  it('bulk hide skips packages already hidden above and reports the summary', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push({ ...row('ma1', { hidden: true }), packageId: 'pb' });
    const out = await service.setUserPackagesBulk(gates.ag1, 'pos1', { codes: ['alloha-150', 'alloha-400'], hidden: true });
    expect(userPackages.filter((item) => item.userId === 'pos1').map((item) => item.packageId)).toEqual(['pa']);
    expect(out.summary).toEqual({ total: 2, visible: 0, custom: 0 });
  });

  it('lists the user packages grouped by company with the inherited state', async () => {
    const { service, gates, userPackages, sellPrices } = await tree();
    userPackages.push({ ...row('ma1', { hidden: true }), packageId: 'pb' });
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3100, renewalPrice: null });
    const sheet = await service.userPackages(gates.ag1, 'pos1');
    expect(sheet.summary).toEqual({ total: 2, visible: 1, custom: 0 });
    expect(sheet.companies).toHaveLength(1);
    const [a, b] = sheet.companies[0].packages;
    expect(a).toMatchObject({ code: 'alloha-150', hidden: false, hiddenAbove: null, parentBuy: 3000, effective: 3100, renewalEffective: 3200, source: 'parent' });
    expect(b).toMatchObject({ code: 'alloha-400', hidden: false, hiddenAbove: 'ma1' });
  });

  it('custom prices list the priced users only and clearing keeps a hide', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push(row('pos1', { price: 2900 }));
    userPackages.push(row('ag2', { hidden: true }));
    const listed = await service.customPrices(gates.branch, 'alloha-150');
    expect(listed.map((item) => item.loginName)).toEqual(['pos1']);
    expect(listed[0]).toMatchObject({ layer: 'pos', parentLogin: 'ag1', defaultPrice: 3500, defaultRenewalPrice: 3200, price: 2900, renewalPrice: null });
    await expect(service.customPrices(gates.ma1, 'alloha-150')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.setCustomPrice(gates.branch, 'alloha-150', 'ag2', { price: 2950 });
    expect(userPackages.find((item) => item.userId === 'ag2')).toMatchObject({ hidden: true, price: 2950 });
    await service.clearCustomPrice(gates.branch, 'alloha-150', 'ag2');
    expect(userPackages.find((item) => item.userId === 'ag2')).toMatchObject({ hidden: true, price: null, renewalPrice: null });
  });

  it('a sell price is owned by a main agent or agent and floored at its own buy', async () => {
    const { service, gates, sellPrices } = await tree();
    await expect(service.setSellPrice(gates.ag1, 'alloha-150', { price: 2999 })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
    await expect(service.setSellPrice(gates.pos1, 'alloha-150', { price: 4000 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setSellPrice(gates.branch, 'alloha-150', { price: 4000 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setSellPrice(gates.ag1, 'alloha-150', { price: 3000, renewalPrice: 2700 })).resolves.toEqual({ price: 3000, renewalPrice: 2700 });
    expect(sellPrices[0]).toMatchObject({ ownerId: 'ag1', price: 3000, renewalPrice: 2700 });
  });

  it('operation stops: the parent writes, cannot lift an inherited stop, the branch can', async () => {
    const { service, gates, accounts } = await tree();
    (accounts.find((item) => item.id === 'ma1') as Row).deniedOps = 'charge';
    await expect(service.userOps(gates.ag1, 'pos1')).resolves.toEqual({ denied: [], deniedAbove: [{ op: 'charge', login: 'ma1' }] });
    await expect(service.setUserOps(gates.ag1, 'pos1', { denied: ['sim'] })).resolves.toMatchObject({ denied: ['sim'] });
    expect((accounts.find((item) => item.id === 'pos1') as Row).deniedOps).toBe('sim');
    await expect(service.setUserOps(gates.ag1, 'ma1', { denied: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setUserOps(gates.branch, 'ma1', { denied: [] })).resolves.toMatchObject({ denied: [] });
  });

  it('an old offer row keeps the renewal charge it had', async () => {
    const { service, gates, userPackages, line, entries } = await tree();
    userPackages.push(row('pos1', { price: 3100, renewalPrice: 3100 }));
    line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await service.extend(gates.pos1, 'ln1', { outcome: 'success' });
    expect(entries[0]).toMatchObject({ kind: 'extend', amount: -3100 });
  });
});
