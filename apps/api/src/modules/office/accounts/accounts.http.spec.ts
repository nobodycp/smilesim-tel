import { LayerRoles } from '../roles/layer-roles';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { officeTestApp } from '../testing/office-test-app';

// Accounts and roles over HTTP: who may list, create, reset, freeze, delete, enter and leave accounts, and edit
// roles and access. Written before these routes left office.controller.ts, so the move is checked against the
// refusals and writes they had.

type Role = { id: string; name: string; kind: string; layer: string | null; grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean };
type User = {
  id: string; loginName: string; nickname: string; layer: string; parentId: string | null; isBranchOwner: boolean; disabledAt: Date | null;
  roleId: string | null; liveGrants: string; extraGrants: string; deniedGrants: string; deniedOps: string; mustChangePassword?: boolean; passwordHash?: string;
};

const flags = { read: false, edit: false, accounting: false, tasks: false, reports: false, staff: false, enter: false };

function world() {
  const roles: Role[] = [{ id: 'r-desk', name: 'مكتب', kind: 'job', layer: null, grants: 'read,tasks', ...flags, read: true, tasks: true }];
  const base = { disabledAt: null, roleId: null, liveGrants: '', extraGrants: '', deniedGrants: '', deniedOps: '', isBranchOwner: false };
  const users: User[] = [
    { ...base, id: 'owner', loginName: 'owner', nickname: 'المالك', layer: 'branch', parentId: null, isBranchOwner: true },
    { ...base, id: 'clerk', loginName: 'clerk', nickname: 'موظف', layer: 'branch', parentId: 'owner', roleId: 'r-desk' },
    { ...base, id: 'ma1', loginName: 'ma1', nickname: 'رئيسي', layer: 'main_agent', parentId: 'owner' },
    { ...base, id: 'ag1', loginName: 'ag1', nickname: 'وكيل', layer: 'agent', parentId: 'ma1' },
    { ...base, id: 'ag2', loginName: 'ag2', nickname: 'وكيل٢', layer: 'agent', parentId: 'ma1' },
    { ...base, id: 'pos1', loginName: 'pos1', nickname: 'نقطة', layer: 'pos', parentId: 'ag1' },
  ];
  const tasks = [{ id: 't1', assigneeId: 'clerk', status: 'working', log: '' }];
  const userRoles: { userId: string; roleId: string; role: Role }[] = [];
  const written: { op: string; args: unknown }[] = [];
  const counts: Record<string, number> = { children: 0, lines: 0, tasks: 0, entries: 0 };
  const withRole = (user: User) => ({ ...user, role: roles.find((role) => role.id === user.roleId) ?? null, extraRoles: userRoles.filter((link) => link.userId === user.id) });
  const find = (where: { id?: string; loginName?: string }) => users.find((user) => (where.id ? user.id === where.id : user.loginName === where.loginName));
  const tx = {
    user: { update: async (args: { where: { id: string }; data: Partial<User> }) => { written.push({ op: 'user.update', args }); Object.assign(find(args.where)!, args.data); } },
    userRole: {
      deleteMany: async (args: unknown) => void written.push({ op: 'userRole.deleteMany', args }),
      createMany: async (args: unknown) => void written.push({ op: 'userRole.createMany', args }),
    },
  };
  const tables = {
    // Inside a transaction the same tables answer, with the writes this spec records; the wallet lock reads no row.
    $transaction: async (run: (client: unknown) => Promise<unknown>): Promise<unknown> =>
      run({ ...tables, ...tx, user: { ...tables.user, ...tx.user }, $queryRaw: async () => [] }),
    user: {
      findMany: async () => users.map(withRole),
      findUnique: async ({ where }: { where: { id?: string; loginName?: string } }) => {
        const user = find(where);
        return user ? withRole(user) : null;
      },
      findFirst: async () => users.find((user) => user.isBranchOwner) ?? null,
      create: async (args: { data: User }) => { written.push({ op: 'user.create', args }); users.push({ ...base, ...args.data, id: `new-${args.data.loginName}` }); },
      update: tx.user.update,
      count: async () => counts.children,
      delete: async (args: unknown) => void written.push({ op: 'user.delete', args }),
    },
    wallet: { findMany: async () => [{ userId: 'pos1', balance: 700, ceiling: 100 }], deleteMany: async () => ({}) },
    role: {
      findUnique: async ({ where }: { where: { id?: string; layer?: string } }) => roles.find((role) => (where.id ? role.id === where.id : role.layer === where.layer)) ?? null,
      findMany: async ({ where }: { where?: { id?: { in: string[] }; kind?: string } } = {}) =>
        roles.filter((role) => (!where?.kind || role.kind === where.kind) && (!where?.id || where.id.in.includes(role.id))),
      create: async (args: { data: Omit<Role, 'id'> }) => { written.push({ op: 'role.create', args }); roles.push({ ...flags, ...args.data, layer: args.data.layer ?? null, id: `r-${roles.length}` } as Role); },
      update: async (args: unknown) => void written.push({ op: 'role.update', args }),
    },
    userRole: { findMany: async () => [] },
    officeTask: {
      findMany: async () => tasks.filter((task) => task.status === 'working'),
      // The guarded write of a freeze: only a task this account still handles.
      updateMany: async (args: { where: { id: string; assigneeId: string; status: string }; data: Record<string, unknown> }) => {
        const task = tasks.find((row) => row.id === args.where.id && row.assigneeId === args.where.assigneeId && row.status === args.where.status);
        if (task) Object.assign(task, args.data);
        return { count: task ? 1 : 0 };
      },
      count: async () => counts.tasks,
    },
    line: { count: async () => counts.lines },
    walletEntry: { count: async () => counts.entries },
    session: { deleteMany: async () => ({}) },
    userPackage: { deleteMany: async () => ({}) },
    sellPrice: { deleteMany: async () => ({}) },
    accessLog: { create: async (args: unknown) => void written.push({ op: 'accessLog.create', args }) },
  };
  return { users, roles, tasks, written, counts, tables };
}

describe('accounts and roles over HTTP', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;
  let w: ReturnType<typeof world>;
  const sessions: Record<string, string> = {};

  beforeEach(async () => {
    w = world();
    store = new MemoryAuthStore();
    for (const user of w.users) {
      store.addUser({
        id: user.id, loginName: user.loginName, nickname: user.nickname, disabledAt: null, mustChangePassword: false,
        layer: user.layer as 'branch', twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: user.isBranchOwner, passwordHash: 'x',
      });
      sessions[user.id] = await store.saveSession({ userId: user.id, scope: 'full', userAgent: '', ip: '' });
    }
    ({ app } = await officeTestApp(store, w.tables));
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: object) => {
    const call = request(app.getHttpServer())[method](path).set('Cookie', `sid=${sessions[who]}`);
    return body ? call.send(body) : call;
  };
  const code = async (call: Promise<request.Response> | request.Test) => {
    const response = await call;
    return `${response.status} ${response.body.code ?? ''}`.trim();
  };

  it('lists what the agent sees, with what it may do to each row', async () => {
    const response = await as('ag1', 'get', '/office/users');
    expect(response.status).toBe(200);
    expect(response.body.items.map((row: { loginName: string }) => row.loginName)).toEqual(['ag1', 'pos1']);
    expect(response.body.items[1]).toEqual({
      loginName: 'pos1', nickname: 'نقطة', layer: 'pos', roleName: '', parentLoginName: 'ag1', balance: 700, ceiling: 100, held: 0, frozen: false,
      self: false, directChild: true, canEnter: false, canFreeze: false, canDelete: false,
    });
    const owner = await as('owner', 'get', '/office/users');
    const pos = owner.body.items.find((row: { loginName: string }) => row.loginName === 'pos1');
    expect(pos).toMatchObject({ canEnter: true, canFreeze: true, canDelete: true });
  });

  it('always answers one page, filtered and counted by the server, and refuses a cursor it did not issue', async () => {
    const page = await as('owner', 'get', '/office/users?layer=agent');
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ nextCursor: null, total: 2 });
    expect(page.body.items.map((row: { loginName: string }) => row.loginName)).toEqual(['ag1', 'ag2']);
    expect(page.body.items[0]).toMatchObject({ loginName: 'ag1', parentLoginName: 'ma1', canEnter: true });
    const named = await as('owner', 'get', '/office/users?q=%D9%86%D9%82%D8%B7%D8%A9');
    expect(named.body.items.map((row: { loginName: string }) => row.loginName)).toEqual(['pos1']);
    expect(named.body.items[0]).toMatchObject({ balance: 700, ceiling: 100 });
    const full = await as('owner', 'get', '/office/users');
    expect(Object.keys(full.body).sort()).toEqual(['items', 'nextCursor', 'total']);
    expect(full.body.items).toHaveLength(6);
    expect(await code(as('owner', 'get', '/office/users?cursor=junk'))).toBe('400 INVALID');
    expect((await as('ag1', 'get', '/office/directory')).body.total).toBeGreaterThan(2);
    expect((await as('ag1', 'get', '/office/directory?mine=1')).body.items.map((row: { loginName: string }) => row.loginName)).toEqual(['ag1', 'pos1']);
    const names = await as('ag1', 'get', '/office/directory?layer=pos');
    expect(names.body).toEqual({
      items: [{ loginName: 'pos1', nickname: 'نقطة', layer: 'pos', parentLoginName: 'ag1', frozen: false, mine: true }],
      nextCursor: null,
      total: 1,
    });
  });

  it('creates accounts only down the ladder, under a visible parent, with a fresh name', async () => {
    const body = (patch: object) => ({ loginName: 'NewPos', nickname: 'جديد', password: 'longenough', layer: 'pos', ...patch });
    expect(await code(as('ag1', 'post', '/office/users', body({})))).toBe('201');
    const created = w.written.find((entry) => entry.op === 'user.create')!.args as { data: User };
    expect(created.data).toMatchObject({ loginName: 'newpos', nickname: 'جديد', layer: 'pos', parentId: 'ag1', mustChangePassword: true });
    expect(await code(as('pos1', 'post', '/office/users', body({ loginName: 'x123' })))).toBe('403 FORBIDDEN');
    expect(await code(as('ag1', 'post', '/office/users', body({ layer: 'agent', loginName: 'x124' })))).toBe('403 FORBIDDEN');
    expect(await code(as('ag1', 'post', '/office/users', body({ loginName: 'a b' })))).toBe('400 INVALID');
    expect(await code(as('ag1', 'post', '/office/users', body({ loginName: 'x125', nickname: 'x' })))).toBe('400 FULL_NAME_INVALID');
    expect(await code(as('ag1', 'post', '/office/users', body({ loginName: 'x126', password: 'short' })))).toBe('400 PASSWORD_TOO_SHORT');
    expect(await code(as('ag1', 'post', '/office/users', body({ loginName: 'pos1' })))).toBe('409 LOGIN_TAKEN');
    // The branch places a point of sale under one of the agents it sees, never under nobody.
    expect(await code(as('owner', 'post', '/office/users', body({ loginName: 'x127', parentLoginName: 'ag2' })))).toBe('201');
    expect(await code(as('owner', 'post', '/office/users', body({ loginName: 'x128', parentLoginName: 'ma1' })))).toBe('400 INVALID');
    expect(await code(as('owner', 'post', '/office/users', body({ loginName: 'x129' })))).toBe('400 INVALID');
  });

  it('creates staff only for the owner or a staff grant, with an existing role, under the owner', async () => {
    const staff = (patch: object) => ({ loginName: 'helper', nickname: 'مساعد', password: 'longenough', layer: 'staff', roleId: 'r-desk', ...patch });
    expect(await code(as('clerk', 'post', '/office/users', staff({})))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/users', staff({ roleId: 'nope' })))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/users', staff({})))).toBe('201');
    const created = w.written.find((entry) => entry.op === 'user.create')!.args as { data: User };
    expect(created.data).toMatchObject({ layer: 'branch', parentId: 'owner', roleId: 'r-desk', mustChangePassword: true });
  });

  it('resets a password only below the actor, never its own or the owner\'s', async () => {
    // Above the actor or beside it is outside its tree: the same answer as a login that is not there.
    expect(await code(as('ag1', 'post', '/office/users/ma1/password', { password: 'longenough' }))).toBe('404 NOT_FOUND');
    expect(await code(as('ag1', 'post', '/office/users/ag2/password', { password: 'longenough' }))).toBe('404 NOT_FOUND');
    expect(await code(as('ma1', 'post', '/office/users/ag1/password', { password: 'longenough' }))).toBe('201');
    expect(w.written.at(-1)).toMatchObject({ op: 'user.update', args: { where: { id: 'ag1' }, data: { mustChangePassword: true } } });
    // Whoever held the old password is signed out (review 2026-11-10, S3).
    expect(await store.liveSession(sessions.ag1)).toBeNull();
    expect(await code(as('ma1', 'post', '/office/users/ma1/password', { password: 'longenough' }))).toBe('403 FORBIDDEN');
    // The owner is above a main agent, so outside its tree; the owner's own staff are refused by name.
    expect(await code(as('ma1', 'post', '/office/users/owner/password', { password: 'longenough' }))).toBe('404 NOT_FOUND');
    expect(await code(as('ma1', 'post', '/office/users/ag1/password', { password: 'short' }))).toBe('400 PASSWORD_TOO_SHORT');
    expect(await code(as('pos1', 'post', '/office/users/pos1/password', { password: 'longenough' }))).toBe('403 FORBIDDEN');
  });

  it('freezes an account for the branch, returns its working tasks and drops its live sessions', async () => {
    expect(await code(as('ag1', 'post', '/office/users/pos1/freeze'))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/users/owner/freeze'))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/users/clerk/freeze'))).toBe('201');
    expect(w.users.find((user) => user.id === 'clerk')!.disabledAt).toBeInstanceOf(Date);
    // Back in the pool, still open: nothing handles a status of its own for this (review 2026-11-10, M5).
    expect(w.tasks[0]).toMatchObject({ status: 'working', assigneeId: null });
    expect(w.tasks[0].log).toContain('رجعت لأن الحساب أُوقف');
    expect((await store.liveSession(sessions.clerk))).toBeNull();
    expect(await code(as('owner', 'post', '/office/users/clerk/restore'))).toBe('201');
    expect(w.users.find((user) => user.id === 'clerk')!.disabledAt).toBeNull();
  });

  it('deletes an account without history for the branch, and refuses one with history', async () => {
    expect(await code(as('ag1', 'delete', '/office/users/pos1'))).toBe('403 FORBIDDEN');
    w.counts.lines = 1;
    expect(await code(as('owner', 'delete', '/office/users/pos1'))).toBe('400 HAS_HISTORY');
    w.counts.lines = 0;
    expect(await code(as('owner', 'delete', '/office/users/pos1'))).toBe('200');
    expect(w.written.at(-1)).toEqual({ op: 'user.delete', args: { where: { id: 'pos1' } } });
  });

  it('keeps the account signed in and whole when its delete is refused or fails', async () => {
    w.counts.entries = 1;
    expect(await code(as('owner', 'delete', '/office/users/pos1'))).toBe('400 HAS_HISTORY');
    // Refused inside the transaction: nothing was removed and the account's session still answers.
    expect(w.written.some((entry) => entry.op === 'user.delete')).toBe(false);
    expect(await store.liveSession(sessions.pos1)).not.toBeNull();
  });

  it('enters an account for the branch with the enter grant, logs it, and hands its door a one-time code; leave needs an entered session', async () => {
    expect(await code(as('ag1', 'post', '/office/users/pos1/enter'))).toBe('403 FORBIDDEN');
    expect(await code(as('clerk', 'post', '/office/users/pos1/enter'))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/users/owner/enter'))).toBe('400 INVALID');
    const entered = await as('owner', 'post', '/office/users/pos1/enter');
    expect(entered.status).toBe(201);
    expect(entered.body).toEqual({ door: 'pos', code: expect.any(String) });
    // The admin host keeps the owner's own cookies.
    expect(entered.headers['set-cookie']).toBeUndefined();
    expect(w.written.find((entry) => entry.op === 'accessLog.create')!.args).toMatchObject({ data: { actorId: 'owner', targetLoginName: 'pos1' } });

    // The point-of-sale door trades the code once for the entered session and the owner's session.
    expect(await code(request(app.getHttpServer()).post('/office/handoff').send({ code: 'nope' }))).toBe('400 INVALID');
    const handed = await request(app.getHttpServer()).post('/office/handoff').send({ code: entered.body.code });
    expect(handed.status).toBe(201);
    const cookies = String(handed.headers['set-cookie']);
    const sid = /sid=([^;]+)/.exec(cookies)![1];
    expect(cookies).toContain(`home=${sessions.owner}`);
    expect((await store.liveSession(sid))?.session.kind).toBe('impersonation');
    expect((await store.liveSession(sid))?.user.loginName).toBe('pos1');
    expect(await code(request(app.getHttpServer()).post('/office/handoff').send({ code: entered.body.code }))).toBe('400 INVALID');

    expect(await code(as('owner', 'post', '/office/leave'))).toBe('400 INVALID');
    const left = await request(app.getHttpServer()).post('/office/leave').set('Cookie', `sid=${sid}; home=${sessions.owner}`);
    expect(left.status).toBe(201);
    expect(String(left.headers['set-cookie'])).toContain(`sid=${sessions.owner}`);
    expect(await store.liveSession(sid)).toBeNull();
  });

  it('never enters a branch account, and keeps who entered on the session itself (review 2026-11-10, S1, S7)', async () => {
    // The owner's own account and another employee: entering either would hand over the office.
    expect(await code(as('owner', 'post', '/office/users/clerk/enter'))).toBe('403 FORBIDDEN');
    const entered = await as('owner', 'post', '/office/users/pos1/enter');
    const handed = await request(app.getHttpServer()).post('/office/handoff').send({ code: entered.body.code });
    const sid = /sid=([^;]+)/.exec(String(handed.headers['set-cookie']))![1];
    // No `home` cookie is needed, or trusted, to know who is acting.
    expect((await store.liveSession(sid))?.session).toMatchObject({ kind: 'impersonation', operatorId: 'owner' });
  });

  it('refuses an expired or unknown handoff code', async () => {
    const entered = await as('owner', 'post', '/office/users/pos1/enter');
    await store.dropSecret(`handoff:${entered.body.code}`);
    expect(await code(request(app.getHttpServer()).post('/office/handoff').send({ code: entered.body.code }))).toBe('400 INVALID');
    expect(await code(request(app.getHttpServer()).post('/office/handoff').send({}))).toBe('400 INVALID');
  });

  it('shows and edits roles for the owner only', async () => {
    expect(await code(as('clerk', 'get', '/office/roles'))).toBe('403 FORBIDDEN');
    // The API makes the four layer roles when it starts (catalog seed), never on a read.
    expect((await as('owner', 'get', '/office/roles')).body.roles.map((role: { kind: string }) => role.kind)).toEqual(['job']);
    await app.get(LayerRoles).ensureLayerRoles();
    const listed = await as('owner', 'get', '/office/roles');
    expect(listed.status).toBe(200);
    // The layer roles first, in layer order, then the job roles.
    expect(listed.body.roles.map((role: { kind: string; layer: string }) => `${role.kind}:${role.layer}`)).toEqual(['layer:branch', 'layer:main_agent', 'layer:agent', 'layer:pos', 'job:']);
    expect(await code(as('clerk', 'post', '/office/roles', { name: 'دور' }))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/roles', { name: 'x' }))).toBe('400 INVALID');
    // A grant code the office does not know is refused, not dropped (backend-engineering.mdc 4.2).
    expect(await code(as('owner', 'post', '/office/roles', { name: 'محاسب', grants: ['accounting', 'bogus'] }))).toBe('400 INVALID');
    expect(await code(as('owner', 'post', '/office/roles', { name: 'محاسب', grants: ['accounting'] }))).toBe('201');
    expect(w.written.filter((entry) => entry.op === 'role.create').at(-1)!.args).toMatchObject({ data: { name: 'محاسب', kind: 'job', grants: 'accounting', accounting: true } });
    expect(await code(as('owner', 'put', '/office/roles/missing', { name: 'دور' }))).toBe('404 NOT_FOUND');
    expect(await code(as('clerk', 'put', '/office/roles/missing', { name: 'دور' }))).toBe('403 FORBIDDEN');
  });

  it('shows an account\'s access and lets the owner change it', async () => {
    const shown = await as('ma1', 'get', '/office/users/ag1');
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ loginName: 'ag1', layer: 'agent', parentLoginName: 'ma1', staff: false, canEdit: false });
    // The page's head and cards read the account as the list shows it to this viewer.
    expect(shown.body.listed).toMatchObject({ loginName: 'ag1', balance: 0, ceiling: 0, directChild: true, frozen: false });
    const pos = await as('ag1', 'get', '/office/users/pos1');
    expect(pos.body.listed).toMatchObject({ loginName: 'pos1', balance: 700, ceiling: 100, directChild: true });
    expect(await code(as('ag1', 'get', '/office/users/ma1'))).toBe('404 NOT_FOUND');
    expect(await code(as('ma1', 'patch', '/office/users/ag1/access', { extraGrants: ['edit'] }))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'patch', '/office/users/ag1/access', { extraGrants: ['reports'], deniedGrants: ['reports', 'tasks'], extraRoleIds: ['r-desk'] }))).toBe('200');
    expect(w.written.find((entry) => entry.op === 'user.update')!.args).toEqual({ where: { id: 'ag1' }, data: { extraGrants: 'reports', deniedGrants: 'tasks', roleId: null } });
    expect(w.written.find((entry) => entry.op === 'userRole.createMany')!.args).toEqual({ data: [{ userId: 'ag1', roleId: 'r-desk' }] });
    expect(await code(as('owner', 'patch', '/office/users/ag1/access', { extraRoleIds: ['nope'] }))).toBe('400 INVALID');
    expect(await code(as('owner', 'patch', '/office/users/owner/access', {}))).toBe('403 FORBIDDEN');
  });
});
