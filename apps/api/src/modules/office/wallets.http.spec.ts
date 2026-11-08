import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/auth.store';
import { officeTestApp } from './kernel/office-test-app';

// GET /office/wallets over HTTP, written before the wallet routes left office.controller.ts.
describe('GET /office/wallets', () => {
  let app: INestApplication;
  let session: string;

  beforeEach(async () => {
    const store = new MemoryAuthStore();
    store.addUser({
      id: 'ag1', loginName: 'ag1', nickname: 'وكيل', disabledAt: null, mustChangePassword: false, layer: 'agent',
      twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x',
    });
    session = await store.saveSession({ userId: 'ag1', scope: 'full', userAgent: '', ip: '' });
    const account = (id: string, layer: string, parentId: string | null) => ({ id, loginName: id, nickname: `n-${id}`, layer, parentId, deniedOps: '', disabledAt: null });
    const tables = {
      user: {
        findUnique: async () => ({ liveGrants: '', isBranchOwner: false }),
        findMany: async () => [
          account('admin', 'branch', null),
          account('ag1', 'agent', 'ma1'),
          account('ma1', 'main_agent', 'admin'),
          account('pos1', 'pos', 'ag1'),
          account('pos9', 'pos', 'ag9'),
        ],
      },
      wallet: {
        findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
          [{ userId: 'ag1', balance: 5000, ceiling: 1000 }, { userId: 'pos1', balance: -200, ceiling: 300 }].filter((row) => where.userId.in.includes(row.userId)),
      },
    };
    ({ app } = await officeTestApp(store, tables));
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists the wallets the agent sees: its own and its points of sale, with parent and relation', async () => {
    const response = await request(app.getHttpServer()).get('/office/wallets').set('Cookie', `sid=${session}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      wallets: [
        { loginName: 'ag1', nickname: 'n-ag1', layer: 'agent', balance: 5000, ceiling: 1000, parentLogin: 'ma1', self: true, directChild: false },
        { loginName: 'pos1', nickname: 'n-pos1', layer: 'pos', balance: -200, ceiling: 300, parentLogin: 'ag1', self: false, directChild: true },
      ],
    });
  });
});
