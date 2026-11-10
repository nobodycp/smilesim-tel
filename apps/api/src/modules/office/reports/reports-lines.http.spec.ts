import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { officeTestApp } from '../testing/office-test-app';

// Branch reports, and the refusals of the disconnect quote and reactivation, over HTTP. Written before these
// routes left office.controller.ts.

describe('reports and line refusals over HTTP', () => {
  let app: INestApplication;
  const sessions: Record<string, string> = {};
  const grants: Record<string, { isBranchOwner: boolean; liveGrants: string }> = {
    owner: { isBranchOwner: true, liveGrants: '' },
    clerk: { isBranchOwner: false, liveGrants: '' },
    analyst: { isBranchOwner: false, liveGrants: 'reports' },
    ag1: { isBranchOwner: false, liveGrants: 'reports' },
  };
  let line: Record<string, unknown>;

  beforeEach(async () => {
    const store = new MemoryAuthStore();
    const add = (id: string, layer: 'branch' | 'agent', isBranchOwner: boolean) =>
      store.addUser({ id, loginName: id, nickname: id, disabledAt: null, mustChangePassword: false, layer, twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner, passwordHash: 'x' });
    add('owner', 'branch', true);
    add('clerk', 'branch', false);
    add('analyst', 'branch', false);
    add('ag1', 'agent', false);
    for (const id of Object.keys(grants)) sessions[id] = await store.saveSession({ userId: id, scope: 'full', userAgent: '', ip: '' });
    const pkg = { id: 'pk', code: 'p1', name: 'باقة', branchCost: 2000, actionModes: {}, provider: { name: 'ليان' }, company: { name: 'ويكوم' }, _count: { lines: 4 } };
    line = { id: 'ln1', posId: 'owner', status: 'active', opsLocked: true, endsAt: new Date('2027-01-01'), terms: null, package: { ...pkg, company: { name: 'ويكوم' }, provider: { name: 'ليان' } } };
    const entry = { id: 'e1', createdAt: new Date('2026-11-08T09:00:00.000Z'), user: { loginName: 'pos1' }, actor: { loginName: 'owner' }, amount: -2000, balanceAfter: 500, kind: 'activate', note: null };
    const tables = {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => grants[where.id],
        findMany: async () => [{ id: 'owner', loginName: 'owner', nickname: 'owner', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null }],
      },
      package: { findMany: async () => [pkg] },
      walletEntry: { findMany: async () => [entry], count: async () => 1 },
      line: { findUnique: async () => line },
    };
    ({ app } = await officeTestApp(store, tables));
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string, method: 'get' | 'post', path: string, body?: object) => {
    const call = request(app.getHttpServer())[method](path).set('Cookie', `sid=${sessions[who]}`);
    return body ? call.send(body) : call;
  };

  it('opens reports to the owner and to branch staff with the reports grant only', async () => {
    expect((await as('clerk', 'get', '/office/reports/providers')).body).toMatchObject({ code: 'REPORTS_BRANCH_ONLY' });
    expect((await as('ag1', 'get', '/office/reports/providers')).body).toMatchObject({ code: 'REPORTS_BRANCH_ONLY' });
    expect((await as('analyst', 'get', '/office/reports/providers')).status).toBe(200);
    expect((await as('owner', 'get', '/office/reports/nothing')).status).toBe(404);
  });

  it('reports providers and packages, and the operations ledger', async () => {
    expect((await as('owner', 'get', '/office/reports/providers')).body).toEqual({
      items: [{ providerName: 'ليان', companyName: 'ويكوم', packageName: 'باقة', price: 2000, lines: 4 }], nextCursor: null, total: 1,
    });
    expect((await as('owner', 'get', '/office/reports/operations')).body).toEqual({
      total: 1,
      items: [{ id: 'e1', at: '2026-11-08T09:00:00.000Z', loginName: 'pos1', actorLoginName: 'owner', amount: -2000, balanceAfter: 500, kind: 'activate', note: null }],
      nextCursor: null,
    });
  });

  it('refuses a disconnect quote and a reactivation on a number locked for a package switch', async () => {
    expect((await as('owner', 'get', '/office/lines/ln1/disconnect-quote')).body).toMatchObject({ code: 'SWITCH_PACKAGE_FIRST' });
    expect((await as('owner', 'post', '/office/lines/ln1/reactivate', { outcome: 'success' })).body).toMatchObject({ code: 'SWITCH_PACKAGE_FIRST' });
    // The outcome is judged before the number is read.
    expect((await as('owner', 'post', '/office/lines/ln1/reactivate', { outcome: 'maybe' })).body).toMatchObject({ code: 'INVALID' });
  });
});
