import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import IORedis from 'ioredis';
import { createPrismaClient } from '../../db';
import { PrismaActivityRecorder } from '../auditing/activity-recorder';
import { ActivityModule } from '../auditing/activity.module';
import { hashSessionToken } from '../auth/session-token';
import { NoticeService, type NoticeBus } from '../notifications/notice.service';
import { NoticeWriterModule } from '../notifications/notice-writer.module';
import { AccountTree } from '../office/kernel/account-tree';
import { UnitOfWork } from '../office/kernel/unit-of-work';
import { PriceLadder } from '../office/terms/price-ladder';
import type { TransferKind } from '../office/transfers/transfer-rules';
import { WalletLedger } from '../office/wallets/wallet-ledger';
import { ActivityRecorder } from './activity';
import { NOTICE_WRITER, type TransferNoticePayload } from './notices';
import { capturedOutput } from './testing/captured-output';

// The two ports of slice R.2 (ADR 0020), on PostgreSQL and Redis: the notice writer the unit of work holds, and the
// activity recorder every module records through. What must not change with the move: a notice is written in the
// caller's transaction and taken back with it; it is published only after the commit, once; a publish that fails
// leaves a committed change committed; the channel and the message are the ones the browser reads; and the
// activity log names the account that acted, the one that entered for an entered session.

const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const suite = url ? describe : describe.skip;

// Compile-time: a transfer notice's kind is a transfer's kind, both ways (the contract cannot import transfers).
const toNotice = (kind: TransferKind): TransferNoticePayload['kind'] => kind;
const toTransfer = (kind: TransferNoticePayload['kind']): TransferKind => kind;
void toNotice;
void toTransfer;

/** A bus that keeps what it is asked to publish, and can be told to fail. */
function memoryBus() {
  const published: { channel: string; message: string }[] = [];
  let failing = false;
  const bus: NoticeBus = {
    async publish(channel, message) {
      if (failing) throw new Error('redis is away');
      published.push({ channel, message });
    },
    async subscribe() {
      return async () => undefined;
    },
  };
  return { bus, published, fail: () => { failing = true; } };
}

suite('the ports of slice R.2 (PostgreSQL)', () => {
  const previousUrl = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: randomUUID(), pos: randomUUID(), other: randomUUID() };
  const login = (who: keyof typeof ids) => `r2-${tag}-${who}`;
  const actor = () => ({ id: ids.owner, nickname: 'owner' });
  const draft = { kind: 'fund.received' as const, payload: { amount: 500, senderName: 'owner', note: 'r2' } };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    const user = (id: string, who: keyof typeof ids, layer: string, parentId: string | null, isBranchOwner: boolean) => ({ id, loginName: login(who), nickname: who, passwordHash: 'x', layer, parentId, isBranchOwner });
    await prisma.user.create({ data: user(ids.owner, 'owner', 'branch', null, true) });
    await prisma.user.create({ data: user(ids.pos, 'pos', 'pos', ids.owner, false) });
    await prisma.user.create({ data: user(ids.other, 'other', 'pos', ids.owner, false) });
    for (const id of Object.values(ids)) await prisma.wallet.create({ data: { userId: id, balance: 0, ceiling: 0 } });
  });

  afterAll(async () => {
    const all = Object.values(ids);
    await prisma.notice.deleteMany({ where: { userId: { in: all } } });
    await prisma.activityEvent.deleteMany({ where: { OR: [{ actorId: { in: all } }, { actorLoginName: { startsWith: `r2-${tag}` } }] } });
    await prisma.session.deleteMany({ where: { userId: { in: all } } });
    await prisma.walletEntry.deleteMany({ where: { userId: { in: all } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: all } } });
    await prisma.user.deleteMany({ where: { id: { in: all } } });
    await prisma.$disconnect();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });

  const unitOfWork = (bus: NoticeBus) => {
    const uow = new UnitOfWork(new NoticeService(bus));
    uow.prismaClient = prisma;
    return uow;
  };

  describe('notices: written in the transaction, published after it', () => {
    it('a commit keeps the row and publishes it once, after the commit and not before', async () => {
      const { bus, published } = memoryBus();
      const uow = unitOfWork(bus);
      let seenInside = -1;
      await uow.runTx(async (tx) => {
        uow.queueNotices(tx, await uow.notice.write(tx, [ids.pos], actor(), draft));
        seenInside = published.length;
      });
      expect(seenInside).toBe(0);
      expect(published.map((sent) => sent.channel)).toEqual([`notice:${ids.pos}`]);
      expect(await prisma.notice.count({ where: { userId: ids.pos, kind: 'fund.received' } })).toBe(1);
    });

    it('a rollback takes the row back and publishes nothing', async () => {
      const { bus, published } = memoryBus();
      const uow = unitOfWork(bus);
      const before = await prisma.notice.count({ where: { userId: ids.other } });
      await expect(uow.runTx(async (tx) => {
        uow.queueNotices(tx, await uow.notice.write(tx, [ids.other], actor(), draft));
        throw new Error('the change after the notice failed');
      })).rejects.toThrow('the change after the notice failed');
      expect(await prisma.notice.count({ where: { userId: ids.other } })).toBe(before);
      expect(published).toEqual([]);
    });

    it('a publish that fails after a committed money move leaves the money and the notice committed, and is logged, not thrown', async () => {
      const { bus, fail } = memoryBus();
      fail();
      const uow = unitOfWork(bus);
      const tree = new AccountTree(uow);
      const ledger = new WalletLedger(uow, tree, new PriceLadder(uow));
      const balance = async () => (await prisma.wallet.findUniqueOrThrow({ where: { userId: ids.other } })).balance;
      const start = await balance();
      let answer: string | null = null;
      const output = await capturedOutput(async () => {
        answer = await uow.runTx(async (tx) => {
          await ledger.move(tx, ids.other, 700, ids.owner, 'fund', 'r2 publish fails');
          uow.queueNotices(tx, await uow.notice.write(tx, [ids.other], actor(), draft));
          return 'committed';
        });
      });
      expect(answer).toBe('committed');
      expect(await balance()).toBe(start + 700);
      expect(await prisma.notice.count({ where: { userId: ids.other, kind: 'fund.received' } })).toBeGreaterThanOrEqual(1);
      expect(output).toContain('notice publish failed');
    });

    it('a transaction that queues nothing publishes nothing', async () => {
      const { bus, published } = memoryBus();
      const uow = unitOfWork(bus);
      await uow.runTx(async (tx) => tx.user.findUnique({ where: { id: ids.pos } }));
      expect(published).toEqual([]);
    });
  });

  (redisUrl ? describe : describe.skip)('notices: the Redis channel and the message, as the browser reads them', () => {
    const before = process.env.REDIS_URL;
    afterAll(() => {
      if (before === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = before;
    });

    it('is published on `notice:<account id>` with the list endpoint’s shape, and nothing else', async () => {
      process.env.REDIS_URL = redisUrl;
      // A plain subscriber of our own on the channel name, so the name is checked and not only the writer's view of it.
      const listener = new IORedis(redisUrl as string);
      const service = new NoticeService();
      const received: string[] = [];
      try {
        await listener.subscribe(`notice:${ids.pos}`);
        listener.on('message', (_channel: string, message: string) => received.push(message));
        const uow = new UnitOfWork(service);
        uow.prismaClient = prisma;
        await uow.runTx(async (tx) => uow.queueNotices(tx, await uow.notice.write(tx, [ids.pos], actor(), draft)));
        for (let waited = 0; received.length === 0 && waited < 3000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
        expect(received).toHaveLength(1);
        const message = JSON.parse(received[0]) as Record<string, unknown>;
        expect(Object.keys(message).sort()).toEqual(['actorName', 'createdAt', 'href', 'id', 'kind', 'payload', 'read']);
        expect(message).toMatchObject({ kind: 'fund.received', actorName: 'owner', href: '/finance', read: false, payload: draft.payload });
        // The account it is for is the channel, never a field of the message.
        expect(received[0]).not.toContain(ids.pos);
      } finally {
        await listener.quit();
        await service.onModuleDestroy();
      }
    });
  });

  describe('one notice writer, under its port and as itself', () => {
    it('the unit of work, the port and the inbox’s writer are one instance', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [NoticeWriterModule], providers: [UnitOfWork] }).compile();
      try {
        const writer = moduleRef.get(NoticeService);
        expect(moduleRef.get(NOTICE_WRITER)).toBe(writer);
        expect(moduleRef.get(UnitOfWork).notice).toBe(writer);
      } finally {
        await moduleRef.close();
      }
    });
  });

  describe('the activity log: who acted', () => {
    const session = async (userId: string, kind: 'account' | 'impersonation', operatorId: string | null = null) => {
      const token = `r2-${randomUUID()}`;
      await prisma.session.create({ data: { id: randomUUID(), tokenHash: hashSessionToken(token), userId, userAgent: 'r2', ip: '203.0.113.7', scope: 'full', kind, operatorId, expiresAt: new Date(Date.now() + 3_600_000) } });
      return token;
    };
    const recorder = () => new PrismaActivityRecorder({ client: prisma, available: true } as never);
    const last = (where: object) => prisma.activityEvent.findFirstOrThrow({ where, orderBy: { at: 'desc' } });

    it('is provided under the port by the activity module', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [ActivityModule] }).compile();
      try {
        expect(moduleRef.get(ActivityRecorder)).toBeInstanceOf(PrismaActivityRecorder);
      } finally {
        await moduleRef.close();
      }
    });

    it('an own session is recorded under its account; an entered one under the account that entered', async () => {
      await recorder().recordOffice({ sessionId: await session(ids.pos, 'account') }, '203.0.113.7', { action: 'fund', subjectKind: 'account', subjectRef: login('other') }, 'ok', '');
      expect(await last({ action: 'fund', subjectRef: login('other'), actorId: ids.pos })).toMatchObject({ actorLoginName: login('pos'), actorLayer: 'pos', result: 'ok', reason: '', ip: '203.0.113.7' });
      await recorder().recordOffice({ sessionId: await session(ids.pos, 'impersonation', ids.owner) }, '203.0.113.7', { action: 'deduct', subjectKind: 'account', subjectRef: login('other') }, 'fail', 'FORBIDDEN');
      expect(await last({ action: 'deduct', subjectRef: login('other') })).toMatchObject({ actorId: ids.owner, actorLoginName: login('owner'), actorLayer: 'branch', result: 'fail', reason: 'FORBIDDEN' });
    });

    it('a sign-in is recorded by its login name; the reason is kept for a failure only; an unknown name has no account', async () => {
      await recorder().recordLogin({ loginName: login('pos'), ip: '203.0.113.7', result: 'ok', reason: 'ignored on success' });
      expect(await last({ action: 'login', actorLoginName: login('pos') })).toMatchObject({ actorId: ids.pos, result: 'ok', reason: '' });
      await recorder().recordLogin({ loginName: `r2-${tag}-nobody`, ip: '203.0.113.7', result: 'fail', reason: 'INVALID_CREDENTIALS' });
      expect(await last({ action: 'login', actorLoginName: `r2-${tag}-nobody` })).toMatchObject({ actorId: null, actorLayer: '', result: 'fail', reason: 'INVALID_CREDENTIALS' });
    });

    it('the ordinary record swallows a failure to write; the strict one (an eSIM read) throws it', async () => {
      const broken = new PrismaActivityRecorder({ client: { session: prisma.session, user: prisma.user, line: prisma.line, activityEvent: { create: async () => { throw new Error('the log is down'); } } }, available: true } as never);
      const token = await session(ids.pos, 'account');
      const output = await capturedOutput(async () => {
        await expect(broken.recordOffice({ sessionId: token }, '', { action: 'fund' }, 'ok', '')).resolves.toBeUndefined();
      });
      expect(output).toContain('the log is down');
      await expect(broken.recordOfficeOrFail({ sessionId: token }, '', { action: 'esim_read' })).rejects.toThrow('the log is down');
    });
  });
});
