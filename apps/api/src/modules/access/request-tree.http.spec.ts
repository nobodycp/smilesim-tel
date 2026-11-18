import 'reflect-metadata';
import { Controller, Get, INestApplication, Post, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { defer, lastValueFrom } from 'rxjs';
import request from 'supertest';
import { AUTH_STORE } from '../auth/auth.store';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { NOTICE_WRITER_PROVIDERS } from '../notifications/notice-writer.module';
import { UnitOfWork } from '../platform/unit-of-work';
import { SHARED_COLLABORATORS } from '../testing/collaborators';
import { AccountTree, withRequestTree } from './account-tree';
import { ActorInterceptor } from './actor.interceptor';

// The account tree is read once a GET request (plan 2026-11-17-speed, PF.9): every `accounts()` of one GET shares
// one read; a request never shares another's; a write route reads afresh after its write; a transaction's client
// reads through the transaction every time; whatever outlives the request reads afresh.

type Row = { id: string; loginName: string; nickname: string; layer: string; parentId: string | null; deniedOps: string; disabledAt: Date | null };

const row = (id: string, layer: string, parentId: string | null): Row => ({ id, loginName: id, nickname: id, layer, parentId, deniedOps: '', disabledAt: null });

/** A user table that counts its whole-tree reads. */
function users(rows: Row[]) {
  const table = {
    reads: 0,
    rows,
    findMany: async () => {
      table.reads += 1;
      return table.rows.map((account) => ({ ...account }));
    },
    findUnique: async ({ where }: { where: { id: string } }) => ({ ...table.rows.find((account) => account.id === where.id), liveGrants: '', isBranchOwner: false }),
  };
  return table;
}

describe('AccountTree.accounts inside and outside a request', () => {
  let table: ReturnType<typeof users>;
  let tree: AccountTree;
  let uow: UnitOfWork;

  beforeEach(() => {
    table = users([row('owner', 'branch', null), row('pos1', 'pos', 'owner')]);
    uow = { prisma: { user: table } } as unknown as UnitOfWork;
    tree = new AccountTree(uow);
  });

  /** Work run as a GET handler is: inside `withRequestTree`, to its end. */
  const inRequest = <T>(work: () => Promise<T>) => lastValueFrom(withRequestTree(() => defer(work)));

  it('reads on every call outside a request, as before', async () => {
    await tree.accounts();
    await tree.accounts();
    expect(table.reads).toBe(2);
  });

  it('reads once for every call of one request, at once or one after another, each caller its own list', async () => {
    const [first, second, third] = await inRequest(async () => {
      const both = await Promise.all([tree.accounts(), tree.accounts()]);
      return [...both, await tree.accounts()];
    });
    expect(table.reads).toBe(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.pop();
    expect(third).toHaveLength(2);
  });

  it('never shares a read between two requests, even at the same time', async () => {
    await Promise.all([inRequest(() => tree.accounts()), inRequest(() => tree.accounts())]);
    await inRequest(() => tree.accounts());
    expect(table.reads).toBe(3);
  });

  it('a transaction client reads through the transaction on every call, inside a request too', async () => {
    const txUsers = users([row('owner', 'branch', null)]);
    const tx = { user: txUsers } as never;
    await inRequest(async () => {
      await tree.accounts();
      expect(await tree.accounts(tx)).toHaveLength(1);
      expect(await tree.accounts(tx)).toHaveLength(1);
      expect(await tree.accounts()).toHaveLength(2);
    });
    expect(txUsers.reads).toBe(2);
    expect(table.reads).toBe(1);
  });

  it('does not keep a failed read: the next call reads again', async () => {
    const findMany = table.findMany;
    let failures = 1;
    table.findMany = async () => {
      if (failures-- > 0) {
        table.reads += 1;
        throw new Error('down');
      }
      return findMany();
    };
    const list = await inRequest(async () => {
      await expect(tree.accounts()).rejects.toThrow('down');
      return tree.accounts();
    });
    expect(list).toHaveLength(2);
    expect(table.reads).toBe(2);
  });
});

describe('ActorInterceptor shares the tree within a GET only', () => {
  let app: INestApplication;
  let session: string;
  let table: ReturnType<typeof users>;
  let later: Promise<number> | null;

  @Controller('probe')
  @UseInterceptors(ActorInterceptor)
  class ProbeController {
    constructor(private readonly tree: AccountTree) {}

    @Get('tree')
    async read() {
      const first = await this.tree.accounts();
      const second = await this.tree.accounts();
      // Work the handler leaves behind runs after the request: it reads afresh.
      later = new Promise((resolve) => setTimeout(() => void this.tree.accounts().then((list) => resolve(list.length)), 5));
      // The reads so far are told by the handler itself: the work left behind may run before the caller has the answer.
      return { first: first.length, second: second.length, reads: table.reads };
    }

    /** As an account-changing route does: reads, writes an account, reads again. */
    @Post('tree')
    async write() {
      const before = await this.tree.accounts();
      table.rows.push(row(`pos${table.rows.length}`, 'pos', 'owner'));
      const after = await this.tree.accounts();
      return { before: before.length, after: after.length };
    }
  }

  beforeEach(async () => {
    later = null;
    table = users([row('owner', 'branch', null), row('pos1', 'pos', 'owner')]);
    const store = new MemoryAuthStore();
    store.addUser({
      id: 'pos1', loginName: 'pos1', nickname: 'pos1', disabledAt: null, mustChangePassword: false, layer: 'pos',
      twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x',
    });
    session = await store.saveSession({ userId: 'pos1', scope: 'full', userAgent: '', ip: '' });
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [...NOTICE_WRITER_PROVIDERS, ...SHARED_COLLABORATORS, { provide: AUTH_STORE, useValue: store }],
    }).compile();
    moduleRef.get(UnitOfWork).prismaClient = { user: table } as unknown as UnitOfWork['prismaClient'];
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('a GET reads the tree once however often its handler asks; the next GET reads it again', async () => {
    expect((await http().get('/probe/tree').set('Cookie', `sid=${session}`)).body).toEqual({ first: 2, second: 2, reads: 1 });
    expect(await later).toBe(2);
    expect(table.reads).toBe(2);
    // The next GET reads once more, whatever its own left-behind work has done by the time it answers.
    expect((await http().get('/probe/tree').set('Cookie', `sid=${session}`)).body).toEqual({ first: 2, second: 2, reads: 3 });
  });

  it('a write route sees the account it wrote: it reads the tree afresh after its write', async () => {
    expect((await http().post('/probe/tree').set('Cookie', `sid=${session}`)).body).toEqual({ before: 2, after: 3 });
    expect(table.reads).toBe(2);
  });

  it('a GET after a write sees the write', async () => {
    await http().get('/probe/tree').set('Cookie', `sid=${session}`);
    await http().post('/probe/tree').set('Cookie', `sid=${session}`);
    expect((await http().get('/probe/tree').set('Cookie', `sid=${session}`)).body).toMatchObject({ first: 3, second: 3 });
  });
});
