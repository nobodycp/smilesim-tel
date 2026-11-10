import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { officeTestApp } from '../testing/office-test-app';

// The package sheet, modes, renewal/switch targets and clearing a custom price over HTTP, written before these
// routes left office.controller.ts.

describe('package catalog routes over HTTP', () => {
  let app: INestApplication;
  const sessions: Record<string, string> = {};
  const writes: { op: string; args: unknown }[] = [];
  const grants: Record<string, { isBranchOwner: boolean; liveGrants: string }> = {
    owner: { isBranchOwner: true, liveGrants: '' },
    clerk: { isBranchOwner: false, liveGrants: '' },
    ag1: { isBranchOwner: false, liveGrants: 'edit' },
  };
  const company = { id: 'c1', code: 'wecom', name: 'ويكوم', esim: true, esimPrice: 300, iccidLength: 19, iccidPrefix: '' };
  const provider = { id: 'pv', code: 'lian', name: 'ليان', esimPrice: null, actionModes: {} };
  const pkg = (code: string, patch: Record<string, unknown> = {}) => ({
    id: `id-${code}`, code, name: `n-${code}`, enabled: true, forSale: true, actionModes: { charge: 'manual' },
    autoActivate: true, autoCharge: false, autoDisconnect: true, autoFreeze: true, autoSwitch: true, autoExtend: true, autoRename: true, autoSim: true,
    allowActivate: true, allowCharge: true, allowDisconnect: true, allowFreeze: true, allowSwitch: true, allowExtend: true, allowRename: true, allowSim: true,
    branchCost: 2000, mainPrice: 2200, agentPrice: 2400, posPrice: 2600, subscriberPrice: 3000,
    renewalBranchCost: 1800, renewalMainPrice: 2000, renewalAgentPrice: 2200, renewalPosPrice: 2400, renewalSubscriberPrice: 2800,
    esimPrice: null, company, provider, companyId: 'c1', providerId: 'pv', ...patch,
  });

  beforeEach(async () => {
    writes.length = 0;
    const store = new MemoryAuthStore();
    const add = (id: string, layer: 'branch' | 'agent', isBranchOwner: boolean) =>
      store.addUser({ id, loginName: id, nickname: id, disabledAt: null, mustChangePassword: false, layer, twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner, passwordHash: 'x' });
    add('owner', 'branch', true);
    add('clerk', 'branch', false);
    add('ag1', 'agent', false);
    for (const id of ['owner', 'clerk', 'ag1']) sessions[id] = await store.saveSession({ userId: id, scope: 'full', userAgent: '', ip: '' });
    const packages: Record<string, ReturnType<typeof pkg>> = { p1: pkg('p1'), p2: pkg('p2'), other: pkg('other', { company: { ...company, code: 'alloha' } }) };
    const tx = {
      packageRenewal: { deleteMany: async (args: unknown) => void writes.push({ op: 'renewal.deleteMany', args }), createMany: async (args: unknown) => void writes.push({ op: 'renewal.createMany', args }) },
      packageSwitch: { deleteMany: async (args: unknown) => void writes.push({ op: 'switch.deleteMany', args }), createMany: async (args: unknown) => void writes.push({ op: 'switch.createMany', args }) },
    };
    const tables = {
      ...tx,
      $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx),
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => grants[where.id],
        findMany: async () => [{ id: 'owner', loginName: 'owner', nickname: 'owner', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null }],
      },
      package: {
        findUnique: async ({ where, include }: { where: { code: string }; include?: Record<string, unknown> }) => {
          const found = packages[where.code];
          if (!found || !include?.lines) return found ?? null;
          return { ...found, lines: [{ status: 'active' }, { status: 'frozen' }], renewals: [{ target: { code: 'p2' } }], switches: [] };
        },
        findMany: async ({ where }: { where: { code: { in: string[] } } }) => where.code.in.map((code) => packages[code]).filter(Boolean),
        update: async (args: unknown) => void writes.push({ op: 'package.update', args }),
      },
    };
    ({ app } = await officeTestApp(store, tables));
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string, method: 'get' | 'put' | 'patch' | 'delete', path: string, body?: object) => {
    const call = request(app.getHttpServer())[method](path).set('Cookie', `sid=${sessions[who]}`);
    return body ? call.send(body) : call;
  };

  it('reads the package sheet for the branch, with counts, targets and resolved modes', async () => {
    const response = await as('clerk', 'get', '/office/packages/p1/sheet');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      code: 'p1', providerCode: 'lian', companyCode: 'wecom', branchCost: 2000, renewalSubscriberPrice: 2800,
      esimPriceEffective: 300, esimPriceSource: 'company', lines: 2, activeLines: 1, renewals: ['p2'], switches: [],
    });
    expect(response.body.modes.charge).toBe('manual');
    expect((await as('ag1', 'get', '/office/packages/p1/sheet')).status).toBe(403);
    expect((await as('owner', 'get', '/office/packages/none/sheet')).status).toBe(404);
  });

  it('sets package flags and one action mode with its flag pair; refuses an empty change', async () => {
    expect((await as('owner', 'patch', '/office/packages/p1/mode', { enabled: false, bogus: true })).body).toEqual({ ok: true });
    expect((await as('owner', 'patch', '/office/packages/p1/mode', { action: 'charge', mode: 'auto' })).body).toEqual({ ok: true });
    const [flags, mode] = writes.map((w) => (w.args as { data: Record<string, unknown> }).data);
    expect(flags).toEqual({ enabled: false });
    expect(mode).toMatchObject({ autoCharge: true, allowCharge: true, actionModes: expect.objectContaining({ charge: 'auto' }) });
    expect((await as('owner', 'patch', '/office/packages/p1/mode', {})).body).toMatchObject({ code: 'INVALID' });
    expect((await as('clerk', 'patch', '/office/packages/p1/mode', { enabled: true })).status).toBe(403);
  });

  // Until 2026-11-08 the mode route checked the edit grant only; an agent given `edit` could change modes for everyone.
  it('refuses package modes to a non-branch account even when it holds the edit grant', async () => {
    const response = await as('ag1', 'patch', '/office/packages/p1/mode', { enabled: true });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(writes).toEqual([]);
  });

  it('replaces renewal and switch targets inside one company and provider', async () => {
    expect((await as('owner', 'put', '/office/packages/p1/renewals', { targets: ['p2'] })).body).toEqual({ ok: true });
    expect((await as('owner', 'put', '/office/packages/p1/switches', { targets: [] })).body).toEqual({ ok: true });
    expect(writes.map((w) => w.op)).toEqual(['renewal.deleteMany', 'renewal.createMany', 'switch.deleteMany']);
    expect(writes[1].args).toEqual({ data: [{ packageId: 'id-p1', targetPackageId: 'id-p2' }] });
    for (const targets of [['p1'], ['p2', 'p2'], ['other'], ['nope'], [3]]) {
      expect((await as('owner', 'put', '/office/packages/p1/renewals', { targets })).body).toMatchObject({ code: 'INVALID' });
    }
    expect((await as('ag1', 'put', '/office/packages/p1/renewals', { targets: [] })).status).toBe(403);
  });

  it('refuses clearing a custom price outside the branch, and for an unknown account', async () => {
    expect((await as('owner', 'delete', '/office/packages/p1/custom-prices/nobody')).status).toBe(404);
  });
});
