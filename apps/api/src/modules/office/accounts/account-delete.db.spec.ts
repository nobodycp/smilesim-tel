import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { NoticeService } from '../../notifications/notice.service';
import { OfficeFacade } from '../testing/office-facade';

// Runs against a real PostgreSQL only (see wallet-concurrency.db.spec.ts for how to give it one): in-memory tables
// do not roll back and cannot show a delete racing a movement of money. Plan backend-loose-ends A.1.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('deleting an account (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  const tag = randomUUID().slice(0, 8);
  const owner = randomUUID();
  const made: string[] = [];
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeFacade;
  let auth: MemoryAuthStore;
  let gate: { sessionId: string };

  const login = (name: string) => `del-${tag}-${name}`;

  /** A point of sale under the owner, with a wallet, known to the session store too. */
  async function pos(name: string) {
    const id = randomUUID();
    const row = { id, loginName: login(name), nickname: name, passwordHash: 'x', layer: 'pos', parentId: owner, isBranchOwner: false };
    await prisma.user.create({ data: { ...row, wallet: { create: { balance: 0, ceiling: 0 } } } });
    auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    made.push(id);
    return id;
  }

  const left = async (id: string) => ({
    user: await prisma.user.count({ where: { id } }),
    wallet: await prisma.wallet.count({ where: { userId: id } }),
    entries: await prisma.walletEntry.count({ where: { userId: id } }),
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    auth = new MemoryAuthStore();
    const row = { id: owner, loginName: login('owner'), nickname: 'owner', passwordHash: 'x', layer: 'branch', parentId: null, isBranchOwner: true };
    await prisma.user.create({ data: { ...row, wallet: { create: { balance: 1_000_000, ceiling: 0 } } } });
    auth.addUser({ ...row, disabledAt: null, mustChangePassword: false, twoFactorExempt: true, twoFactorEnabled: false } as Parameters<MemoryAuthStore['addUser']>[0]);
    gate = { sessionId: await auth.saveSession({ userId: owner, scope: 'full', userAgent: '', ip: '' }) };
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new OfficeFacade(auth, notice);
  });

  afterAll(async () => {
    const ids = [owner, ...made];
    await prisma.notice.deleteMany({ where: { userId: { in: ids } } });
    await prisma.walletEntry.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } });
    await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.user.deleteMany({ where: { id: owner } });
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('removes an account without history together with its wallet', async () => {
    const id = await pos('clean');
    await expect(service.removeUser(gate, login('clean'))).resolves.toEqual({ ok: true });
    expect(await left(id)).toEqual({ user: 0, wallet: 0, entries: 0 });
  });

  it('refuses an account with history and leaves it whole', async () => {
    const id = await pos('funded');
    await service.fund(gate, login('funded'), { amount: 500, note: 'test' });
    await expect(service.removeUser(gate, login('funded'))).rejects.toMatchObject({ status: 400, code: 'HAS_HISTORY' });
    expect(await left(id)).toMatchObject({ user: 1, wallet: 1 });
    expect((await prisma.wallet.findUnique({ where: { userId: id } }))?.balance).toBe(500);
  });

  it('never leaves half an account when a delete races a movement of money', async () => {
    for (let round = 0; round < 5; round += 1) {
      const name = `race${round}`;
      const id = await pos(name);
      const [removed, funded] = await Promise.allSettled([
        service.removeUser(gate, login(name)),
        service.fund(gate, login(name), { amount: 100, note: 'race' }),
      ]);
      // Exactly one of the two wins: either the account is gone with everything of its own, or it is whole and
      // holds the money.
      expect([removed.status, funded.status].filter((status) => status === 'fulfilled')).toHaveLength(1);
      const after = await left(id);
      if (removed.status === 'fulfilled') expect(after).toEqual({ user: 0, wallet: 0, entries: 0 });
      else expect(after).toMatchObject({ user: 1, wallet: 1 });
    }
  });
});
