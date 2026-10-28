import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { AUTH_STORE, MemoryAuthStore } from './auth.store';
import { hashPassword } from './password';
import { SESSION_TTL_SECONDS } from './sessions';

describe('POST /auth/login', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser({
      id: 'pos',
      loginName: 'pos',
      disabledAt: null,
      mustChangePassword: false,
      layer: 'pos',
      twoFactorExempt: true,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashPassword('123456'),
    });
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.COOKIE_SECURE;
    delete process.env.COOKIE_DOMAIN;
  });

  it('sets a cookie and returns app for the trial POS', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '123456' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ next: 'app' });
    expect(response.headers['set-cookie'][0]).toContain('sid=');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie'][0]).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(response.headers['set-cookie'][0]).not.toContain('Secure');
    expect(response.headers['set-cookie'][0]).not.toContain('Domain');
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + (SESSION_TTL_SECONDS - 5) * 1000);
  });

  it('adds Secure and Domain only when configured', async () => {
    process.env.COOKIE_SECURE = 'true';
    process.env.COOKIE_DOMAIN = 'example.com';
    const response = await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '123456' });
    expect(response.headers['set-cookie'][0]).toContain('Secure');
    expect(response.headers['set-cookie'][0]).toContain('Domain=example.com');
  });

  it('creates a new session row on every successful login and clears failures', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: 'wrong-pass' });
    expect(await store.failedCount('pos')).toBe(1);
    await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '123456' });
    await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '123456' });
    expect(store.sessions).toHaveLength(2);
    expect(await store.failedCount('pos')).toBe(0);
  });

  it('revokes the oldest full session when a fourth login arrives', async () => {
    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '123456' });
    }
    expect(store.sessions).toHaveLength(4);
    expect(store.sessions.filter((s) => !s.revokedAt)).toHaveLength(3);
    expect(store.sessions[0].revokedAt).not.toBeNull();
  });

  it('returns the same 401 for an unknown user and a wrong password', async () => {
    const unknown = await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'missing', password: '123456' });
    const wrong = await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '00000000' });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body.message).toBe('بيانات الدخول غير صحيحة');
    expect(await store.failedCount('missing')).toBe(1);
    expect(await store.failedCount('pos')).toBe(1);
  });

  it('does not count a disabled account as a failure', async () => {
    store.users.get('pos')!.disabledAt = new Date();
    const response = await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '123456' });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'الحساب موقوف' });
    expect(await store.failedCount('pos')).toBe(0);
  });

  it('returns 429 once the failure count reaches the limit', async () => {
    store.setFailedCount('pos', 10);
    const response = await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '123456' });
    expect(response.status).toBe(429);
    expect(response.body).toEqual({ message: 'محاولات كثيرة. أعد المحاولة بعد قليل' });
  });
});
