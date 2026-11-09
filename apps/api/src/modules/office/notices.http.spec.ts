import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/auth.store';
import { officeTestApp } from './kernel/office-test-app';
import { encodeFeedCursor } from './office-paging';

// The notice inbox over HTTP: written before the notices routes left office.controller.ts, so the move is
// checked against what the routes answered before it.

type Row = { id: string; userId: string; kind: string; payload: unknown; actorName: string; href: string; readAt: Date | null; createdAt: Date };

const at = (minute: number) => new Date(Date.UTC(2026, 10, 8, 10, minute));
const row = (id: string, kind: string, minute: number, readAt: Date | null = null): Row => ({
  id, userId: 'pos1', kind, payload: { n: id }, actorName: 'الفرع', href: `/tasks/${id}`, readAt, createdAt: at(minute),
});

describe('notices over HTTP', () => {
  let app: INestApplication;
  let session: string;
  let rows: Row[];
  const calls: { findMany: unknown[]; count: unknown[]; updateMany: unknown[] } = { findMany: [], count: [], updateMany: [] };
  let subscribed: string[];

  beforeEach(async () => {
    calls.findMany = []; calls.count = []; calls.updateMany = [];
    subscribed = [];
    rows = [row('n3', 'task.opened', 3), row('n2', 'fund.received', 2, at(5)), row('n1', 'transfer.in', 1)];
    const store = new MemoryAuthStore();
    store.addUser({
      id: 'pos1', loginName: 'pos1', nickname: 'نقطة', disabledAt: null, mustChangePassword: false, layer: 'pos',
      twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x',
    });
    session = await store.saveSession({ userId: 'pos1', scope: 'full', userAgent: '', ip: '' });
    const tables = {
      user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: false }) },
      notice: {
        findMany: async (args: unknown) => {
          calls.findMany.push(args);
          return rows;
        },
        count: async (args: { where: { readAt?: null } }) => {
          calls.count.push(args);
          return args.where.readAt === null ? 2 : rows.length;
        },
        updateMany: async (args: unknown) => {
          calls.updateMany.push(args);
          return { count: 1 };
        },
      },
    };
    const notice = {
      subscribe: async (userId: string) => {
        subscribed.push(userId);
        return async () => undefined;
      },
    };
    ({ app } = await officeTestApp(store, tables, notice));
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', `sid=${session}`);

  it('lists the inbox newest first with the unread count and the total', async () => {
    const response = await get('/office/notices');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      unread: 2,
      total: 3,
      notices: [
        { id: 'n3', kind: 'task.opened', payload: { n: 'n3' }, actorName: 'الفرع', href: '/tasks/n3', read: false, createdAt: at(3).toISOString() },
        { id: 'n2', kind: 'fund.received', payload: { n: 'n2' }, actorName: 'الفرع', href: '/tasks/n2', read: true, createdAt: at(2).toISOString() },
        { id: 'n1', kind: 'transfer.in', payload: { n: 'n1' }, actorName: 'الفرع', href: '/tasks/n1', read: false, createdAt: at(1).toISOString() },
      ],
      nextCursor: null,
    });
    expect(calls.findMany[0]).toMatchObject({ where: { userId: 'pos1', AND: [] }, take: 41 });
  });

  it('filters by group and unread, and pages from a cursor', async () => {
    const cursor = encodeFeedCursor({ createdAt: at(2), id: 'n2' });
    const response = await get(`/office/notices?group=tasks&unread=1&cursor=${cursor}`);
    expect(response.status).toBe(200);
    const where = (calls.findMany[0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ userId: 'pos1', readAt: null, kind: { in: expect.arrayContaining(['task.opened']) } });
    expect(where.AND).toEqual([{ OR: [{ createdAt: { lt: at(2) } }, { createdAt: at(2), id: { lt: 'n2' } }] }]);
  });

  it('refuses a cursor it did not issue with 400 INVALID', async () => {
    const response = await get('/office/notices?cursor=not-ours');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID' });
  });

  it('answers 401 without a session, on the list, the read, and the stream', async () => {
    for (const call of [
      () => request(app.getHttpServer()).get('/office/notices'),
      () => request(app.getHttpServer()).post('/office/notices/read').send({}),
      () => request(app.getHttpServer()).get('/office/notices/stream'),
    ]) {
      const response = await call();
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: 'يلزم تسجيل الدخول', code: 'LOGIN_REQUIRED' });
    }
    expect(subscribed).toEqual([]);
  });

  it('marks one notice read, or all of them when no id is sent', async () => {
    const one = await request(app.getHttpServer()).post('/office/notices/read').set('Cookie', `sid=${session}`).send({ id: 'n3' });
    expect(one.status).toBe(201);
    expect(one.body).toEqual({ ok: true });
    const all = await request(app.getHttpServer()).post('/office/notices/read').set('Cookie', `sid=${session}`).send({ id: 42 });
    expect(all.status).toBe(201);
    expect(calls.updateMany).toEqual([
      { where: { userId: 'pos1', readAt: null, id: 'n3' }, data: { readAt: expect.any(Date) } },
      { where: { userId: 'pos1', readAt: null }, data: { readAt: expect.any(Date) } },
    ]);
  });

  it('opens the live stream for the signed-in user', async () => {
    const server = app.getHttpServer();
    await new Promise<void>((resolve, reject) => {
      const call = request(server).get('/office/notices/stream').set('Cookie', `sid=${session}`).buffer(false);
      call.parse((response, done) => {
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('text/event-stream');
        response.once('data', (chunk: Buffer) => {
          expect(chunk.toString()).toBe(': open\n\n');
          expect(subscribed).toEqual(['pos1']);
          (response as unknown as { destroy: () => void }).destroy();
          done(null, null);
          resolve();
        });
      });
      call.end((error) => {
        if (error && !String(error.message).includes('aborted') && error.code !== 'ECONNRESET') reject(error);
      });
    });
  });
});
