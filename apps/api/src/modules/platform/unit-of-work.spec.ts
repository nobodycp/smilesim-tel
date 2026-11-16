import type { PrismaClient } from '../../generated/prisma/client';
import type { NoticeWriter, WrittenNotice } from './notices';
import { TRANSACTION_LIMITS, UnitOfWork } from './unit-of-work';

// The unit of work's transaction: its stated limits, and the notices it publishes only after the commit.
describe('UnitOfWork.runTx', () => {
  const made = () => {
    const calls: unknown[] = [];
    const published: WrittenNotice[][] = [];
    const tx = {};
    const notice = { publish: async (rows: WrittenNotice[]) => void published.push(rows) } as unknown as NoticeWriter;
    const uow = new UnitOfWork(notice);
    uow.prismaClient = { $transaction: async (fn: (client: unknown) => Promise<unknown>, options: unknown) => { calls.push(options); return fn(tx); } } as unknown as PrismaClient;
    return { uow, calls, published, tx };
  };

  it('states how long a transaction may wait for a connection and run: 10 s and 15 s, not Prisma\'s 2 s and 5 s', async () => {
    const { uow, calls } = made();
    expect(await uow.runTx(async () => 'done')).toBe('done');
    expect(calls).toEqual([{ maxWait: 10_000, timeout: 15_000 }]);
    expect(TRANSACTION_LIMITS).toEqual({ maxWait: 10_000, timeout: 15_000 });
  });

  it('publishes the notices a transaction queued once it has returned, and none of a transaction that threw', async () => {
    const { uow, published } = made();
    const row = { id: 'n1' } as unknown as WrittenNotice;
    await uow.runTx(async (client) => uow.queueNotices(client, [row]));
    expect(published).toEqual([[row]]);
    await expect(uow.runTx(async (client) => { uow.queueNotices(client, [row]); throw new Error('rolled back'); })).rejects.toThrow('rolled back');
    expect(published).toHaveLength(1);
  });
});
