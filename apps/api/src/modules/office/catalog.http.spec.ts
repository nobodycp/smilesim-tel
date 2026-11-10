import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { officeTestApp } from './testing/office-test-app';

// Providers and companies over HTTP, written before these routes left office.controller.ts.

type Grants = { isBranchOwner: boolean; liveGrants: string };

describe('providers and companies over HTTP', () => {
  let app: INestApplication;
  const sessions: Record<string, string> = {};
  const writes: { model: string; args: unknown }[] = [];
  let grants: Record<string, Grants>;

  beforeEach(async () => {
    writes.length = 0;
    grants = { owner: { isBranchOwner: true, liveGrants: '' }, clerk: { isBranchOwner: false, liveGrants: '' }, pos1: { isBranchOwner: false, liveGrants: '' } };
    const store = new MemoryAuthStore();
    const add = (id: string, layer: 'branch' | 'pos', isBranchOwner: boolean) =>
      store.addUser({ id, loginName: id, nickname: id, disabledAt: null, mustChangePassword: false, layer, twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner, passwordHash: 'x' });
    add('owner', 'branch', true);
    add('clerk', 'branch', false);
    add('pos1', 'pos', false);
    for (const id of ['owner', 'clerk', 'pos1']) sessions[id] = await store.saveSession({ userId: id, scope: 'full', userAgent: '', ip: '' });
    const pkg = (code: string, company: { id: string; name: string; image: string | null } | null) => ({
      code, name: `n-${code}`, dataGb: 50, months: 1, branchCost: 1200, enabled: true, company,
      autoActivate: true, autoCharge: false, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true, autoRename: false, autoSim: true, allowDisconnect: true,
    });
    const provider = { code: 'lian', name: 'ليان', actionModes: { charge: 'manual', bogus: 'x' }, esimPrice: 300 };
    const tables = {
      user: { findUnique: async ({ where }: { where: { id: string } }) => grants[where.id] },
      provider: {
        findUnique: async ({ where }: { where: { code: string } }) => (where.code === 'lian' ? provider : null),
        findMany: async () => [{ ...provider, packages: [pkg('p2', { id: 'c2', name: 'ويكوم', image: null }), pkg('p1', { id: 'c1', name: 'الوها', image: 'data:x' }), pkg('p0', null)] }],
        update: async (args: unknown) => void writes.push({ model: 'provider', args }),
      },
      // No package inherits a mode here: a provider change writes the provider alone (spec 2026-11-09-admin-review, 3).
      package: { findMany: async () => [] },
      $transaction: async (work: Promise<unknown>[]) => Promise.all(work),
      company: {
        findUnique: async ({ where }: { where: { code: string } }) => (where.code === 'wecom' ? { id: 'c2', code: 'wecom' } : null),
        update: async (args: { data: Record<string, unknown> }) => {
          writes.push({ model: 'company', args });
          return { esimPrice: args.data.esimPrice ?? 0 };
        },
        count: async ({ where }: { where: { name: string } }) => (where.name === 'ويكوم' ? 1 : 0),
        updateMany: async (args: unknown) => void writes.push({ model: 'company', args }),
      },
    };
    ({ app } = await officeTestApp(store, tables));
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string, method: 'get' | 'post' | 'put' | 'patch', path: string, body?: object) => {
    const call = request(app.getHttpServer())[method](path).set('Cookie', `sid=${sessions[who]}`);
    return body ? call.send(body) : call;
  };

  it('lists providers with their companies sorted, and leaves out packages without a company', async () => {
    const response = await as('owner', 'get', '/office/providers');
    expect(response.status).toBe(200);
    const [lian] = response.body.providers;
    expect(lian.code).toBe('lian');
    expect(lian.companies.map((c: { name: string }) => c.name)).toEqual(['الوها', 'ويكوم']);
    expect(lian.companies[0]).toEqual({
      name: 'الوها', image: 'data:x',
      packages: [{ code: 'p1', name: 'n-p1', dataGb: 50, months: 1, price: 1200, enabled: true, autoActivate: true, autoCharge: false, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true, autoRename: false, autoSim: true, allowDisconnect: true }],
    });
    expect(lian.companies[1].image).toBe('');
    expect((await as('pos1', 'get', '/office/providers')).status).toBe(403);
  });

  it('reads provider settings with normalized modes; 404 for an unknown provider', async () => {
    const response = await as('clerk', 'get', '/office/providers/lian/settings');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ code: 'lian', name: 'ليان', esimPrice: 300 });
    expect(response.body.modes.charge).toBe('manual');
    expect(response.body.modes).not.toHaveProperty('bogus');
    expect((await as('owner', 'get', '/office/providers/none/settings')).status).toBe(404);
  });

  it('sets and clears the provider eSIM price; a staff account without edit and a bad price are refused', async () => {
    expect((await as('owner', 'patch', '/office/providers/lian/esim-price', { price: 450 })).body).toEqual({ ok: true, esimPrice: 450 });
    expect((await as('owner', 'patch', '/office/providers/lian/esim-price', { price: null })).body).toEqual({ ok: true, esimPrice: null });
    expect((await as('owner', 'patch', '/office/providers/lian/esim-price', { price: -1 })).body).toMatchObject({ code: 'INVALID' });
    expect((await as('clerk', 'patch', '/office/providers/lian/esim-price', { price: 1 })).status).toBe(403);
    expect(writes.map((w) => w.args)).toEqual([
      { where: { code: 'lian' }, data: { esimPrice: 450 } },
      { where: { code: 'lian' }, data: { esimPrice: null } },
    ]);
  });

  it('sets one provider action mode and refuses an unknown action or mode', async () => {
    const ok = await as('owner', 'patch', '/office/providers/lian/settings', { action: 'extend', mode: 'off' });
    expect(ok.body).toEqual({ ok: true });
    const saved = (writes[0].args as { data: { actionModes: Record<string, string> } }).data.actionModes;
    expect(saved).toMatchObject({ extend: 'off', charge: 'manual' });
    expect((await as('owner', 'patch', '/office/providers/lian/settings', { action: 'fly', mode: 'off' })).body).toMatchObject({ code: 'INVALID' });
    expect((await as('owner', 'patch', '/office/providers/lian/settings', { action: 'extend', mode: 'sometimes' })).body).toMatchObject({ code: 'INVALID' });
  });

  it('saves company SIM rules and refuses bad rules, other layers and unknown companies', async () => {
    const ok = await as('owner', 'put', '/office/companies/wecom/sim', { length: 19, prefix: ' 8997 ', esim: true, esimPrice: 200 });
    expect(ok.body).toEqual({ ok: true, sim: { length: 19, prefix: '8997', esim: true }, esimPrice: 200 });
    expect(writes[0].args).toEqual({ where: { id: 'c2' }, data: { iccidLength: 19, iccidPrefix: '8997', esim: true, esimPrice: 200 } });
    expect((await as('owner', 'put', '/office/companies/wecom/sim', { length: 19, prefix: 'abc', esim: true })).body).toMatchObject({ code: 'INVALID' });
    expect((await as('pos1', 'put', '/office/companies/wecom/sim', { length: 19, prefix: '', esim: false })).status).toBe(403);
    expect((await as('owner', 'put', '/office/companies/none/sim', { length: 19, prefix: '', esim: false })).status).toBe(404);
  });

  it('sets or clears a company image by name and checks the picture', async () => {
    const png = `data:image/png;base64,${Buffer.alloc(64, 1).toString('base64')}`;
    expect((await as('owner', 'post', '/office/companies/image', { name: ' ويكوم ', image: png })).body).toEqual({ ok: true });
    expect((await as('owner', 'post', '/office/companies/image', { name: 'ويكوم', image: '' })).body).toEqual({ ok: true });
    expect(writes.map((w) => w.args)).toEqual([
      { where: { name: 'ويكوم' }, data: { image: png } },
      { where: { name: 'ويكوم' }, data: { image: null } },
    ]);
    expect((await as('owner', 'post', '/office/companies/image', { name: 'ويكوم', image: 'data:image/gif;base64,AAAA' })).body).toMatchObject({ code: 'INVALID' });
    expect((await as('owner', 'post', '/office/companies/image', { name: 'غيرها', image: '' })).status).toBe(404);
    expect((await as('owner', 'post', '/office/companies/image', { name: '' })).body).toMatchObject({ code: 'INVALID' });
  });
});
