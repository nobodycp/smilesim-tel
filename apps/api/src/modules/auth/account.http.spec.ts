import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { AUTH_STORE, MemoryAuthStore, StoredUser } from './auth.store';
import { hashPassword, passwordMatches } from './password';
import { SESSION_TTL_SECONDS } from './sessions';

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
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
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

  it('keeps the login name when the nickname changes', async () => {
    const response = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ nickname: 'الواجهة' });
    expect(response.status).toBe(200);
    expect(store.users.get('pos')!.loginName).toBe('pos');
    expect(store.users.get('pos')!.nickname).toBe('الواجهة');
  });

  it('rejects an invalid nickname', async () => {
    const response = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', fullCookie).send({ nickname: 'أ' });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('النيك نيم من حرفين إلى أربعين حرفاً');
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

  it('lists only full account sessions and marks the current one', async () => {
    await login('newpos', '12345678');
    const second = cookieOf(await login('pos', '123456'));
    const listed = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', second);
    expect(listed.status).toBe(200);
    expect(listed.body.sessions).toHaveLength(2);
    expect(listed.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const current = listed.body.sessions.find((s: { current: boolean }) => s.current);
    expect(current.id).toBe(second.split('=')[1]);
  });

  it('omits an expired full session from the list', async () => {
    const second = cookieOf(await login('pos', '123456'));
    const secondId = second.split('=')[1];
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
    session.lastSeenAt = new Date(0);
    session.expiresAt = new Date(Date.now() + 1000);
    await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', fullCookie);
    expect(session.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + (SESSION_TTL_SECONDS - 5) * 1000);
  });
});
