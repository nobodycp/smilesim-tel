import { DoorMiddleware } from './door.middleware';
import { type StoredUser } from './modules/auth/auth.store';
import { MemoryAuthStore } from './modules/auth/testing/memory-auth.store';

// An entered (impersonation) session belongs on the entered account's own door: the point of sale's door lets it
// through, the admin door refuses it (spec 2026-11-08-overview-and-reports-nav, A).
describe('DoorMiddleware', () => {
  const user = (id: string, layer: StoredUser['layer'], isBranchOwner = false): StoredUser => ({
    id, loginName: id, nickname: id, disabledAt: null, mustChangePassword: false, layer,
    twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner, passwordHash: 'x',
  });

  async function setup() {
    const store = new MemoryAuthStore();
    store.addUser(user('owner', 'branch', true));
    store.addUser(user('pos1', 'pos'));
    const home = await store.saveSession({ userId: 'owner', scope: 'full', userAgent: '', ip: '' });
    const entered = await store.saveImpersonation({ userId: 'pos1', operatorId: 'owner', userAgent: '', ip: '' });
    return { middleware: new DoorMiddleware(store), home, entered };
  }

  async function run(middleware: DoorMiddleware, door: string, cookie: string, route = { method: 'GET', url: '/office/me' }) {
    const sent: { status?: number; code?: string; passed: boolean } = { passed: false };
    const res = {
      status(code: number) { sent.status = code; return this; },
      json(body: { code: string }) { sent.code = body.code; return this; },
    };
    const req = { headers: { 'x-door': door, cookie }, method: route.method, originalUrl: route.url };
    await middleware.use(req as never, res as never, () => { sent.passed = true; });
    return sent;
  }

  it('lets an entered point of sale through its own door, with the owner session kept as home', async () => {
    const { middleware, home, entered } = await setup();
    expect((await run(middleware, 'pos', `sid=${entered}; home=${home}`)).passed).toBe(true);
  });

  it('refuses an entered point of sale on the admin door', async () => {
    const { middleware, home, entered } = await setup();
    expect(await run(middleware, 'admin', `sid=${entered}; home=${home}`)).toEqual({ passed: false, status: 403, code: 'DOOR_MISMATCH' });
  });

  it('keeps the owner on the admin door and off the point-of-sale door', async () => {
    const { middleware, home } = await setup();
    expect((await run(middleware, 'admin', `sid=${home}`)).passed).toBe(true);
    expect((await run(middleware, 'pos', `sid=${home}`)).code).toBe('DOOR_MISMATCH');
  });

  // The `sid` cookie is shared by every door: the owner's session must not lock the point-of-sale door's own sign-in
  // or the handoff that opens an entered account there.
  it('lets a sign-in and the handoff through a door whatever session the browser brings', async () => {
    const { middleware, home } = await setup();
    for (const url of ['/auth/login', '/auth/passkey-login', '/auth/passkey-login/options', '/office/handoff', '/office/handoff?x=1']) {
      expect((await run(middleware, 'pos', `sid=${home}`, { method: 'POST', url })).passed).toBe(true);
    }
    expect((await run(middleware, 'pos', `sid=${home}`, { method: 'GET', url: '/auth/login' })).code).toBe('DOOR_MISMATCH');
    expect((await run(middleware, 'pos', `sid=${home}`, { method: 'POST', url: '/office/leave' })).code).toBe('DOOR_MISMATCH');
  });
});
