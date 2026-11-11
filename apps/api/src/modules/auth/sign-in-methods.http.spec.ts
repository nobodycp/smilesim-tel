import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MemoryAuthStore } from './testing/memory-auth.store';
import { MESSAGE_SENDER, type OutgoingMessage } from './message-sender';
import { CODE_TRIES } from './one-time-code';
import { relyingParty } from './passkeys';
import { hashPassword } from './password';

// The browser half of a passkey cannot run here, so the two verify calls are stood in for; options are real.
jest.mock('@simplewebauthn/server', () => {
  const actual = jest.requireActual('@simplewebauthn/server');
  return {
    ...actual,
    verifyRegistrationResponse: jest.fn(async () => ({
      verified: true,
      registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } },
    })),
    verifyAuthenticationResponse: jest.fn(async () => ({ verified: true, authenticationInfo: { newCounter: 7 } })),
  };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webauthn = require('@simplewebauthn/server') as { verifyAuthenticationResponse: jest.Mock };

const ORIGIN = 'http://admin.localhost:3000';

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const first = (Array.isArray(header) ? header[0] : header) as string;
  return first.split(';')[0];
}

describe('sign-in methods', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;
  let sent: OutgoingMessage[];

  async function user(overrides: Partial<StoredUser> & { loginName: string }): Promise<StoredUser> {
    return {
      id: overrides.loginName,
      disabledAt: null,
      mustChangePassword: false,
      layer: 'branch',
      twoFactorExempt: false,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashPassword('password12'),
      ...overrides,
    };
  }

  const http = () => request(app.getHttpServer());
  const login = (loginName: string) => http().post('/auth/login').send({ loginName, password: 'password12' });
  const fullCookie = async (loginName: string) => `sid=${await store.saveSession({ userId: loginName, scope: 'full', userAgent: '', ip: '' })}`;
  const lastCode = () => /(\d{6})/.exec(sent.at(-1)?.text ?? '')?.[1] ?? '';
  const stored = (loginName: string) => store.users.get(loginName)!;

  beforeEach(async () => {
    sent = [];
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'sara', phone: '+972 52-123-4567', email: 'sara@example.com' }));
    store.addUser(await user({ loginName: 'bare' }));
    store.addUser(await user({ loginName: 'seller', layer: 'pos', email: 'seller@example.com' }));
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .overrideProvider(MESSAGE_SENDER)
      .useValue({ send: async (message: OutgoingMessage) => { sent.push(message); }, delivers: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('turns on SMS from settings with the code it sends, and resends at most every 30 seconds', async () => {
    const cookie = await fullCookie('sara');
    const missing = await http().post('/auth/two-factor/method').set('Cookie', await fullCookie('bare')).send({ method: 'sms' });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('CONTACT_MISSING');

    const first = await http().post('/auth/two-factor/method').set('Cookie', cookie).send({ method: 'sms' });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ sentTo: '•••••4567', sent: true, retryIn: 30 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'sms', to: '+972 52-123-4567' });
    expect(JSON.stringify(first.body)).not.toContain(lastCode());

    const again = await http().post('/auth/two-factor/method').set('Cookie', cookie).send({ method: 'sms' });
    expect(again.body.sent).toBe(false);
    expect(sent).toHaveLength(1);

    const wrong = await http().post('/auth/two-factor/method/confirm').set('Cookie', cookie).send({ method: 'sms', code: '000000' === lastCode() ? '111111' : '000000' });
    expect(wrong.body.code).toBe('WRONG_CODE');
    const right = await http().post('/auth/two-factor/method/confirm').set('Cookie', cookie).send({ method: 'sms', code: lastCode() });
    expect(right.status).toBe(200);
    expect(stored('sara')).toMatchObject({ twoFactorEnabled: true, twoFactorMethod: 'sms', twoFactorSecret: null });

    const view = await http().get('/auth/sign-in-methods').set('Cookie', cookie);
    expect(view.body).toMatchObject({ twoFactorEnabled: true, twoFactorMethod: 'sms', canDisable: true, phone: '•••••4567', email: 's•••@example.com', passkeys: [] });
  });

  it('a code sent for one method does not confirm another', async () => {
    const cookie = await fullCookie('sara');
    await http().post('/auth/two-factor/method').set('Cookie', cookie).send({ method: 'email' });
    const other = await http().post('/auth/two-factor/method/confirm').set('Cookie', cookie).send({ method: 'sms', code: lastCode() });
    expect(other.body.code).toBe('CODE_EXPIRED');
    expect(stored('sara').twoFactorEnabled).toBe(false);
  });

  it('signs in with an email code, and spends the code after five wrong tries', async () => {
    Object.assign(stored('sara'), { twoFactorEnabled: true, twoFactorMethod: 'email' });
    const challenge = await login('sara');
    expect(challenge.body.next).toBe('two_factor_code');
    const cookie = cookieOf(challenge);

    const send = await http().post('/auth/two-factor/send').set('Cookie', cookie);
    expect(send.body).toMatchObject({ method: 'email', sentTo: 's•••@example.com', sent: true });
    expect(sent[0]).toMatchObject({ channel: 'email', to: 'sara@example.com' });
    const code = lastCode();
    const wrongCode = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < CODE_TRIES; attempt += 1) {
      expect((await http().post('/auth/two-factor/verify').set('Cookie', cookie).send({ code: wrongCode })).body.code).toBe('WRONG_CODE');
    }
    const late = await http().post('/auth/two-factor/verify').set('Cookie', cookie).send({ code });
    expect(late.body.code).toBe('CODE_EXPIRED');
  });

  it('the right code turns the challenge into a full session', async () => {
    Object.assign(stored('sara'), { twoFactorEnabled: true, twoFactorMethod: 'sms' });
    const cookie = cookieOf(await login('sara'));
    await http().post('/auth/two-factor/send').set('Cookie', cookie);
    const verify = await http().post('/auth/two-factor/verify').set('Cookie', cookie).send({ code: lastCode() });
    expect(verify.status).toBe(200);
    expect(verify.body.next).toBe('app');
    expect((await http().get('/auth/sessions').set('Cookie', cookieOf(verify))).status).toBe(200);
  });

  it('the app method sends nothing at the challenge', async () => {
    Object.assign(stored('sara'), { twoFactorEnabled: true, twoFactorMethod: 'app', twoFactorSecret: 'JBSWY3DPEHPK3PXP' });
    const cookie = cookieOf(await login('sara'));
    const send = await http().post('/auth/two-factor/send').set('Cookie', cookie);
    expect(send.body).toEqual({ method: 'app' });
    expect(sent).toHaveLength(0);
  });

  it('enrols by email when the layer requires two-factor, then the session is full', async () => {
    await store.setPolicy('pos', true);
    // A required layer enrols with its own method only (spec 2026-11-11-two-factor-policy).
    await store.setLayerMethod('pos', 'email');
    const enrol = await login('seller');
    expect(enrol.body.next).toBe('two_factor_enroll');
    const cookie = cookieOf(enrol);
    await http().post('/auth/two-factor/method').set('Cookie', cookie).send({ method: 'email' });
    const confirm = await http().post('/auth/two-factor/method/confirm').set('Cookie', cookie).send({ method: 'email', code: lastCode() });
    expect(confirm.status).toBe(200);
    expect((await http().get('/auth/sign-in-methods').set('Cookie', cookieOf(confirm))).body).toMatchObject({ twoFactorMethod: 'email', canDisable: false });
  });

  it('a password-only session of an account with two-factor on may not switch the method', async () => {
    Object.assign(stored('sara'), { twoFactorEnabled: true, twoFactorMethod: 'sms' });
    const cookie = cookieOf(await login('sara'));
    expect((await http().post('/auth/two-factor/method').set('Cookie', cookie).send({ method: 'email' })).status).toBe(403);
  });

  it('adds a passkey, signs in with it on its door, and spends each challenge once', async () => {
    const cookie = await fullCookie('sara');
    expect((await http().post('/auth/passkeys/options').set('Cookie', cookie)).status).toBe(400);
    expect((await http().post('/auth/passkeys').set('Cookie', cookie).send({ response: { id: 'x' } })).body.code).toBe('CODE_EXPIRED');

    const options = await http().post('/auth/passkeys/options').set('Cookie', cookie).set('Origin', ORIGIN);
    expect(options.status).toBe(200);
    expect(options.body.rp).toEqual({ name: 'SmileSim', id: 'localhost' });
    expect(options.body.authenticatorSelection.residentKey).toBe('required');
    const added = await http().post('/auth/passkeys').set('Cookie', cookie).send({ response: { id: 'cred-1', response: {} }, name: 'Laptop' });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ name: 'Laptop', lastUsedAt: null });
    expect((await http().get('/auth/passkeys').set('Cookie', cookie)).body.passkeys).toHaveLength(1);

    const begin = await http().post('/auth/passkey-login/options').set('Origin', ORIGIN);
    expect(begin.status).toBe(200);
    expect(begin.body.options.rpId).toBe('localhost');
    const signIn = await http().post('/auth/passkey-login').set('Origin', ORIGIN).send({ loginId: begin.body.loginId, response: { id: 'cred-1' } });
    expect(signIn.status).toBe(200);
    expect(signIn.body.next).toBe('app');
    expect((await http().get('/auth/sessions').set('Cookie', cookieOf(signIn))).status).toBe(200);
    expect(store.passkeys[0]).toMatchObject({ counter: 7 });
    expect(store.passkeys[0].lastUsedAt).not.toBeNull();

    const replay = await http().post('/auth/passkey-login').set('Origin', ORIGIN).send({ loginId: begin.body.loginId, response: { id: 'cred-1' } });
    expect(replay.body.code).toBe('CODE_EXPIRED');
  });

  it('a passkey skips the second step but keeps the door and a disabled account shut', async () => {
    Object.assign(stored('sara'), { twoFactorEnabled: true, twoFactorMethod: 'sms' });
    await store.addPasskey({ userId: 'sara', credentialId: 'cred-9', publicKey: new Uint8Array([9]), counter: 0, transports: [], name: 'Phone' });
    const signIn = async (origin: string) => {
      const begin = await http().post('/auth/passkey-login/options').set('Origin', origin);
      return http().post('/auth/passkey-login').set('Origin', origin).send({ loginId: begin.body.loginId, response: { id: 'cred-9' } });
    };
    expect((await signIn(ORIGIN)).body.next).toBe('app');
    expect((await signIn('http://pos.localhost:3000')).body.code).toBe('DOOR_MISMATCH');
    stored('sara').disabledAt = new Date();
    expect((await signIn(ORIGIN)).body.code).toBe('ACCOUNT_DISABLED');
  });

  it('refuses a passkey the authenticator does not prove, and an unknown one', async () => {
    await store.addPasskey({ userId: 'sara', credentialId: 'cred-9', publicKey: new Uint8Array([9]), counter: 0, transports: [], name: 'Phone' });
    webauthn.verifyAuthenticationResponse.mockResolvedValueOnce({ verified: false, authenticationInfo: { newCounter: 0 } });
    let begin = await http().post('/auth/passkey-login/options').set('Origin', ORIGIN);
    expect((await http().post('/auth/passkey-login').set('Origin', ORIGIN).send({ loginId: begin.body.loginId, response: { id: 'cred-9' } })).body.code).toBe('PASSKEY_FAILED');
    begin = await http().post('/auth/passkey-login/options').set('Origin', ORIGIN);
    expect((await http().post('/auth/passkey-login').set('Origin', ORIGIN).send({ loginId: begin.body.loginId, response: { id: 'nope' } })).body.code).toBe('PASSKEY_FAILED');
  });

  it('deletes only the account’s own passkeys', async () => {
    const mine = await store.addPasskey({ userId: 'sara', credentialId: 'a', publicKey: new Uint8Array([1]), counter: 0, transports: [], name: 'A' });
    const theirs = await store.addPasskey({ userId: 'bare', credentialId: 'b', publicKey: new Uint8Array([1]), counter: 0, transports: [], name: 'B' });
    const cookie = await fullCookie('sara');
    expect((await http().delete(`/auth/passkeys/${theirs.id}`).set('Cookie', cookie)).status).toBe(404);
    expect((await http().delete(`/auth/passkeys/${mine.id}`).set('Cookie', cookie)).status).toBe(200);
    expect(store.passkeys.map((row) => row.id)).toEqual([theirs.id]);
  });

  it('takes the relying party from the page origin, or from WEBAUTHN_RP_ID', () => {
    expect(relyingParty('http://pos.localhost:3000', {})?.rpID).toBe('localhost');
    expect(relyingParty('http://localhost:3000', {})?.rpID).toBe('localhost');
    expect(relyingParty('http://evil.example:3000', {})).toBeNull();
    expect(relyingParty(undefined, {})).toBeNull();
    expect(relyingParty(ORIGIN, { WEBAUTHN_RP_ID: 'smilesim.test' })?.rpID).toBe('smilesim.test');
  });
});
