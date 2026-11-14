import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { ActivityModule } from '../auditing/activity.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MemoryAuthStore } from './testing/memory-auth.store';
import { hashPassword } from './password';
import { createTotpSecret, currentTotp } from './totp';

const WRONG_CODE = 'الرمز غير صحيح';

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const first = (Array.isArray(header) ? header[0] : header) as string;
  return first.split(';')[0];
}

describe('two-factor endpoints', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;

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

  const http = () => request(app.getHttpServer());
  const login = (loginName: string, password: string) => http().post('/auth/login').send({ loginName, password });
  const stored = (loginName: string) => store.users.get(loginName)!;
  const fullSessions = () => store.sessions.filter((s) => s.scope === 'full' && !s.revokedAt);

  /** Enrolls `loginName` in the store directly and returns its secret. */
  function enableTwoFactor(loginName: string): string {
    const secret = createTotpSecret();
    Object.assign(stored(loginName), { twoFactorEnabled: true, twoFactorSecret: secret });
    return secret;
  }

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'employee', layer: 'branch' }, '12345678'));
    store.addUser(await user({ loginName: 'pos', twoFactorExempt: true }, '123456'));
    store.addUser(await user({ loginName: 'owner', layer: 'branch', twoFactorExempt: true, isBranchOwner: true }, 'ownerpass1'));
    const moduleRef = await Test.createTestingModule({ imports: [ActivityModule, AuthModule] })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('forces enrollment for a branch employee when the branch layer is required', async () => {
    await store.setPolicy('branch', true);
    const response = await login('employee', '12345678');
    expect(response.body.next).toBe('two_factor_enroll');
  });

  it('lets a trial account skip enrollment', async () => {
    await store.setPolicy('pos', true);
    const response = await login('pos', '123456');
    expect(response.body.next).toBe('app');
  });

  it('does not open a full session for a wrong code', async () => {
    store.addUser(await user({ loginName: 'coded', layer: 'branch' }, 'codedpass1'));
    enableTwoFactor('coded');
    const twoFactorCookie = cookieOf(await login('coded', 'codedpass1'));
    expect(store.sessions.map((s) => s.scope)).toEqual(['two_factor']);

    const response = await http().post('/auth/two-factor/verify').set('Cookie', twoFactorCookie).send({ code: '000000' });
    expect(response.status).toBe(401);
    expect(response.body.message).toBe(WRONG_CODE);
    expect(store.sessions.some((session) => session.scope === 'full')).toBe(false);
  });

  it('stops guessing: wrong codes count with wrong passwords, the pending session closes at the limit, and a used code is not taken twice (review 2026-11-10, S4)', async () => {
    store.addUser(await user({ loginName: 'coded', layer: 'branch' }, 'codedpass1'));
    const secret = enableTwoFactor('coded');
    const pending = cookieOf(await login('coded', 'codedpass1'));
    const verify = (cookie: string, code: string) => http().post('/auth/two-factor/verify').set('Cookie', cookie).send({ code });
    for (let guess = 0; guess < 10; guess += 1) expect((await verify(pending, '000000')).status).toBe(401);
    // The eleventh is refused even with the right code, and the session it was guessed on is gone.
    expect((await verify(pending, currentTotp(secret))).status).toBe(429);
    expect((await verify(pending, currentTotp(secret))).status).toBe(401);
    expect(store.sessions.some((session) => session.scope === 'full')).toBe(false);

    await store.clearFailures('coded');
    const code = currentTotp(secret);
    expect((await verify(cookieOf(await login('coded', 'codedpass1')), code)).status).toBe(200);
    expect((await verify(cookieOf(await login('coded', 'codedpass1')), code)).status).toBe(401);
  });

  it('replaces the cookie with a full session for a correct code and applies the session limit', async () => {
    store.addUser(await user({ loginName: 'coded', layer: 'branch' }, 'codedpass1'));
    const secret = enableTwoFactor('coded');
    for (let i = 0; i < 3; i += 1) {
      await store.saveSession({ userId: 'coded', scope: 'full', userAgent: `old-${i}`, ip: '1.1.1.1' });
    }
    const [oldest, ...newer] = fullSessions();
    const twoFactorCookie = cookieOf(await login('coded', 'codedpass1'));
    // The login of a two-factor user must not have touched the existing full sessions.
    expect(fullSessions()).toHaveLength(3);

    const response = await http()
      .post('/auth/two-factor/verify')
      .set('Cookie', twoFactorCookie)
      .send({ code: currentTotp(secret) });
    expect(response.status).toBe(200);
    expect(response.body.next).toBe('app');

    const fullCookie = cookieOf(response);
    expect(fullCookie).not.toBe(twoFactorCookie);
    const live = fullSessions();
    expect(live).toHaveLength(3);
    expect(live.map((s) => s.id)).not.toContain(oldest.id);
    expect(live.map((s) => s.id)).toEqual(expect.arrayContaining(newer.map((s) => s.id)));
    expect(store.sessions.filter((s) => s.scope === 'two_factor' && !s.revokedAt)).toHaveLength(0);
    const sessions = await http().get('/auth/sessions').set('Cookie', fullCookie);
    expect(sessions.status).toBe(200);
  });

  it('rejects verify without a two-factor session', async () => {
    const none = await http().post('/auth/two-factor/verify').send({ code: '123456' });
    expect(none.status).toBe(401);
    const fullCookie = cookieOf(await login('pos', '123456'));
    const full = await http().post('/auth/two-factor/verify').set('Cookie', fullCookie).send({ code: '123456' });
    expect(full.status).toBe(403);
  });

  it('forbids a non-owner from clearing another account secret', async () => {
    enableTwoFactor('employee');
    const posCookie = cookieOf(await login('pos', '123456'));
    const response = await http().delete('/auth/two-factor/employee').set('Cookie', posCookie);
    expect(response.status).toBe(403);
    expect(stored('employee').twoFactorEnabled).toBe(true);
  });

  it('lets the owner clear another account secret', async () => {
    enableTwoFactor('employee');
    const ownerCookie = cookieOf(await login('owner', 'ownerpass1'));
    const response = await http().delete('/auth/two-factor/employee').set('Cookie', ownerCookie);
    expect(response.status).toBe(200);
    expect(stored('employee').twoFactorEnabled).toBe(false);
    expect(stored('employee').twoFactorSecret).toBeNull();
    const missing = await http().delete('/auth/two-factor/nobody').set('Cookie', ownerCookie);
    expect(missing.status).toBe(404);
  });

  it('lets the branch owner require two-factor for the POS layer', async () => {
    const ownerCookie = cookieOf(await login('owner', 'ownerpass1'));
    const response = await http().patch('/auth/policy').set('Cookie', ownerCookie).send({ layer: 'pos', required: true });
    expect(response.status).toBe(200);
    expect((await store.policy()).pos).toBe(true);
  });

  it('forbids a non-owner from changing the policy and rejects a bad body', async () => {
    const posCookie = cookieOf(await login('pos', '123456'));
    const forbidden = await http().patch('/auth/policy').set('Cookie', posCookie).send({ layer: 'pos', required: true });
    expect(forbidden.status).toBe(403);
    expect((await store.policy()).pos).toBe(false);

    const ownerCookie = cookieOf(await login('owner', 'ownerpass1'));
    const bad = await http().patch('/auth/policy').set('Cookie', ownerCookie).send({ layer: 'nope', required: true });
    expect(bad.status).toBe(400);
    const none = await http().patch('/auth/policy').send({ layer: 'pos', required: true });
    expect(none.status).toBe(401);
  });

  it('lets only the owner change an exemption', async () => {
    const posCookie = cookieOf(await login('pos', '123456'));
    const forbidden = await http().patch('/auth/exemptions/employee').set('Cookie', posCookie).send({ exempt: true });
    expect(forbidden.status).toBe(403);
    expect(stored('employee').twoFactorExempt).toBe(false);

    const ownerCookie = cookieOf(await login('owner', 'ownerpass1'));
    const ok = await http().patch('/auth/exemptions/employee').set('Cookie', ownerCookie).send({ exempt: true });
    expect(ok.status).toBe(200);
    expect(stored('employee').twoFactorExempt).toBe(true);
    const missing = await http().patch('/auth/exemptions/nobody').set('Cookie', ownerCookie).send({ exempt: true });
    expect(missing.status).toBe(404);
    const bad = await http().patch('/auth/exemptions/employee').set('Cookie', ownerCookie).send({ exempt: 'yes' });
    expect(bad.status).toBe(400);
  });

  it('asks an exempt account for a code after that account turns two-factor on', async () => {
    const posCookie = cookieOf(await login('pos', '123456'));
    const setup = await http().post('/auth/two-factor/setup').set('Cookie', posCookie);
    expect(setup.status).toBe(200);
    expect(setup.body.otpauth).toMatch(/^otpauth:\/\/totp\/.+secret=/);
    const pending = stored('pos').pendingTwoFactorSecret!;
    expect(setup.body.otpauth).toContain(pending);
    expect(stored('pos').twoFactorEnabled).toBe(false);

    const currentCode = currentTotp(pending);
    const confirm = await http().post('/auth/two-factor/confirm').set('Cookie', posCookie).send({ code: currentCode });
    expect(confirm.status).toBe(200);
    expect(stored('pos').twoFactorEnabled).toBe(true);
    expect(stored('pos').twoFactorExempt).toBe(true);
    expect(stored('pos').twoFactorSecret).toBe(pending);

    const next = await login('pos', '123456');
    expect(next.body.next).toBe('two_factor_code');
  });

  it('does not enable two-factor for a wrong confirmation code', async () => {
    const posCookie = cookieOf(await login('pos', '123456'));
    await http().post('/auth/two-factor/setup').set('Cookie', posCookie);
    const confirm = await http().post('/auth/two-factor/confirm').set('Cookie', posCookie).send({ code: '000000' });
    expect(confirm.status).toBe(401);
    expect(confirm.body.message).toBe(WRONG_CODE);
    expect(stored('pos').twoFactorEnabled).toBe(false);
    const ownerCookie = cookieOf(await login('owner', 'ownerpass1'));
    const noSetup = await http().post('/auth/two-factor/confirm').set('Cookie', ownerCookie).send({ code: '123456' });
    expect(noSetup.status).toBe(400);
  });

  it('completes enrollment from the enroll session and opens a full session', async () => {
    await store.setPolicy('branch', true);
    const enrollCookie = cookieOf(await login('employee', '12345678'));
    expect(fullSessions()).toHaveLength(0);
    await http().post('/auth/two-factor/setup').set('Cookie', enrollCookie);
    const code = currentTotp(stored('employee').pendingTwoFactorSecret!);
    const confirm = await http().post('/auth/two-factor/confirm').set('Cookie', enrollCookie).send({ code });
    expect(confirm.status).toBe(200);
    expect(confirm.body.next).toBe('app');
    expect(fullSessions()).toHaveLength(1);
    const fullCookie = cookieOf(confirm);
    expect((await http().get('/auth/sessions').set('Cookie', fullCookie)).status).toBe(200);
    expect((await login('employee', '12345678')).body.next).toBe('two_factor_code');
  });

  it('refuses a new authenticator enrolment in production without a sealing key, and allows it with one', async () => {
    const posCookie = cookieOf(await login('pos', '123456'));
    const before = { env: process.env.NODE_ENV, key: process.env.SECRETS_KEY };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SECRETS_KEY;
      const refused = await http().post('/auth/two-factor/setup').set('Cookie', posCookie);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('APP_CODE_UNAVAILABLE');
      expect(stored('pos').pendingTwoFactorSecret ?? null).toBeNull();
      process.env.SECRETS_KEY = Buffer.alloc(32, 5).toString('base64');
      expect((await http().post('/auth/two-factor/setup').set('Cookie', posCookie)).status).toBe(200);
    } finally {
      process.env.NODE_ENV = before.env;
      if (before.key === undefined) delete process.env.SECRETS_KEY;
      else process.env.SECRETS_KEY = before.key;
    }
  });

  it('refuses to replace the secret of an account that already has two-factor on', async () => {
    store.addUser(await user({ loginName: 'coded', layer: 'branch' }, 'codedpass1'));
    const secret = enableTwoFactor('coded');
    const twoFactorCookie = cookieOf(await login('coded', 'codedpass1'));
    const setup = await http().post('/auth/two-factor/setup').set('Cookie', twoFactorCookie);
    expect(setup.status).toBe(403);
    expect(stored('coded').pendingTwoFactorSecret ?? null).toBeNull();
    expect(stored('coded').twoFactorSecret).toBe(secret);
  });

  it('refuses a self-disable when the layer is mandatory and the account is not exempt', async () => {
    enableTwoFactor('employee');
    await store.setPolicy('branch', true);
    const employeeSession = await store.saveSession({ userId: 'employee', scope: 'full', userAgent: '', ip: '' });
    const response = await http().delete('/auth/two-factor').set('Cookie', `sid=${employeeSession}`);
    expect(response.status).toBe(403);
    expect(stored('employee').twoFactorEnabled).toBe(true);
  });

  it('allows a self-disable when the layer is not required or the account is exempt', async () => {
    enableTwoFactor('employee');
    const employeeSession = await store.saveSession({ userId: 'employee', scope: 'full', userAgent: '', ip: '' });
    const open = await http().delete('/auth/two-factor').set('Cookie', `sid=${employeeSession}`);
    expect(open.status).toBe(200);
    expect(stored('employee').twoFactorEnabled).toBe(false);
    expect(stored('employee').twoFactorSecret).toBeNull();

    await store.setPolicy('pos', true);
    enableTwoFactor('pos');
    const posSession = await store.saveSession({ userId: 'pos', scope: 'full', userAgent: '', ip: '' });
    const exempt = await http().delete('/auth/two-factor').set('Cookie', `sid=${posSession}`);
    expect(exempt.status).toBe(200);
    expect(stored('pos').twoFactorEnabled).toBe(false);
    expect(stored('pos').twoFactorExempt).toBe(true);
  });
});
