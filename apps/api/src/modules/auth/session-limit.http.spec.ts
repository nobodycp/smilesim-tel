import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { AUTH_STORE, MemoryAuthStore, StoredUser } from './auth.store';
import { hashPassword } from './password';

const DISABLED = 'الحساب موقوف';

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const first = (Array.isArray(header) ? header[0] : header) as string;
  return first.split(';')[0];
}

describe('session limit and account disabling', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;
  let ownerCookie: string;

  async function user(overrides: Partial<StoredUser> & { loginName: string }, password: string): Promise<StoredUser> {
    return {
      id: overrides.loginName,
      disabledAt: null,
      mustChangePassword: false,
      layer: 'pos',
      twoFactorExempt: true,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashPassword(password),
      ...overrides,
    };
  }

  const login = (loginName: string, password: string, agent?: string) => {
    const call = request(app.getHttpServer()).post('/auth/login').send({ loginName, password });
    return agent ? call.set('User-Agent', agent) : call;
  };

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'pos' }, '123456'));
    store.addUser(await user({ loginName: 'other' }, '123456'));
    store.addUser(await user({ loginName: 'owner', layer: 'branch', isBranchOwner: true }, 'ownerpass1'));
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ownerCookie = cookieOf(await login('owner', 'ownerpass1'));
  });

  afterEach(async () => {
    await app.close();
  });

  it('revokes the oldest live session on the fourth full login', async () => {
    for (const agent of ['one', 'two', 'three']) {
      await login('pos', '123456', agent);
    }
    const fourth = await login('pos', '123456', 'four');
    expect(fourth.status).toBe(200);
    const live = store.sessions.filter((session) => session.userId === 'pos' && session.scope === 'full' && !session.revokedAt);
    expect(live).toHaveLength(3);
    expect(live.some((session) => session.userAgent === 'one')).toBe(false);
  });

  it('returns 401 for the evicted session cookie', async () => {
    const first = await login('pos', '123456', 'one');
    for (const agent of ['two', 'three', 'four']) {
      await login('pos', '123456', agent);
    }
    const response = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', cookieOf(first));
    expect(response.status).toBe(401);
  });

  it('rejects a disabled account and drops its live keys', async () => {
    await login('pos', '123456');
    expect(store.liveKeys.has('pos')).toBe(true);
    const disabled = await request(app.getHttpServer()).post('/auth/users/pos/disable').set('Cookie', ownerCookie);
    expect(disabled.status).toBe(200);
    expect(store.liveKeys.has('pos')).toBe(false);
    expect(store.users.get('pos')!.disabledAt).toBeInstanceOf(Date);
    const response = await login('pos', '123456');
    expect(response.status).toBe(403);
    expect(response.body.message).toBe(DISABLED);
  });

  it('drops every live session of the disabled account and leaves other accounts alone', async () => {
    await login('pos', '123456', 'one');
    await login('pos', '123456', 'two');
    const bystander = cookieOf(await login('other', '123456'));
    await request(app.getHttpServer()).post('/auth/users/pos/disable').set('Cookie', ownerCookie);
    expect(store.sessions.filter((s) => s.userId === 'pos' && !s.revokedAt)).toHaveLength(0);
    expect(store.liveKeys.has('other')).toBe(true);
    const other = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', bystander);
    expect(other.status).toBe(200);
  });

  it('returns 401 for a revoked session on the next profile read', async () => {
    const revokedCookie = cookieOf(await login('pos', '123456'));
    await request(app.getHttpServer()).post('/auth/users/pos/disable').set('Cookie', ownerCookie);
    const response = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', revokedCookie);
    expect(response.status).toBe(401);
  });

  it('refuses disable for anyone but the branch owner', async () => {
    const posCookie = cookieOf(await login('pos', '123456'));
    const forbidden = await request(app.getHttpServer()).post('/auth/users/other/disable').set('Cookie', posCookie);
    expect(forbidden.status).toBe(403);
    expect(store.users.get('other')!.disabledAt).toBeNull();
    const anonymous = await request(app.getHttpServer()).post('/auth/users/other/disable');
    expect(anonymous.status).toBe(401);
    expect(store.users.get('other')!.disabledAt).toBeNull();
  });

  it('returns 404 when the account to disable does not exist', async () => {
    const response = await request(app.getHttpServer()).post('/auth/users/ghost/disable').set('Cookie', ownerCookie);
    expect(response.status).toBe(404);
  });
});
