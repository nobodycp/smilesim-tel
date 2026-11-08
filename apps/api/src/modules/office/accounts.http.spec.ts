import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../auth/auth.store';
import { officeTestApp } from './kernel/office-test-app';

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
    $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx),
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
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => { written.push({ op: 'task.update', args }); Object.assign(tasks.find((task) => task.id === args.where.id)!, args.data); },
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
    expect(response.body.users.map((row: { loginName: string }) => row.loginName)).toEqual(['ag1', 'pos1']);
    expect(response.body.users[1]).toEqual({
      loginName: 'pos1', nickname: 'نقطة', layer: 'pos', roleName: '', parentLogin: 'ag1', balance: 700, ceiling: 100, frozen: false,
      self: false, directChild: true, canEnter: false, canFreeze: false, canDelete: false,
    });
    const owner = await as('owner', 'get', '/office/users');
    const pos = owner.body.users.find((row: { loginName: string }) => row.loginName === 'pos1');
    expect(pos).toMatchObject({ canEnter: true, canFreeze: true, canDelete: true });
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
    expect(await code(as('ag1', 'post', '/office/users', body({ loginName: 'pos1' })))).toBe('400 LOGIN_TAKEN');
    // The branch places a point of sale under one of the agents it sees, never under nobody.
    expect(await code(as('owner', 'post', '/office/users', body({ loginName: 'x127', parentLogin: 'ag2' })))).toBe('201');
    expect(await code(as('owner', 'post', '/office/users', body({ loginName: 'x128', parentLogin: 'ma1' })))).toBe('400 INVALID');
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
    expect(await code(as('ma1', 'post', '/office/users/ag1/password', { password: 'longenough' }))).toBe('201');
    expect(w.written.at(-1)).toMatchObject({ op: 'user.update', args: { where: { id: 'ag1' }, data: { mustChangePassword: true } } });
    expect(await code(as('ag1', 'post', '/office/users/ma1/password', { password: 'longenough' }))).toBe('403 FORBIDDEN');
    expect(await code(as('ag1', 'post', '/office/users/ag2/password', { password: 'longenough' }))).toBe('403 FORBIDDEN');
    expect(await code(as('ma1', 'post', '/office/users/ma1/password', { password: 'longenough' }))).toBe('403 FORBIDDEN');
    expect(await code(as('ma1', 'post', '/office/users/owner/password', { password: 'longenough' }))).toBe('403 FORBIDDEN');
    expect(await code(as('ma1', 'post', '/office/users/ag1/password', { password: 'short' }))).toBe('400 PASSWORD_TOO_SHORT');
    expect(await code(as('pos1', 'post', '/office/users/pos1/password', { password: 'longenough' }))).toBe('403 FORBIDDEN');
  });

  it('freezes an account for the branch, returns its working tasks and drops its live sessions', async () => {
    expect(await code(as('ag1', 'post', '/office/users/pos1/freeze'))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/users/owner/freeze'))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/users/clerk/freeze'))).toBe('201');
    expect(w.users.find((user) => user.id === 'clerk')!.disabledAt).toBeInstanceOf(Date);
    expect(w.tasks[0]).toMatchObject({ status: 'pending', assigneeId: null, resultNote: 'رجع لأن الحساب أُوقف' });
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

  it('enters an account for the branch with the enter grant, logs it, and sets the session cookies; leave needs an entered session', async () => {
    expect(await code(as('ag1', 'post', '/office/users/pos1/enter'))).toBe('403 FORBIDDEN');
    expect(await code(as('clerk', 'post', '/office/users/pos1/enter'))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/users/owner/enter'))).toBe('400 INVALID');
    const entered = await as('owner', 'post', '/office/users/pos1/enter');
    expect(entered.status).toBe(201);
    expect(entered.body.sessionId).toEqual(expect.any(String));
    const cookies = String(entered.headers['set-cookie']);
    expect(cookies).toContain('home=');
    expect(cookies).toContain(`sid=${entered.body.sessionId}`);
    expect(w.written.find((entry) => entry.op === 'accessLog.create')!.args).toMatchObject({ data: { actorId: 'owner', targetLogin: 'pos1' } });
    expect(await code(as('owner', 'post', '/office/leave'))).toBe('400 INVALID');
    const left = await request(app.getHttpServer()).post('/office/leave').set('Cookie', `sid=${entered.body.sessionId}; home=${sessions.owner}`);
    expect(left.status).toBe(201);
    expect(String(left.headers['set-cookie'])).toContain(`sid=${sessions.owner}`);
  });

  it('shows and edits roles for the owner only', async () => {
    expect(await code(as('clerk', 'get', '/office/roles'))).toBe('403 FORBIDDEN');
    const listed = await as('owner', 'get', '/office/roles');
    expect(listed.status).toBe(200);
    // The four layer roles are made on first read, then the job roles follow.
    expect(listed.body.roles.map((role: { kind: string; layer: string }) => `${role.kind}:${role.layer}`)).toEqual(['layer:branch', 'layer:main_agent', 'layer:agent', 'layer:pos', 'job:']);
    expect(await code(as('clerk', 'post', '/office/roles', { name: 'دور' }))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'post', '/office/roles', { name: 'x' }))).toBe('400 INVALID');
    expect(await code(as('owner', 'post', '/office/roles', { name: 'محاسب', grants: ['accounting', 'bogus'] }))).toBe('201');
    expect(w.written.filter((entry) => entry.op === 'role.create').at(-1)!.args).toMatchObject({ data: { name: 'محاسب', kind: 'job', grants: 'accounting', accounting: true } });
    expect(await code(as('owner', 'post', '/office/roles', { id: 'missing', name: 'دور' }))).toBe('404 NOT_FOUND');
  });

  it('shows an account\'s access and lets the owner change it', async () => {
    const shown = await as('ma1', 'get', '/office/users/ag1');
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ loginName: 'ag1', layer: 'agent', parentLogin: 'ma1', staff: false, canEdit: false });
    expect(await code(as('ag1', 'get', '/office/users/ma1'))).toBe('403 FORBIDDEN');
    expect(await code(as('ma1', 'patch', '/office/users/ag1/access', { extraGrants: ['edit'] }))).toBe('403 FORBIDDEN');
    expect(await code(as('owner', 'patch', '/office/users/ag1/access', { extraGrants: ['reports'], deniedGrants: ['reports', 'tasks'], extraRoleIds: ['r-desk'] }))).toBe('200');
    expect(w.written.find((entry) => entry.op === 'user.update')!.args).toEqual({ where: { id: 'ag1' }, data: { extraGrants: 'reports', deniedGrants: 'tasks', roleId: null } });
    expect(w.written.find((entry) => entry.op === 'userRole.createMany')!.args).toEqual({ data: [{ userId: 'ag1', roleId: 'r-desk' }] });
    expect(await code(as('owner', 'patch', '/office/users/ag1/access', { extraRoleIds: ['nope'] }))).toBe('400 INVALID');
    expect(await code(as('owner', 'patch', '/office/users/owner/access', {}))).toBe('403 FORBIDDEN');
  });
});
