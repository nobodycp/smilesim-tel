import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { AUTH_STORE, MemoryAuthStore, StoredUser } from './auth.store';

// «إعدادات المستخدم» (spec 2026-11-08-overview-and-reports-nav, H): the branch owner reads another account's email,
// mobile and second step, and sets the email and mobile. Nobody else may.
describe('user settings', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;
  let owner: string;
  let agent: string;

  const user = (overrides: Partial<StoredUser> & { loginName: string }): StoredUser => ({
    id: overrides.loginName, nickname: overrides.loginName, disabledAt: null, mustChangePassword: false, layer: 'pos',
    twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x', ...overrides,
  });
  const http = () => request(app.getHttpServer());

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser(user({ loginName: 'owner', layer: 'branch', isBranchOwner: true }));
    store.addUser(user({ loginName: 'agent1', layer: 'agent' }));
    store.addUser(user({ loginName: 'seller', email: 'shop@example.com', twoFactorEnabled: true, twoFactorExempt: false, twoFactorMethod: 'sms' }));
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).overrideProvider(AUTH_STORE).useValue(store).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    owner = `sid=${await store.saveSession({ userId: 'owner', scope: 'full', userAgent: '', ip: '' })}`;
    agent = `sid=${await store.saveSession({ userId: 'agent1', scope: 'full', userAgent: '', ip: '' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('shows the branch owner an account\'s contact details and second step', async () => {
    const read = await http().get('/auth/users/seller/settings').set('Cookie', owner);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ loginName: 'seller', email: 'shop@example.com', phone: '', twoFactorEnabled: true, twoFactorExempt: false, twoFactorMethod: 'sms' });
    expect((await http().get('/auth/users/nobody/settings').set('Cookie', owner)).status).toBe(404);
  });

  it('lets the branch owner set and clear the email and mobile, and checks them', async () => {
    const saved = await http().patch('/auth/users/seller/contact').set('Cookie', owner).send({ email: '', phone: '0501234567' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ email: '', phone: '0501234567' });
    expect((await http().patch('/auth/users/seller/contact').set('Cookie', owner).send({ email: 'not-an-email' })).body.code).toBe('EMAIL_INVALID');
    expect((await http().patch('/auth/users/seller/contact').set('Cookie', owner).send({ phone: 'abc' })).body.code).toBe('PHONE_INVALID');
    expect((await http().patch('/auth/users/seller/contact').set('Cookie', owner).send({ phone: 5 })).body.code).toBe('INVALID');
  });

  it('refuses anyone but the branch owner, and a visitor with no session', async () => {
    expect((await http().get('/auth/users/seller/settings').set('Cookie', agent)).status).toBe(403);
    expect((await http().patch('/auth/users/seller/contact').set('Cookie', agent).send({ phone: '0501234567' })).status).toBe(403);
    expect((await http().get('/auth/users/seller/settings')).status).toBe(401);
  });
});
