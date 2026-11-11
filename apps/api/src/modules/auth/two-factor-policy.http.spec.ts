import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MemoryAuthStore } from './testing/memory-auth.store';
import { hashPassword } from './password';

// Spec 2026-11-11-two-factor-policy: per-layer and per-account rule, the fixed method, and signing out the unenrolled.

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const first = (Array.isArray(header) ? header[0] : header) as string;
  return first.split(';')[0];
}

describe('two-step policy per layer and per account', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;

  async function user(overrides: Partial<StoredUser> & { loginName: string }, password = 'password12'): Promise<StoredUser> {
    return {
      id: overrides.loginName,
      disabledAt: null,
      mustChangePassword: false,
      layer: 'agent',
      twoFactorExempt: false,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashPassword(password),
      ...overrides,
    };
  }

  const http = () => request(app.getHttpServer());
  const login = (loginName: string, password = 'password12') => http().post('/auth/login').send({ loginName, password });
  const liveFull = (userId: string) => store.sessions.filter((s) => s.userId === userId && s.scope === 'full' && !s.revokedAt);
  let ownerCookie = '';
  /** A full session for an account that already has two-step verification on, as one that passed the code. */
  async function fullCookie(loginName: string): Promise<string> {
    const token = await store.saveSession({ userId: loginName, scope: 'full', userAgent: 'test', ip: '127.0.0.1' });
    return `sid=${token}`;
  }

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'owner', layer: 'branch', twoFactorExempt: true, isBranchOwner: true }, 'ownerpass1'));
    store.addUser(await user({ loginName: 'ann' }));
    store.addUser(await user({ loginName: 'bob' }));
    store.addUser(await user({ loginName: 'enrolled', twoFactorEnabled: true, twoFactorMethod: 'app', twoFactorSecret: 'S' }));
    store.addUser(await user({ loginName: 'other-layer', layer: 'pos' }));
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

  const setPolicy = (body: Record<string, unknown>) => http().patch('/auth/policy').set('Cookie', ownerCookie).send(body);
  const setMode = (loginName: string, body: Record<string, unknown>) => http().patch(`/auth/users/${loginName}/two-factor`).set('Cookie', ownerCookie).send(body);

  it('reads each layer as optional with the app as its method, until it is set', async () => {
    const response = await http().get('/auth/policy').set('Cookie', ownerCookie);
    expect(response.status).toBe(200);
    expect(response.body.policy.agent).toEqual({ required: false, method: 'app' });
    expect(response.body.policy.pos).toEqual({ required: false, method: 'app' });
  });

  it('keeps the policy for the branch owner alone', async () => {
    const cookie = cookieOf(await login('ann'));
    expect((await http().get('/auth/policy').set('Cookie', cookie)).status).toBe(403);
    expect((await http().patch('/auth/policy').set('Cookie', cookie).send({ layer: 'agent', required: true })).status).toBe(403);
  });

  it('refuses a body that sets nothing or an unknown method', async () => {
    expect((await setPolicy({ layer: 'agent' })).status).toBe(400);
    expect((await setPolicy({ layer: 'agent', method: 'fax' })).status).toBe(400);
  });

  it('signs out the unenrolled accounts of a layer that becomes required, and only them', async () => {
    await login('ann');
    await login('bob');
    await fullCookie('enrolled');
    await login('other-layer');
    const response = await setPolicy({ layer: 'agent', required: true });
    expect(response.status).toBe(200);
    expect(response.body.endedAccounts).toBe(2);
    expect(liveFull('ann')).toHaveLength(0);
    expect(liveFull('bob')).toHaveLength(0);
    expect(liveFull('other-layer')).toHaveLength(1);
    expect(liveFull('enrolled')).toHaveLength(1);
    expect(response.body.policy.agent.required).toBe(true);
    expect((await login('ann')).body.next).toBe('two_factor_enroll');
  });

  it('keeps a session that is already on the enrolment step and an exempt account', async () => {
    store.addUser(await user({ loginName: 'exempt', twoFactorExempt: true }));
    await login('exempt');
    await setPolicy({ layer: 'agent', required: true });
    await login('ann');
    const again = await setPolicy({ layer: 'agent', required: true });
    expect(again.body.endedAccounts).toBe(0);
    expect(liveFull('exempt')).toHaveLength(1);
    expect(store.sessions.filter((s) => s.userId === 'ann' && s.scope === 'two_factor' && !s.revokedAt)).toHaveLength(1);
  });

  it('does not sign the acting owner out of their own layer', async () => {
    store.addUser(await user({ loginName: 'owner2', layer: 'branch' }));
    await login('owner2');
    store.users.get('owner')!.twoFactorExempt = false;
    const response = await setPolicy({ layer: 'branch', required: true });
    expect(response.body.endedAccounts).toBe(1);
    expect(liveFull('owner')).toHaveLength(1);
    expect(liveFull('owner2')).toHaveLength(0);
  });

  it('only changing the method signs nobody out', async () => {
    await login('ann');
    const response = await setPolicy({ layer: 'agent', method: 'sms' });
    expect(response.body.endedAccounts).toBe(0);
    expect(response.body.policy.agent).toEqual({ required: false, method: 'sms' });
    expect(liveFull('ann')).toHaveLength(1);
  });

  it('allows only the layer method while the layer is required', async () => {
    await setPolicy({ layer: 'agent', required: true, method: 'email' });
    const cookie = cookieOf(await login('ann'));
    expect((await http().post('/auth/two-factor/setup').set('Cookie', cookie)).status).toBe(400);
    expect((await http().post('/auth/two-factor/method').set('Cookie', cookie).send({ method: 'sms' })).body.code).toBe('METHOD_NOT_ALLOWED');
    store.users.get('ann')!.email = 'ann@example.com';
    const sent = await http().post('/auth/two-factor/method').set('Cookie', cookie).send({ method: 'email' });
    expect(sent.status).toBe(200);
  });

  it('tells the enrolment screen which methods to offer', async () => {
    const free = cookieOf(await login('ann'));
    expect((await http().get('/auth/two-factor/methods').set('Cookie', free)).body).toEqual({ allowedMethods: ['app', 'sms', 'email'] });
    await setPolicy({ layer: 'agent', required: true, method: 'sms' });
    const fixed = cookieOf(await login('ann'));
    expect((await http().get('/auth/two-factor/methods').set('Cookie', fixed)).body).toEqual({ allowedMethods: ['sms'] });
  });

  it('shows the signed-in account which methods it may use', async () => {
    const free = await http().get('/auth/sign-in-methods').set('Cookie', await fullCookie('enrolled'));
    expect(free.body).toMatchObject({ required: false, allowedMethods: ['app', 'sms', 'email'] });
    await setPolicy({ layer: 'agent', required: true, method: 'sms' });
    const fixed = await http().get('/auth/sign-in-methods').set('Cookie', await fullCookie('enrolled'));
    expect(fixed.body).toMatchObject({ required: true, canDisable: false, allowedMethods: ['sms'] });
  });

  describe('per account', () => {
    it('reads follow by default and what applies now', async () => {
      const response = await http().get('/auth/users/ann/settings').set('Cookie', ownerCookie);
      expect(response.body).toMatchObject({ twoFactorMode: 'follow', requiredMethod: null, effective: { required: false, method: null } });
    });

    it('requires one account whatever its layer says, signs it out, and fixes its method', async () => {
      await login('ann');
      const response = await setMode('ann', { mode: 'required', method: 'email' });
      expect(response.status).toBe(200);
      expect(response.body.endedAccounts).toBe(1);
      expect(response.body.settings).toMatchObject({ twoFactorMode: 'required', requiredMethod: 'email', effective: { required: true, method: 'email' } });
      expect((await login('ann')).body.next).toBe('two_factor_enroll');
      expect((await login('bob')).body.next).toBe('app');
    });

    it('follows the layer method when no method is given', async () => {
      await setPolicy({ layer: 'agent', method: 'sms' });
      const response = await setMode('ann', { mode: 'required' });
      expect(response.body.settings.effective).toEqual({ required: true, method: 'sms' });
    });

    it('lets an optional account skip a required layer, and follow brings it back', async () => {
      await setPolicy({ layer: 'agent', required: true });
      await setMode('ann', { mode: 'optional' });
      expect((await login('ann')).body.next).toBe('app');
      const back = await setMode('ann', { mode: 'follow' });
      expect(back.body.settings).toMatchObject({ twoFactorMode: 'follow', effective: { required: true } });
    });

    it('refuses an account that turns off a required two-step for itself', async () => {
      await setMode('enrolled', { mode: 'required' });
      const cookie = await fullCookie('enrolled');
      expect((await http().delete('/auth/two-factor').set('Cookie', cookie)).status).toBe(403);
      await setMode('enrolled', { mode: 'follow' });
      expect((await http().delete('/auth/two-factor').set('Cookie', cookie)).status).toBe(200);
    });

    it('signs a required account out when its enrolment is reset', async () => {
      await setMode('enrolled', { mode: 'required' });
      await fullCookie('enrolled');
      expect(liveFull('enrolled')).toHaveLength(1);
      expect((await http().delete('/auth/two-factor/enrolled').set('Cookie', ownerCookie)).status).toBe(200);
      expect(liveFull('enrolled')).toHaveLength(0);
      expect((await login('enrolled')).body.next).toBe('two_factor_enroll');
    });

    it('answers 404 for an unknown account and 400 for an unknown mode', async () => {
      expect((await setMode('nobody', { mode: 'optional' })).status).toBe(404);
      expect((await setMode('ann', { mode: 'sometimes' })).status).toBe(400);
    });
  });
});
