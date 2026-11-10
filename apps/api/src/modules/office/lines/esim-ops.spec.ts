import 'reflect-metadata';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { hashOnce } from '../testing/test-hash';
import type { NoticeService } from '../notices/notice.service';
import { OfficeFacade } from '../testing/office-facade';

// An eSIM request is a branch task priced from the package, the provider, or the company; the employee
// closes it with the serial and the QR picture, which land on the line. A SIM swap stays free.
// A number change that became a task takes its new number when the employee closes it.

// These cases render eSIM QR pictures, which is CPU work: alone the file takes ~4 s, but under the full parallel
// run one case can cross Jest's 5 s default, and 20 s when another process holds the CPU (seen with the
// graphify rebuild running). The wider limit is for that contention, not for a slow case.
jest.setTimeout(60_000);

type Row = Record<string, unknown>;

const QR = `data:image/png;base64,${'A'.repeat(64)}`;

const accounts = [
  { id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null, isBranchOwner: true, liveGrants: '' },
  { id: 'pos1', loginName: 'pos1', nickname: 'نقطة', layer: 'pos', parentId: 'admin', isBranchOwner: false, liveGrants: '' },
];

function fixtures() {
  const company: Row = { id: 'co', code: 'alloha', name: 'الوها', iccidLength: 19, iccidPrefix: '8997202', esim: true, esimPrice: 400 };
  const provider: Row = { id: 'pv', code: 'sky', name: 'سكاي', actionModes: {}, esimPrice: null };
  const pkg: Row = {
    id: 'pkg', code: 'alloha-150', name: '150 جيجا', enabled: true, forSale: true, actionModes: {},
    autoActivate: true, autoCharge: true, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true, autoRename: true, autoSim: true,
    allowActivate: true, allowCharge: true, allowDisconnect: true, allowFreeze: true, allowSwitch: true, allowExtend: true, allowRename: true, allowSim: true,
    dataGb: 150, months: 1, branchCost: 2000, renewalBranchCost: 1800, posPrice: 3000, subscriberPrice: 3000, esimPrice: null,
    companyId: 'co', providerId: 'pv', company, provider, renewals: [],
  };
  const line: Row = {
    id: 'ln1', msisdn: '0521000001', iccid: '8997202000000000001', esim: false, esimQr: null, status: 'active',
    endsAt: new Date('2026-12-04T23:00:00.000Z'), opsLocked: false, packageId: 'pkg', posId: 'pos1', terms: {},
    createdAt: new Date('2026-11-04T23:00:00.000Z'), package: pkg, pos: { loginName: 'pos1' },
  };
  return { company, provider, pkg, line };
}

async function office() {
  const { company, provider, pkg, line } = fixtures();
  const auth = new MemoryAuthStore();
  auth.addUser({
    id: 'admin', loginName: 'admin', nickname: 'الإدارة', disabledAt: null, mustChangePassword: false, layer: 'branch',
    twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: true, passwordHash: await hashOnce('ownerpass1'),
  });
  const sessionId = await auth.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
  const wallet = { userId: 'pos1', balance: 10000, ceiling: 0 };
  const entries: Row[] = [];
  const tasks: Row[] = [];
  const otherLines: Row[] = [];
  const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
  const service = new OfficeFacade(auth, notice);
  const lineById = (id: unknown) => (id === line.id ? line : otherLines.find((row) => row.id === id) ?? null);
  const lineByMsisdn = (msisdn: unknown) => [line, ...otherLines].find((row) => row.msisdn === msisdn) ?? null;
  const lineModel = {
    findUnique: async ({ where }: { where: { id?: string; msisdn?: string } }) => (where.id ? lineById(where.id) : lineByMsisdn(where.msisdn)),
    findMany: async () => [line],
    // The live number that holds a SIM serial, as the uniqueness check asks for it.
    findFirst: async ({ where }: { where: { iccid: string; id?: { not: string } } }) =>
      [line, ...otherLines].find((row) => row.iccid === where.iccid && row.status !== 'disconnected' && row.id !== where.id?.not) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(lineById(where.id) as Row, data),
    // A guarded status change: only from one of the statuses named.
    updateMany: async ({ where, data }: { where: { id: string; status: { in: string[] } }; data: Row }) => {
      const row = lineById(where.id);
      if (!row || !where.status.in.includes(row.status as string)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `ln${otherLines.length + 2}`, createdAt: new Date(), opsLocked: false, ...data, package: pkg, pos: { loginName: 'pos1' } };
      otherLines.push(row);
      return row;
    },
  };
  const taskModel = {
    create: async ({ data }: { data: Row }) => {
      const row = { id: `t${tasks.length + 1}`, createdAt: new Date(), updatedAt: new Date(), log: '', assigneeId: null, ...data };
      tasks.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) => tasks.find((row) => row.id === where.id) ?? null,
    findFirst: async ({ where }: { where: Row }) => tasks.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
    findMany: async () => [],
    update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(tasks.find((row) => row.id === where.id) as Row, data),
    updateMany: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = tasks.find((item) => item.id === where.id);
      if (row) Object.assign(row, data);
      return { count: row ? 1 : 0 };
    },
  };
  const tx = {
    // `move()` locks the wallet row with raw SQL; the in-memory store has nothing to lock.
    $queryRaw: async () => [],
    wallet: {
      findUnique: async () => wallet,
      // A hold changes `held` by increment/decrement (roadmap N6); a move writes the balance.
      update: async ({ data }: { data: { balance?: number; held?: { increment?: number; decrement?: number } } }) => {
        if (data.balance !== undefined) wallet.balance = data.balance;
        if (data.held) (wallet as { held?: number }).held = ((wallet as { held?: number }).held ?? 0) + (data.held.increment ?? 0) - (data.held.decrement ?? 0);
        return wallet;
      },
    },
    walletEntry: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `e${entries.length + 1}`, createdAt: new Date(), ...data };
        entries.push(row);
        return row;
      },
    },
    line: lineModel,
    officeTask: taskModel,
    package: { findUnique: async () => pkg, findMany: async () => [pkg] },
    packageAddon: { findMany: async () => [] },
    // Closing an activation task stamps the renewal price, which reads the terms tables inside the transaction.
    userPackage: { findMany: async () => [] },
    sellPrice: { findMany: async () => [] },
    user: { findUnique: async ({ where }: { where: { id: string } }) => accounts.find((row) => row.id === where.id) ?? null, findMany: async () => accounts },
    notice: { createMany: async () => ({ count: 0 }) },
  };
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: {
      findUnique: async () => ({ liveGrants: '', isBranchOwner: true }),
      findMany: async () => accounts,
    },
    line: lineModel,
    officeTask: taskModel,
    package: { findMany: async () => [pkg], findUnique: async () => pkg },
    packageAddon: { findMany: async () => [] },
    packageSwitch: { findMany: async () => [] },
    userPackage: { findUnique: async () => null, findMany: async () => [] },
    sellPrice: { findMany: async () => [] },
    provider: { findMany: async () => [provider] },
    walletEntry: {
      findMany: async (args?: { where?: { kind?: { in?: string[] } } }) => {
        const kinds = args?.where?.kind?.in;
        return entries
          .filter((row) => (kinds ? kinds.includes(String(row.kind)) : true))
          .map((row) => ({ ...row, actor: { loginName: 'admin', nickname: 'الإدارة' }, user: { loginName: 'pos1', layer: 'pos' } }));
      },
      findFirst: async () => null,
    },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  const gate = { sessionId };
  // Takes the newest task so the owner can close it.
  const work = async () => {
    const task = tasks[tasks.length - 1];
    Object.assign(task, { status: 'working', assigneeId: 'admin' });
    return task;
  };
  return { service, gate, wallet, entries, tasks, otherLines, company, provider, pkg, line, work };
}

describe('eSIM request', () => {
  it('opens a task priced from the company when neither provider nor package say otherwise', async () => {
    const { service, gate, tasks, wallet } = await office();
    const answer = await service.requestEsim(gate, 'ln1');
    expect(answer).toEqual({ applied: false, taskId: 't1' });
    expect(tasks[0]).toMatchObject({ action: 'esim', posDelta: -400, esim: true, iccid: null, msisdn: '0521000001' });
    expect(wallet.balance).toBe(10000);
  });

  it('prices from the provider over the company, and from the package over both', async () => {
    const { service, gate, tasks, provider, pkg } = await office();
    provider.esimPrice = 600;
    await service.requestEsim(gate, 'ln1');
    expect(tasks[0].posDelta).toBe(-600);
    // One open request per number: the first is closed before the next is priced.
    tasks[0].status = 'cancelled';
    pkg.esimPrice = 700;
    await service.requestEsim(gate, 'ln1');
    expect(tasks[1].posDelta).toBe(-700);
  });

  it('refuses when the company does not take eSIM', async () => {
    const { service, gate, tasks, company } = await office();
    company.esim = false;
    await expect(service.requestEsim(gate, 'ln1')).rejects.toMatchObject({ code: 'ESIM_UNSUPPORTED' });
    expect(tasks).toEqual([]);
  });

  it('is offered on the line card only while the company takes eSIM', async () => {
    const { service, gate, company } = await office();
    expect((await service.line(gate, 'ln1')).line.operations).toContain('esim');
    company.esim = false;
    expect((await service.line(gate, 'ln1')).line.operations).not.toContain('esim');
  });

  it('closes with the serial and the QR: both land on the line and the point of sale pays', async () => {
    const { service, gate, wallet, entries, line, work } = await office();
    await service.requestEsim(gate, 'ln1');
    const task = await work();
    await expect(service.completeTask(gate, String(task.id), { note: '' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.completeTask(gate, String(task.id), { iccid: '8997202000000000002', qr: 'not-a-picture' })).rejects.toMatchObject({ code: 'QR_INVALID' });
    await expect(service.completeTask(gate, String(task.id), { iccid: '1234', qr: QR })).rejects.toMatchObject({ code: 'SIM_LENGTH' });
    expect(line.iccid).toBe('8997202000000000001');
    expect(wallet.balance).toBe(10000);

    await service.completeTask(gate, String(task.id), { iccid: '8997202000000000002', qr: QR, note: 'صدرت' });
    expect(line).toMatchObject({ iccid: '8997202000000000002', esim: true, esimQr: QR });
    expect(task).toMatchObject({ status: 'done', iccid: '8997202000000000002' });
    expect(wallet.balance).toBe(10000 - 400);
    // The fee is the provider's cost of the eSIM, so provider operations can show it.
    // The task held its price when it opened and released it when it closed; the charge is the one money entry.
    expect(entries.map((row) => row.kind)).toEqual(['hold', 'release', 'esim']);
    expect(entries.filter((row) => row.amount !== 0)).toEqual([expect.objectContaining({ kind: 'esim', amount: -400, msisdn: '0521000001', lineId: 'ln1', providerCost: 400 })]);
  });
});

describe('SIM swap', () => {
  it('writes a physical serial for free and clears any QR', async () => {
    const { service, gate, wallet, line } = await office();
    line.esim = true;
    line.esimQr = QR;
    const answer = await service.swapSim(gate, 'ln1', { iccid: '8997202000000000003', outcome: 'success' });
    expect(answer).toEqual({ applied: true, debited: false });
    expect(line).toMatchObject({ iccid: '8997202000000000003', esim: false, esimQr: null });
    expect(wallet.balance).toBe(10000);
  });

  it('marks an eSIM the branch already holds, with its QR, for free', async () => {
    const { service, gate, wallet, line } = await office();
    await service.swapSim(gate, 'ln1', { iccid: '8997202000000000004', esim: true, qr: QR, outcome: 'success' });
    expect(line).toMatchObject({ iccid: '8997202000000000004', esim: true, esimQr: QR });
    expect(wallet.balance).toBe(10000);
  });

  it('refuses an eSIM on a company that does not take it', async () => {
    const { service, gate, company } = await office();
    company.esim = false;
    await expect(service.swapSim(gate, 'ln1', { iccid: '8997202000000000004', esim: true, outcome: 'success' })).rejects.toMatchObject({ code: 'ESIM_UNSUPPORTED' });
  });
});

describe('number change through a task', () => {
  it('may be requested without a number and takes it when the employee closes the task', async () => {
    const { service, gate, line, otherLines, work } = await office();
    const answer = await service.renameLine(gate, 'ln1', { outcome: 'fail' });
    expect(answer).toEqual({ applied: false, taskId: 't1' });
    const task = await work();
    expect(task.msisdn).toBeNull();
    otherLines.push({ id: 'ln2', msisdn: '0521000009' });
    await expect(service.completeTask(gate, String(task.id), { msisdn: '0521000009' })).rejects.toMatchObject({ code: 'NUMBER_TAKEN' });
    await expect(service.completeTask(gate, String(task.id), { msisdn: '12' })).rejects.toMatchObject({ code: 'INVALID' });
    expect(task.status).toBe('working');
    await service.completeTask(gate, String(task.id), { msisdn: '0521000005' });
    expect(line.msisdn).toBe('0521000005');
    expect(task).toMatchObject({ status: 'done', msisdn: '0521000005' });
  });

  it('still needs the number when the provider applies it at once', async () => {
    const { service, gate } = await office();
    await expect(service.renameLine(gate, 'ln1', { outcome: 'success' })).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('line card', () => {
  it('reports the last recharge from activate, charge, extend, or reactivate entries only', async () => {
    const { service, gate, entries } = await office();
    expect((await service.line(gate, 'ln1')).line.lastRechargeAt).toBeNull();
    entries.push({ id: 'e1', kind: 'activate', amount: -3000, createdAt: new Date('2026-11-04T23:00:00.000Z'), lineId: 'ln1', msisdn: '0521000001' });
    entries.push({ id: 'e2', kind: 'sim', amount: 0, createdAt: new Date('2026-11-06T10:00:00.000Z'), lineId: 'ln1', msisdn: '0521000001' });
    entries.push({ id: 'e3', kind: 'switch', amount: -500, createdAt: new Date('2026-11-07T10:00:00.000Z'), lineId: 'ln1', msisdn: '0521000001' });
    const card = await service.line(gate, 'ln1');
    expect(card.line.lastRechargeAt).toBe('2026-11-04T23:00:00.000Z');
    expect(card.line.esimPrice).toBe(400);
    expect(card.line.esimQr).toBeNull();
  });
});

describe('immediate eSIM activation', () => {
  it('issues the serial and the QR from the provider and stores them on the new line', async () => {
    const { service, gate, otherLines, entries, wallet } = await office();
    const answer = await service.activate(gate, { packageCode: 'alloha-150', posLogin: 'pos1', esim: true, iccid: '', outcome: 'success' });
    expect(answer.applied).toBe(true);
    expect(answer.debited).toBe(true);
    const issued = answer.line;
    expect(issued).toBeDefined();
    expect(Object.keys(issued ?? {}).sort()).toEqual(['esim', 'esimQr', 'iccid', 'id', 'msisdn']);
    expect(issued?.esim).toBe(true);
    expect(issued?.msisdn).toMatch(/^05\d{8}$/);
    expect(issued?.iccid).toMatch(/^8997202\d{12}$/);
    expect(issued?.esimQr).toMatch(/^data:image\/png;base64,/);
    expect(otherLines[0]).toMatchObject({ esim: true, esimQr: issued?.esimQr, iccid: issued?.iccid, status: 'active' });
    // Package price plus the company eSIM price, in one debit.
    expect(wallet.balance).toBe(10000 - 3000 - 400);
    // The entry carries the provider's cost: the package branch cost plus the eSIM fee.
    // Hold and release move no money; the charge is the first entry that does.
    expect(entries.find((row) => row.amount !== 0)).toMatchObject({ kind: 'activate', amount: -3400, providerCost: 2000 + 400 });
  }); // Renders a real PNG; slow when the whole suite runs in parallel: the file-wide limit above covers it.

  it('keeps the typed serial for a physical SIM and issues no QR', async () => {
    const { service, gate, otherLines, entries } = await office();
    const answer = await service.activate(gate, { packageCode: 'alloha-150', posLogin: 'pos1', esim: false, iccid: '8997202000000000777', outcome: 'success' });
    expect(answer.line).toMatchObject({ esim: false, iccid: '8997202000000000777', esimQr: null });
    expect(otherLines[0]).toMatchObject({ esim: false, esimQr: null });
    // No eSIM: the provider cost stays unset and provider operations fall back to the package cost.
    expect(entries[0].providerCost).toBeNull();
  });

  it('carries the eSIM fee into the provider cost when the branch closes the activation task', async () => {
    const { service, gate, entries, work } = await office();
    await service.activate(gate, { packageCode: 'alloha-150', posLogin: 'pos1', esim: true, iccid: '', outcome: 'fail' });
    const task = await work();
    await service.completeTask(gate, String(task.id), { iccid: '8997202000000000003', qr: QR });
    // Hold and release move no money; the charge is the first entry that does.
    expect(entries.find((row) => row.amount !== 0)).toMatchObject({ kind: 'activate', amount: -3400, providerCost: 2000 + 400 });
  });

  it('shows package plus eSIM fee, and the eSIM request fee, in provider operations', async () => {
    const { service, gate, work } = await office();
    await service.activate(gate, { packageCode: 'alloha-150', posLogin: 'pos1', esim: true, iccid: '', outcome: 'success' });
    await service.requestEsim(gate, 'ln1');
    const task = await work();
    await service.completeTask(gate, String(task.id), { iccid: '8997202000000000002', qr: QR });
    const listed = await service.providerOperations(gate);
    const byKind = Object.fromEntries(listed.items.map((row) => [row.kind, row.cost]));
    expect(byKind).toEqual({ activate: 2400, esim: 400 });
    // Each row also names the eSIM fee inside its cost, so the page can tag it.
    expect(listed.items.map((row) => row.esimPrice)).toEqual([400, 400]);
    expect(listed.stats.cost).toBe(2800);
  });

  it('keeps the typed serial and the eSIM flag when the provider takes the number and serial from the seller', async () => {
    const { service, gate, otherLines, entries, provider } = await office();
    provider.code = 'tokman';
    const answer = await service.activate(gate, {
      packageCode: 'alloha-150', posLogin: 'pos1', esim: true, iccid: '8997202000000000555', msisdn: '0521000777', outcome: 'success',
    });
    expect(answer.line).toMatchObject({ msisdn: '0521000777', esim: true, iccid: '8997202000000000555', esimQr: null });
    expect(otherLines[0]).toMatchObject({ esim: true, iccid: '8997202000000000555' });
    expect(entries[0]).toMatchObject({ amount: -3400, providerCost: 2400 });
  });

  it('opens a task without a serial or QR when the provider fails', async () => {
    const { service, gate, tasks } = await office();
    const answer = await service.activate(gate, { packageCode: 'alloha-150', posLogin: 'pos1', esim: true, iccid: '', outcome: 'fail' });
    expect(answer).toEqual({ applied: false, taskId: 't1' });
    expect(tasks[0]).toMatchObject({ action: 'activate', esim: true, iccid: null });
  });
});

// The full wallet (roadmap N6): a task that will charge holds its price while it is open.
describe('automatic hold', () => {
  it('holds the price when the task opens and gives it back when the task is cancelled', async () => {
    const { service, gate, entries, wallet, work } = await office();
    await service.requestEsim(gate, 'ln1');
    expect(wallet).toMatchObject({ balance: 10000, held: 400 });
    expect(entries.map((row) => [row.kind, row.amount, row.held])).toEqual([['hold', 0, 400]]);
    const task = await work();
    await service.rejectTask(gate, String(task.id), { reason: 'لا يوجد مخزون' });
    expect(wallet).toMatchObject({ balance: 10000, held: 0 });
    expect(entries.map((row) => [row.kind, row.held])).toEqual([['hold', 400], ['release', -400]]);
  });

  it('refuses a task whose price the wallet cannot cover, counting what is already held', async () => {
    const { service, gate, wallet, tasks } = await office();
    Object.assign(wallet, { balance: 600, held: 300 });
    await expect(service.requestEsim(gate, 'ln1')).rejects.toMatchObject({ status: 400, code: 'BALANCE_CEILING' });
    expect(tasks).toHaveLength(0);
    expect(wallet).toMatchObject({ balance: 600, held: 300 });
  });
});
