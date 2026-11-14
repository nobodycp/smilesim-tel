import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { ActivityModule } from '../auditing/activity.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MemoryAuthStore } from './testing/memory-auth.store';
import { hashPassword, passwordMatches } from './password';
import { DEFAULT_SESSION_MINUTES } from './sessions';

const SESSION_TTL_SECONDS = DEFAULT_SESSION_MINUTES * 60;

const WRONG_CURRENT = 'كلمة السر الحالية غير صحيحة';

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const first = (Array.isArray(header) ? header[0] : header) as string;
  return first.split(';')[0];
}

describe('account endpoints', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;
  let fullCookie: string;
  let ownerCookie: string;

  async function user(overrides: Partial<StoredUser> & { loginName: string }, password: string): Promise<StoredUser> {
    return {
      id: overrides.loginName,
      disabledAt: null,
      mustChangePassword: false,
      layer: 'pos',
      twoFactorExempt: false,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashPassword(password),
      ...overrides,
    };
  }

  const login = (loginName: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ loginName, password });

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'pos', twoFactorExempt: true, nickname: 'الكاشير' }, '123456'));
    store.addUser(await user({ loginName: 'newpos', mustChangePassword: true }, '12345678'));
    store.addUser(await user({ loginName: 'owner', layer: 'branch', twoFactorExempt: true, isBranchOwner: true }, 'ownerpass1'));
    const moduleRef = await Test.createTestingModule({ imports: [ActivityModule, AuthModule] })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    fullCookie = cookieOf(await login('pos', '123456'));
    ownerCookie = cookieOf(await login('owner', 'ownerpass1'));
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the login name and contact details of a full session from GET /auth/profile', async () => {
    store.users.get('pos')!.email = 'pos@example.com';
    const response = await request(app.getHttpServer()).get('/auth/profile').set('Cookie', fullCookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ loginName: 'pos', nickname: 'الكاشير', email: 'pos@example.com' });
  });

  it('refuses GET /auth/profile without a session and for a password-change session', async () => {
    const none = await request(app.getHttpServer()).get('/auth/profile');
    expect(none.status).toBe(401);
    const forced = await login('newpos', '12345678');
    const response = await request(app.getHttpServer()).get('/auth/profile').set('Cookie', cookieOf(forced));
    expect(response.status).toBe(403);
  });

  it('returns 403 when a password-change session calls the profile', async () => {
    const forced = await login('newpos', '12345678');
    const response = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', cookieOf(forced)).send({ nickname: 'محل' });
    expect(response.status).toBe(403);
  });

  it('returns 401 for the profile without a session or with a revoked one', async () => {
    const none = await request(app.getHttpServer()).patch('/auth/profile').send({ nickname: 'محل' });
    expect(none.status).toBe(401);
    await store.revokeSessions(store.sessions.map((s) => s.id));
    const revoked = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ nickname: 'محل' });
    expect(revoked.status).toBe(401);
  });

  it('clears the force flag when the owner changes the password and does not set it again', async () => {
    const forced = await login('newpos', '12345678');
    expect(forced.body.next).toBe('password');
    const changed = await request(app.getHttpServer())
      .post('/auth/password')
      .set('Cookie', cookieOf(forced))
      .send({ password: '12345678', nextPassword: '87654321' });
    expect(changed.status).toBe(200);
    expect(changed.body.next).toBe('app');
    const stored = store.users.get('newpos')!;
    expect(stored.mustChangePassword).toBe(false);
    expect(await passwordMatches(stored.passwordHash, '87654321')).toBe(true);
    const newCookie = cookieOf(changed);
    expect(newCookie).not.toBe(cookieOf(forced));
    const profile = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', newCookie).send({ nickname: 'محل' });
    expect(profile.status).toBe(200);
    const old = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', cookieOf(forced)).send({ nickname: 'محل' });
    expect(old.status).toBe(401);
  });

  it('rejects a wrong current password and a short new password on /auth/password', async () => {
    const forced = await login('newpos', '12345678');
    const wrong = await request(app.getHttpServer())
      .post('/auth/password')
      .set('Cookie', cookieOf(forced))
      .send({ password: 'nope-nope', nextPassword: '87654321' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe(WRONG_CURRENT);
    const short = await request(app.getHttpServer())
      .post('/auth/password')
      .set('Cookie', cookieOf(forced))
      .send({ password: '12345678', nextPassword: '123' });
    expect(short.status).toBe(400);
    expect(short.body.message).toBe('كلمة السر ثمانية أحرف على الأقل');
    expect(store.users.get('newpos')!.mustChangePassword).toBe(true);
  });

  it('rejects an email change without the current password', async () => {
    const response = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ email: 'a@b.c' });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe(WRONG_CURRENT);
    const wrong = await request(app.getHttpServer())
      .patch('/auth/profile')
      .set('Cookie', fullCookie)
      .send({ email: 'a@b.c', currentPassword: 'wrong-pass' });
    expect(wrong.status).toBe(401);
    expect(store.users.get('pos')!.email).toBeUndefined();
  });

  it('changes email and phone with the current password', async () => {
    const response = await request(app.getHttpServer())
      .patch('/auth/profile')
      .set('Cookie', fullCookie)
      .send({ email: 'a@b.c', phone: '0500000000', currentPassword: '123456' });
    expect(response.status).toBe(200);
    expect(store.users.get('pos')!.email).toBe('a@b.c');
    expect(store.users.get('pos')!.phone).toBe('0500000000');
  });

  it('keeps the login name when the full name changes', async () => {
    const response = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ nickname: 'الواجهة' });
    expect(response.status).toBe(200);
    expect(store.users.get('pos')!.loginName).toBe('pos');
    expect(store.users.get('pos')!.nickname).toBe('الواجهة');
  });

  it('rejects an invalid full name', async () => {
    const response = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ nickname: 'أ' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'الاسم الكامل من حرفين إلى أربعين حرفاً', code: 'FULL_NAME_INVALID' });
  });

  it('saves the city and the address without the current password and reads them back', async () => {
    const saved = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ city: 'ramallah', address: ' شارع الإرسال 12 ' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ city: 'ramallah', address: 'شارع الإرسال 12' });
    const profile = await request(app.getHttpServer()).get('/auth/profile').set('Cookie', fullCookie);
    expect(profile.body).toMatchObject({ loginName: 'pos', city: 'ramallah', address: 'شارع الإرسال 12' });
  });

  it('clears the city and the address with an empty string', async () => {
    await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ city: 'gaza', address: 'الرمال' });
    const cleared = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ city: '', address: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.city).toBeUndefined();
    expect(cleared.body.address).toBeUndefined();
    expect(store.users.get('pos')!.city).toBeNull();
  });

  it('refuses an unknown city and an address over 120 characters', async () => {
    const city = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ city: 'atlantis' });
    expect(city.status).toBe(400);
    expect(city.body.code).toBe('CITY_INVALID');
    const address = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ address: 'ش'.repeat(121) });
    expect(address.status).toBe(400);
    expect(address.body.code).toBe('ADDRESS_INVALID');
    expect(store.users.get('pos')!.city ?? null).toBeNull();
  });

  it('changes the password from the profile without setting the force flag', async () => {
    const response = await request(app.getHttpServer())
      .patch('/auth/profile')
      .set('Cookie', fullCookie)
      .send({ nextPassword: '87654321', currentPassword: '123456' });
    expect(response.status).toBe(200);
    const stored = store.users.get('pos')!;
    expect(stored.mustChangePassword).toBe(false);
    expect(await passwordMatches(stored.passwordHash, '87654321')).toBe(true);
  });

  it('forces a change when the branch owner sets another account password', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/users/pos/password')
      .set('Cookie', ownerCookie)
      .send({ password: '87654321' });
    expect(response.status).toBe(200);
    const stored = store.users.get('pos')!;
    expect(stored.mustChangePassword).toBe(true);
    expect(await passwordMatches(stored.passwordHash, '87654321')).toBe(true);
  });

  it('refuses the owner-only password route for anyone else', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/users/newpos/password')
      .set('Cookie', fullCookie)
      .send({ password: '87654321' });
    expect(response.status).toBe(403);
    expect(store.users.get('newpos')!.mustChangePassword).toBe(true);
    const anonymous = await request(app.getHttpServer()).post('/auth/users/pos/password').send({ password: '87654321' });
    expect(anonymous.status).toBe(401);
  });

  it('lets an entered session work as the account but not touch its credentials or sessions (review 2026-11-10, S1, S5)', async () => {
    const entered = `sid=${await store.saveImpersonation({ userId: 'owner', operatorId: 'pos', userAgent: '', ip: '' })}`;
    const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) =>
      request(app.getHttpServer())[method](path).set('Cookie', entered).send(body);
    // Even a session standing on the owner's account gets nothing from the owner-only routes.
    expect((await call('post', '/auth/users/pos/password', { password: '87654321' })).status).toBe(403);
    expect((await call('post', '/auth/users/pos/disable')).status).toBe(403);
    expect((await call('patch', '/auth/profile', { nickname: 'آخر' })).status).toBe(403);
    expect((await call('get', '/auth/sessions')).status).toBe(403);
    expect((await call('delete', '/auth/two-factor')).status).toBe(403);
    expect((await call('post', '/auth/two-factor/setup')).status).toBe(403);
    expect((await call('post', '/auth/password', { password: 'ownerpass1', nextPassword: 'ownerpass2' })).status).toBe(403);
    expect(await passwordMatches(store.users.get('pos')!.passwordHash, '123456')).toBe(true);
  });

  it('signs the account out everywhere when the owner sets its password, and refuses the owner as a target', async () => {
    const before = fullCookie.split('=')[1];
    await request(app.getHttpServer()).post('/auth/users/pos/password').set('Cookie', ownerCookie).send({ password: '87654321' });
    expect(await store.liveSession(before)).toBeNull();
    const self = await request(app.getHttpServer()).post('/auth/users/owner/password').set('Cookie', ownerCookie).send({ password: '87654321' });
    expect(self.status).toBe(403);
    const lockout = await request(app.getHttpServer()).post('/auth/users/owner/disable').set('Cookie', ownerCookie);
    expect(lockout.status).toBe(403);
  });

  it('signs out at any step and clears the cookie (review 2026-11-10, A11)', async () => {
    const pending = cookieOf(await login('newpos', '12345678'));
    const out = await request(app.getHttpServer()).post('/auth/logout').set('Cookie', pending);
    expect(out.status).toBe(200);
    expect(String(out.headers['set-cookie'])).toMatch(/^sid=;/);
    expect(await store.liveSession(pending.split('=')[1])).toBeNull();
    expect((await request(app.getHttpServer()).post('/auth/logout')).status).toBe(401);
  });

  it('lists only full account sessions and marks the current one', async () => {
    await login('newpos', '12345678');
    const second = cookieOf(await login('pos', '123456'));
    const listed = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', second);
    expect(listed.status).toBe(200);
    expect(listed.body.sessions).toHaveLength(2);
    expect(listed.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    // The list names sessions by their id; the cookie's token appears nowhere in it (review 2026-11-10, S6).
    expect(JSON.stringify(listed.body)).not.toContain(second.split('=')[1]);
  });

  it('omits an expired full session from the list', async () => {
    const second = cookieOf(await login('pos', '123456'));
    const secondId = (await store.liveSession(second.split('=')[1]))!.session.id;
    store.sessions.find((s) => s.id === secondId)!.expiresAt = new Date(Date.now() - 1000);
    const listed = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', fullCookie);
    expect(listed.status).toBe(200);
    expect(listed.body.sessions.map((s: { id: string }) => s.id)).not.toContain(secondId);
    expect(listed.body.sessions).toHaveLength(1);
  });

  it('revokes another session without clearing the cookie', async () => {
    await login('pos', '123456');
    const listed = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', fullCookie);
    const other = listed.body.sessions.find((s: { current: boolean }) => !s.current);
    const revoked = await request(app.getHttpServer()).delete(`/auth/sessions/${other.id}`).set('Cookie', fullCookie);
    expect(revoked.status).toBe(200);
    expect(revoked.headers['set-cookie']).toBeUndefined();
    expect(store.sessions.find((s) => s.id === other.id)!.revokedAt).not.toBeNull();
    const after = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', fullCookie);
    expect(after.body.sessions).toHaveLength(1);
  });

  it('does not let a user revoke a session of another account', async () => {
    const ownerSession = store.sessions.find((s) => s.userId === 'owner')!;
    const response = await request(app.getHttpServer()).delete(`/auth/sessions/${ownerSession.id}`).set('Cookie', fullCookie);
    expect(response.status).toBe(404);
    expect(ownerSession.revokedAt).toBeNull();
  });

  it('clears the cookie when the current session is revoked', async () => {
    const listed = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', fullCookie);
    const current = listed.body.sessions.find((session: { current: boolean }) => session.current);
    const revoked = await request(app.getHttpServer()).delete(`/auth/sessions/${current.id}`).set('Cookie', fullCookie);
    expect(revoked.headers['set-cookie'][0]).toContain('sid=;');
    const after = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', fullCookie);
    expect(after.status).toBe(401);
  });

  it('refreshes lastSeenAt and the expiry on an authenticated request', async () => {
    const session = store.sessions.find((s) => s.userId === 'pos')!;
    session.lastSeenAt = new Date(Date.now() - 60_000);
    session.expiresAt = new Date(Date.now() + 1000);
    await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', fullCookie);
    expect(session.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + (SESSION_TTL_SECONDS - 5) * 1000);
  });
});
