import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/auth.store';
import { officeTestApp } from './kernel/office-test-app';
import type { NoticeService } from './notice.service';

// Posting a desk announcement over HTTP, written before the desk routes left office.controller.ts.
describe('POST /office/announcements', () => {
  let app: INestApplication;
  let session: string;
  const written: unknown[][] = [];
  const created: unknown[] = [];

  beforeEach(async () => {
    written.length = 0;
    created.length = 0;
    const store = new MemoryAuthStore();
    store.addUser({
      id: 'ag1', loginName: 'ag1', nickname: 'وكيل', disabledAt: null, mustChangePassword: false, layer: 'agent',
      twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x',
    });
    session = await store.saveSession({ userId: 'ag1', scope: 'full', userAgent: '', ip: '' });
    const account = (id: string, layer: string, parentId: string | null) => ({ id, loginName: id, nickname: id, layer, parentId, deniedOps: '', disabledAt: null });
    const tx = { announcement: { create: async (args: unknown) => { created.push(args); return { id: 'an1' }; } } };
    const tables = {
      $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx),
      user: {
        findUnique: async () => ({ liveGrants: '', isBranchOwner: false }),
        findMany: async () => [account('ma1', 'main_agent', null), account('ag1', 'agent', 'ma1'), account('pos1', 'pos', 'ag1'), account('pos2', 'pos', 'ag1')],
      },
    };
    const notice = {
      write: async (...args: unknown[]) => {
        written.push(args.slice(1));
        return [];
      },
      publish: async () => undefined,
    } as Partial<NoticeService>;
    ({ app } = await officeTestApp(store, tables, notice));
  });

  afterEach(async () => {
    await app.close();
  });

  it('posts the trimmed text and tells everyone below, not the author', async () => {
    const response = await request(app.getHttpServer()).post('/office/announcements').set('Cookie', `sid=${session}`).send({ body: '  عطلة يوم الجمعة  ' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });
    expect(created).toEqual([{ data: { authorId: 'ag1', body: 'عطلة يوم الجمعة' } }]);
    const [audience, actor, notice] = written[0] as [string[], { id: string }, { kind: string; payload: Record<string, unknown> }];
    expect(audience.sort()).toEqual(['pos1', 'pos2']);
    expect(actor.id).toBe('ag1');
    expect(notice).toEqual({ kind: 'announcement', payload: { announcementId: 'an1', authorName: 'وكيل', excerpt: 'عطلة يوم الجمعة' } });
  });

  it('refuses empty or over-long text', async () => {
    for (const body of ['   ', 'x'.repeat(401), 5]) {
      const response = await request(app.getHttpServer()).post('/office/announcements').set('Cookie', `sid=${session}`).send({ body });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'INVALID' });
    }
    expect(created).toEqual([]);
  });
});
