import 'reflect-metadata';
import { MemoryAuthStore } from '../auth/auth.store';
import { hashOnce } from './test-hash';
import { OfficeService } from './office.service';

// A refresh or a SIM swap that the provider accepts immediately does not move money.
// It still has to land in the provider-operations report and on the line's own log,
// and the answer must say the wallet was not charged.

type Row = Record<string, unknown>;

const accounts = [
  { id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null },
  { id: 'pos1', loginName: 'pos1', nickname: 'نقطة', layer: 'pos', parentId: 'admin' },
];

const pkg = {
  id: 'pkg',
  code: 'alloha-150',
  name: '150 جيجا',
  enabled: true,
  actionModes: {},
  autoActivate: true,
  autoCharge: true,
  autoDisconnect: true,
  autoFreeze: true,
  autoSwitch: true,
  autoExtend: true,
  autoRename: true,
  autoSim: true,
  allowActivate: true,
  allowCharge: true,
  allowDisconnect: true,
  allowFreeze: true,
  allowSwitch: true,
  allowExtend: true,
  allowRename: true,
  allowSim: true,
  dataGb: 150,
  months: 1,
  branchCost: 2000,
  renewalBranchCost: 1800,
  posPrice: 3000,
  subscriberPrice: 3000,
  companyId: 'co',
  company: { name: 'الوها' },
  provider: { code: 'sky', name: 'سكاي' },
};

const line = {
  id: 'ln1',
  msisdn: '0521000001',
  iccid: '8997200000000000001',
  esim: false,
  status: 'active',
  endsAt: new Date('2026-12-04T23:00:00.000Z'),
  opsLocked: false,
  packageId: 'pkg',
  posId: 'pos1',
  terms: {},
  createdAt: new Date('2026-11-04T23:00:00.000Z'),
  package: pkg,
  pos: { loginName: 'pos1' },
};

async function office() {
  const auth = new MemoryAuthStore();
  auth.addUser({
    id: 'admin',
    loginName: 'admin',
    nickname: 'الإدارة',
    disabledAt: null,
    mustChangePassword: false,
    layer: 'branch',
    twoFactorExempt: true,
    twoFactorEnabled: false,
    isBranchOwner: true,
    passwordHash: await hashOnce('ownerpass1'),
  });
  const sessionId = await auth.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
  const wallet = { userId: 'pos1', balance: 10000, ceiling: 0 };
  const entries: Row[] = [];
  const service = new OfficeService(auth);
  const tx = {
    wallet: { findUnique: async () => wallet, update: async ({ data }: { data: { balance: number } }) => { wallet.balance = data.balance; return wallet; } },
    walletEntry: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `e${entries.length + 1}`, createdAt: new Date(), ...data };
        entries.push(row);
        return row;
      },
    },
    line: { update: async ({ data }: { data: Row }) => Object.assign(line, data) },
  };
  (service as unknown as { prismaClient: unknown }).prismaClient = {
    user: {
      findUnique: async () => ({ liveGrants: '', isBranchOwner: true }),
      findMany: async () => accounts,
    },
    line: {
      findUnique: async () => line,
      findMany: async () => [{ ...line, package: pkg }],
      count: async () => 1,
      update: tx.line.update,
    },
    officeTask: { findMany: async () => [] },
    package: { findMany: async () => [pkg] },
    packageSwitch: { findMany: async () => [] },
    provider: { findMany: async () => [{ code: 'sky', name: 'سكاي' }] },
    walletEntry: {
      findMany: async (args?: { where?: { amount?: { not?: number }; kind?: { in?: string[] }; msisdn?: { contains?: string } } }) => {
        const where = args?.where ?? {};
        return entries
          .filter((row) => (where.amount?.not === undefined ? true : row.amount !== where.amount.not))
          .filter((row) => (where.kind?.in ? where.kind.in.includes(String(row.kind)) : true))
          .filter((row) => (where.msisdn?.contains ? String(row.msisdn ?? '').includes(where.msisdn.contains) : true))
          .map((row) => ({ ...row, actor: { loginName: 'admin', nickname: 'الإدارة' }, user: { loginName: 'pos1', layer: 'pos' } }));
      },
      count: async () => entries.length,
    },
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  };
  return { service, gate: { sessionId }, wallet, entries };
}

describe('refresh is an operation on an active number only', () => {
  afterEach(() => {
    line.status = 'active';
  });

  for (const status of ['disconnected', 'frozen', 'suspended'] as const) {
    it(`is not offered and is refused on a ${status} number`, async () => {
      const { service, gate, entries } = await office();
      line.status = status;
      const listed = await service.lines(gate);
      expect(listed.lines[0].operations).not.toContain('refresh');
      const card = await service.line(gate, 'ln1');
      expect(card.line.operations).not.toContain('refresh');
      await expect(service.refreshLine(gate, 'ln1', { outcome: 'success' })).rejects.toMatchObject({ status: 400 });
      expect(entries).toEqual([]);
    });
  }

  it('is offered on an active number', async () => {
    const { service, gate } = await office();
    const card = await service.line(gate, 'ln1');
    expect(card.line.operations).toContain('refresh');
  });
});

describe('an applied operation with no charge', () => {
  it('records a refresh in the provider report and the line log without touching the wallet', async () => {
    const { service, gate, wallet, entries } = await office();
    const answer = await service.refreshLine(gate, 'ln1', { outcome: 'success' });
    expect(answer).toEqual({ applied: true, debited: false });
    expect(wallet.balance).toBe(10000);
    expect(entries).toEqual([expect.objectContaining({ kind: 'refresh', amount: 0, balanceAfter: 10000, msisdn: '0521000001', lineId: 'ln1' })]);

    const report = await service.providerOperations(gate, { q: '0521000001' });
    expect(report.entries.map((row) => row.kind)).toEqual(['refresh']);
    expect(report.stats.cost).toBe(0);

    const card = await service.line(gate, 'ln1');
    expect(card.history.map((row) => row.action)).toContain('refresh');

    const money = await service.finance(gate, { q: '0521000001' });
    expect(money.entries).toEqual([]);
  });

  it('records a SIM swap the same way', async () => {
    const { service, gate, wallet, entries } = await office();
    const answer = await service.swapSim(gate, 'ln1', { iccid: '8997000000000000002', outcome: 'success' });
    expect(answer).toEqual({ applied: true, debited: false });
    expect(wallet.balance).toBe(10000);
    expect(entries).toEqual([expect.objectContaining({ kind: 'sim', amount: 0, msisdn: '0521000001' })]);
    const report = await service.providerOperations(gate, {});
    expect(report.entries.map((row) => row.kind)).toEqual(['sim']);
  });
});
