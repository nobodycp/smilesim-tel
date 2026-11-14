import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { ActivityModule } from '../auditing/activity.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MESSAGE_SENDER } from './message-sender';
import { MemoryAuthStore } from './testing/memory-auth.store';
import { createTotpSecret, currentTotp } from './totp';
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
  /** Whether the SMS and email gateways deliver. True for the rules of the policy itself; false is today's deployment. */
  let gateways = true;
  let sentMessages = 0;

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
    gateways = true;
    sentMessages = 0;
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'owner', layer: 'branch', twoFactorExempt: true, isBranchOwner: true }, 'ownerpass1'));
    store.addUser(await user({ loginName: 'ann' }));
    store.addUser(await user({ loginName: 'bob' }));
    store.addUser(await user({ loginName: 'enrolled', twoFactorEnabled: true, twoFactorMethod: 'app', twoFactorSecret: 'S' }));
    store.addUser(await user({ loginName: 'other-layer', layer: 'pos' }));
    const moduleRef = await Test.createTestingModule({ imports: [ActivityModule, AuthModule] })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .overrideProvider(MESSAGE_SENDER)
      .useValue({ send: async () => { sentMessages += 1; }, delivers: () => gateways })
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

  // Spec 2026-11-12-two-factor-available-methods: SMS and email are not offered, required or enrolled while no
  // gateway delivers them. Nothing stored is changed by that, and nobody is locked out by it.
  describe('while no SMS or email gateway delivers', () => {
    const liveAny = (userId: string) => store.sessions.filter((s) => s.userId === userId && !s.revokedAt);
    const methodsOf = async (cookie: string) => (await http().get('/auth/two-factor/methods').set('Cookie', cookie)).body.allowedMethods;
    beforeEach(() => {
      gateways = false;
    });

    it.each(['sms', 'email'])('refuses a layer set to %s, optional or required, writes nothing and signs nobody out', async (method) => {
      await login('ann');
      for (const body of [{ layer: 'agent', method }, { layer: 'agent', required: true, method }]) {
        const response = await setPolicy(body);
        expect([response.status, response.body.code]).toEqual([400, 'METHOD_UNAVAILABLE']);
      }
      expect(await store.policy()).toMatchObject({ agent: false });
      expect((await store.layerMethods()).agent).toBe('app');
      expect(liveFull('ann')).toHaveLength(1);
      expect((await login('ann')).body.next).toBe('app');
    });

    it('accepts the app for a layer, required or not', async () => {
      expect((await setPolicy({ layer: 'agent', method: 'app' })).status).toBe(200);
      const required = await setPolicy({ layer: 'agent', required: true, method: 'app' });
      expect(required.status).toBe(200);
      expect(required.body.policy.agent).toEqual({ required: true, method: 'app' });
    });

    it.each(['sms', 'email'] as const)('refuses an account required with %s, writes nothing and signs it out of nothing', async (method) => {
      await login('ann');
      const response = await setMode('ann', { mode: 'required', method });
      expect([response.status, response.body.code]).toEqual([400, 'METHOD_UNAVAILABLE']);
      expect(store.users.get('ann')).toMatchObject({ twoFactorExempt: false });
      expect(store.users.get('ann')!.twoFactorRequired ?? false).toBe(false);
      expect(store.users.get('ann')!.requiredMethod ?? null).toBeNull();
      expect(liveFull('ann')).toHaveLength(1);
    });

    it('accepts an account required with the app, or with its layer\'s app', async () => {
      const own = await setMode('ann', { mode: 'required', method: 'app' });
      expect(own.body.settings).toMatchObject({ twoFactorMode: 'required', requiredMethod: 'app', effective: { required: true, method: 'app' } });
      const layers = await setMode('bob', { mode: 'required' });
      expect(layers.body.settings.effective).toEqual({ required: true, method: 'app' });
    });

    it('offers and accepts only the app at enrolment, and sends no code', async () => {
      const cookie = cookieOf(await login('ann'));
      store.users.get('ann')!.phone = '+972 52-123-4567';
      store.users.get('ann')!.email = 'ann@example.com';
      expect(await methodsOf(cookie)).toEqual(['app']);
      expect((await http().get('/auth/sign-in-methods').set('Cookie', cookie)).body.allowedMethods).toEqual(['app']);
      for (const method of ['sms', 'email']) {
        expect((await http().post('/auth/two-factor/method').set('Cookie', cookie).send({ method })).body.code).toBe('METHOD_UNAVAILABLE');
        expect((await http().post('/auth/two-factor/method/confirm').set('Cookie', cookie).send({ method, code: '123456' })).body.code).toBe('METHOD_UNAVAILABLE');
      }
      expect(sentMessages).toBe(0);
      expect(store.users.get('ann')!.twoFactorEnabled).toBe(false);
    });

    describe('settings stored before the methods were switched off', () => {
      it('a layer left on SMS: what is stored is kept, making it required again is refused, and its accounts enrol with the app', async () => {
        await store.setLayerMethod('agent', 'sms');
        await store.setPolicy('agent', true);
        // Reading shows what is stored.
        expect((await http().get('/auth/policy').set('Cookie', ownerCookie)).body.policy.agent).toEqual({ required: true, method: 'sms' });
        // Saving it as required with that method again is refused, and nobody is signed out by the attempt.
        await fullCookie('bob');
        expect((await setPolicy({ layer: 'agent', required: true })).body.code).toBe('METHOD_UNAVAILABLE');
        expect(liveFull('bob')).toHaveLength(1);
        expect((await store.layerMethods()).agent).toBe('sms');
        // An account of the layer still has to enrol, and is offered a method it can carry out.
        const signIn = await login('ann');
        expect(signIn.body.next).toBe('two_factor_enroll');
        const cookie = cookieOf(signIn);
        expect(await methodsOf(cookie)).toEqual(['app']);
        const setup = await http().post('/auth/two-factor/setup').set('Cookie', cookie);
        expect(setup.status).toBe(200);
        const secret = new URL(setup.body.otpauth).searchParams.get('secret') ?? '';
        const enabled = await http().post('/auth/two-factor/confirm').set('Cookie', cookie).send({ code: currentTotp(secret) });
        expect(enabled.status).toBe(200);
        expect(store.users.get('ann')).toMatchObject({ twoFactorEnabled: true, twoFactorMethod: 'app' });
        // The owner repairs the layer by naming the app; optional is always allowed.
        expect((await setPolicy({ layer: 'agent', required: true, method: 'app' })).status).toBe(200);
        expect((await setPolicy({ layer: 'agent', required: false })).status).toBe(200);
      });

      it('an account held to email: the setting is kept, it enrols with the app, and following an SMS layer by «required» is refused', async () => {
        Object.assign(store.users.get('ann')!, { twoFactorRequired: true, requiredMethod: 'email' });
        const settings = await http().get('/auth/users/ann/settings').set('Cookie', ownerCookie);
        expect(settings.body).toMatchObject({ twoFactorMode: 'required', requiredMethod: 'email', effective: { required: true, method: 'email' } });
        const signIn = await login('ann');
        expect(signIn.body.next).toBe('two_factor_enroll');
        expect(await methodsOf(cookieOf(signIn))).toEqual(['app']);
        expect(store.users.get('ann')).toMatchObject({ twoFactorRequired: true, requiredMethod: 'email' });
        await store.setLayerMethod('agent', 'sms');
        expect((await setMode('bob', { mode: 'required' })).body.code).toBe('METHOD_UNAVAILABLE');
        expect((await setMode('bob', { mode: 'required', method: 'app' })).status).toBe(200);
      });

      it('an account enrolled with SMS: it is not let in without its code, is told the method is unavailable, and the owner\'s reset brings it back through the app', async () => {
        Object.assign(store.users.get('ann')!, { twoFactorEnabled: true, twoFactorMethod: 'sms', phone: '+972 52-123-4567' });
        const signIn = await login('ann');
        expect(signIn.body.next).toBe('two_factor_code');
        const cookie = cookieOf(signIn);
        const sent = await http().post('/auth/two-factor/send').set('Cookie', cookie);
        expect([sent.status, sent.body.code]).toEqual([400, 'METHOD_UNAVAILABLE']);
        expect(sentMessages).toBe(0);
        // The second step is not skipped and not weakened: no code, no session.
        expect((await http().post('/auth/two-factor/verify').set('Cookie', cookie).send({ code: '123456' })).status).toBe(401);
        expect(liveFull('ann')).toHaveLength(0);
        expect(store.users.get('ann')).toMatchObject({ twoFactorEnabled: true, twoFactorMethod: 'sms' });
        // Only the branch owner resets it, as before; the account then enrols with the app when it has to.
        const bob = cookieOf(await login('bob'));
        expect((await http().delete('/auth/two-factor/ann').set('Cookie', bob)).status).toBe(403);
        await setPolicy({ layer: 'agent', required: true, method: 'app' });
        expect((await http().delete('/auth/two-factor/ann').set('Cookie', ownerCookie)).status).toBe(200);
        expect(liveAny('ann').filter((s) => s.scope === 'full')).toHaveLength(0);
        const again = await login('ann');
        expect(again.body.next).toBe('two_factor_enroll');
        expect(await methodsOf(cookieOf(again))).toEqual(['app']);
      });
    });

    // Owner's decision, 2026-11-12: an account held by an old setting to SMS or email enrols with the app. The
    // requirement itself is whole: no full session before a right code, at enrolment and at every later sign-in.
    it('an account held to email by an old setting: no full session until its app code is right, the app is what is stored, later sign-ins ask for the code, and no rule is rewritten', async () => {
      Object.assign(store.users.get('ann')!, { twoFactorRequired: true, requiredMethod: 'email', email: 'ann@example.com' });
      await store.setLayerMethod('agent', 'sms');
      const rules = async () => ({ policy: await store.policy(), methods: await store.layerMethods(), ann: { required: store.users.get('ann')!.twoFactorRequired, method: store.users.get('ann')!.requiredMethod, exempt: store.users.get('ann')!.twoFactorExempt } });
      const before = await rules();
      const scopes = () => liveAny('ann').map((s) => s.scope);

      // Signing in gives the enrolment step only.
      const signIn = await login('ann');
      expect(signIn.body.next).toBe('two_factor_enroll');
      const cookie = cookieOf(signIn);
      expect(scopes()).toEqual(['two_factor']);
      expect((await http().get('/auth/sign-in-methods').set('Cookie', cookie)).status).toBe(403);
      expect((await http().get('/auth/policy').set('Cookie', cookie)).status).toBe(403);

      // A wrong code enrols nothing and opens nothing.
      const setup = await http().post('/auth/two-factor/setup').set('Cookie', cookie);
      const secret = new URL(setup.body.otpauth).searchParams.get('secret') ?? '';
      const wrong = currentTotp(secret) === '000000' ? '111111' : '000000';
      expect((await http().post('/auth/two-factor/confirm').set('Cookie', cookie).send({ code: wrong })).status).toBe(401);
      expect(store.users.get('ann')!.twoFactorEnabled).toBe(false);
      expect(scopes()).toEqual(['two_factor']);

      // The right code turns it on with the app, and only then is there a full session.
      const confirmed = await http().post('/auth/two-factor/confirm').set('Cookie', cookie).send({ code: currentTotp(secret) });
      expect(confirmed.status).toBe(200);
      expect(store.users.get('ann')).toMatchObject({ twoFactorEnabled: true, twoFactorMethod: 'app', twoFactorSecret: secret });
      expect(scopes()).toEqual(['full']);
      const full = confirmed.headers['set-cookie'] ? cookieOf(confirmed) : cookie;
      // It may not turn the second step off, and is offered nothing but the app.
      const own = await http().get('/auth/sign-in-methods').set('Cookie', full);
      expect(own.body).toMatchObject({ twoFactorEnabled: true, twoFactorMethod: 'app', required: true, canDisable: false, allowedMethods: ['app'] });
      expect((await http().delete('/auth/two-factor').set('Cookie', full)).status).toBe(403);

      // The next sign-in: the password alone gives the code step, a wrong code nothing, the app's code a session.
      await store.revokeSessions(liveAny('ann').map((s) => s.id));
      const again = await login('ann');
      expect(again.body.next).toBe('two_factor_code');
      const step = cookieOf(again);
      expect(scopes()).toEqual(['two_factor']);
      expect((await http().post('/auth/two-factor/send').set('Cookie', step)).body).toEqual({ method: 'app' });
      expect((await http().post('/auth/two-factor/verify').set('Cookie', step).send({ code: wrong })).status).toBe(401);
      expect(scopes()).toEqual(['two_factor']);
      expect((await http().post('/auth/two-factor/verify').set('Cookie', step).send({ code: currentTotp(secret) })).status).toBe(200);
      expect(scopes()).toEqual(['full']);

      // Nothing of the stored rules moved: the account is still held to email, its layer still names SMS.
      expect(await rules()).toEqual(before);
      expect((await http().get('/auth/users/ann/settings').set('Cookie', ownerCookie)).body).toMatchObject({ twoFactorMode: 'required', requiredMethod: 'email', twoFactorEnabled: true, twoFactorMethod: 'app' });
    });

    it('signing in with the app goes on as before', async () => {
      const secret = createTotpSecret();
      Object.assign(store.users.get('enrolled')!, { twoFactorSecret: secret });
      const signIn = await login('enrolled');
      expect(signIn.body.next).toBe('two_factor_code');
      const cookie = cookieOf(signIn);
      expect((await http().post('/auth/two-factor/send').set('Cookie', cookie)).body).toEqual({ method: 'app' });
      const verified = await http().post('/auth/two-factor/verify').set('Cookie', cookie).send({ code: currentTotp(secret) });
      expect(verified.status).toBe(200);
      expect(liveFull('enrolled')).toHaveLength(1);
    });
  });
});
