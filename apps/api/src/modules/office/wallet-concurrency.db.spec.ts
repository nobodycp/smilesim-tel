import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { MemoryAuthStore } from '../auth/auth.store';
import { createPrismaClient } from '../../db';
import type { NoticeService } from './notice.service';
import { OfficeService } from './office.service';

// Runs against a real PostgreSQL only: in-memory stores cannot show a lost update.
//   TEST_DATABASE_URL=postgresql://smilesim:smilesim@localhost:5432/smilesim_test npx jest wallet-concurrency
// The database needs the migrations applied (`DATABASE_URL=… npx prisma migrate deploy`).
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Move = (tx: unknown, userId: string, amount: number, actorId: string, kind: string, note: string) => Promise<void>;
type Internals = { runTx: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>; move: Move };

suite('wallet moves under concurrency (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: OfficeService;
  let posId: string;

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const notice = { write: async () => [], publish: async () => undefined } as unknown as NoticeService;
    service = new OfficeService(new MemoryAuthStore(), notice);
  });

  beforeEach(async () => {
    posId = randomUUID();
    await prisma.user.create({
      data: { id: posId, loginName: `race-${posId}`, nickname: 'race', passwordHash: 'x', layer: 'pos', wallet: { create: { balance: 1000, ceiling: 0 } } },
    });
  });

  afterEach(async () => {
    await prisma.walletEntry.deleteMany({ where: { userId: posId } });
    await prisma.wallet.deleteMany({ where: { userId: posId } });
    await prisma.user.deleteMany({ where: { id: posId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await (service as unknown as { prisma: { $disconnect: () => Promise<void> } }).prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  const debit = (amount: number) => {
    const inner = service as unknown as Internals;
    return inner.runTx((tx) => inner.move(tx, posId, -amount, posId, 'charge', ''));
  };

  it('keeps every concurrent debit: no update is lost', async () => {
    await Promise.all(Array.from({ length: 10 }, () => debit(50)));
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: posId } });
    expect(wallet.balance).toBe(500);
    expect(await prisma.walletEntry.count({ where: { userId: posId } })).toBe(10);
  });

  it('lets concurrent debits through only up to the ceiling', async () => {
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => debit(100)));
    const passed = results.filter((result) => result.status === 'fulfilled').length;
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: posId } });
    expect(passed).toBe(10);
    expect(wallet.balance).toBe(0);
  });
});
