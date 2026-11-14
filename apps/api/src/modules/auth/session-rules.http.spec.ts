import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { ActivityModule } from '../auditing/activity.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MemoryAuthStore } from './testing/memory-auth.store';
import { hashPassword } from './password';
import { effectiveRules } from './sessions';

// Session rules (spec 2026-11-08-session-rules): sessions allowed and idle time, per layer and per account.

describe('session rules', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;

  async function user(overrides: Partial<StoredUser> & { loginName: string }): Promise<StoredUser> {
    return {
      id: overrides.loginName,
      disabledAt: null,
      mustChangePassword: false,
      layer: 'pos',
      twoFactorExempt: true,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashPassword('password12'),
      ...overrides,
    };
  }

  const http = () => request(app.getHttpServer());
  const login = (loginName: string) => http().post('/auth/login').send({ loginName, password: 'password12' });
  const live = (loginName: string) => store.sessions.filter((s) => s.userId === loginName && s.scope === 'full' && !s.revokedAt);
  let owner: string;

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'owner', layer: 'branch', isBranchOwner: true }));
    store.addUser(await user({ loginName: 'seller' }));
    store.addUser(await user({ loginName: 'agent1', layer: 'agent' }));
    const moduleRef = await Test.createTestingModule({ imports: [ActivityModule, AuthModule] }).overrideProvider(AUTH_STORE).useValue(store).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    owner = `sid=${await store.saveSession({ userId: 'owner', scope: 'full', userAgent: '', ip: '' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('account beats layer beats default (3 sessions, 6 hours)', () => {
    expect(effectiveRules(null, null)).toEqual({ maxSessions: 3, idleSeconds: 6 * 3600 });
    expect(effectiveRules({ maxSessions: null, sessionMinutes: null }, { maxSessions: 5, sessionMinutes: 60 })).toEqual({ maxSessions: 5, idleSeconds: 3600 });
    expect(effectiveRules({ maxSessions: 1, sessionMinutes: null }, { maxSessions: 5, sessionMinutes: 60 })).toEqual({ maxSessions: 1, idleSeconds: 3600 });
  });

  it('a new session lives six hours from its last request by default', async () => {
    await login('seller');
    const [session] = live('seller');
    const ttl = session.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(6 * 3600_000 - 5000);
    expect(ttl).toBeLessThanOrEqual(6 * 3600_000);
  });

  it('the owner sets a layer: its accounts get that idle time and session count', async () => {
    const set = await http().patch('/auth/session-rules/pos').set('Cookie', owner).send({ maxSessions: 1, sessionMinutes: 30 });
    expect(set.status).toBe(200);
    expect(set.body.layers.pos).toEqual({ maxSessions: 1, sessionMinutes: 30 });
    const view = await http().get('/auth/session-rules').set('Cookie', owner);
    expect(view.body.defaults).toEqual({ maxSessions: 3, sessionMinutes: 360 });

    await login('seller');
    await login('seller');
    expect(live('seller')).toHaveLength(1);
    expect(live('seller')[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    // Other layers keep the default.
    for (let index = 0; index < 4; index += 1) await login('agent1');
    expect(live('agent1')).toHaveLength(3);
  });

  it('an account value beats its layer, and null follows the layer again', async () => {
    await http().patch('/auth/session-rules/pos').set('Cookie', owner).send({ maxSessions: 1, sessionMinutes: 30 });
    const own = await http().patch('/auth/users/seller/session-rules').set('Cookie', owner).send({ maxSessions: 2, sessionMinutes: null });
    expect(own.body).toEqual({
      own: { maxSessions: 2, sessionMinutes: null },
      layer: { maxSessions: 1, sessionMinutes: 30 },
      effective: { maxSessions: 2, sessionMinutes: 30 },
    });
    for (let index = 0; index < 3; index += 1) await login('seller');
    expect(live('seller')).toHaveLength(2);
    const back = await http().patch('/auth/users/seller/session-rules').set('Cookie', owner).send({ maxSessions: null, sessionMinutes: null });
    expect(back.body.effective).toEqual({ maxSessions: 1, sessionMinutes: 30 });
    expect((await http().get('/auth/users/seller/session-rules').set('Cookie', owner)).body.own).toEqual({ maxSessions: null, sessionMinutes: null });
  });

  it('a session idle longer than a lowered idle time is closed at its next request; activity keeps it open', async () => {
    const cookie = `sid=${(await login('seller')).headers['set-cookie'][0].split(';')[0].slice(4)}`;
    const [session] = live('seller');
    session.lastSeenAt = new Date(Date.now() - 20 * 60_000);
    expect((await http().get('/auth/sessions').set('Cookie', cookie)).status).toBe(200);
    // Active a moment ago: still open under a 15-minute rule.
    await http().patch('/auth/users/seller/session-rules').set('Cookie', owner).send({ maxSessions: null, sessionMinutes: 15 });
    expect((await http().get('/auth/sessions').set('Cookie', cookie)).status).toBe(200);
    // Idle 20 minutes: closed.
    session.lastSeenAt = new Date(Date.now() - 20 * 60_000);
    expect((await http().get('/auth/sessions').set('Cookie', cookie)).status).toBe(401);
  });

  it('only the branch owner reads or changes the rules, and values stay in range', async () => {
    const seller = `sid=${await store.saveSession({ userId: 'seller', scope: 'full', userAgent: '', ip: '' })}`;
    expect((await http().get('/auth/session-rules').set('Cookie', seller)).status).toBe(403);
    expect((await http().patch('/auth/users/seller/session-rules').set('Cookie', seller).send({ maxSessions: 9, sessionMinutes: null })).status).toBe(403);
    for (const body of [{ maxSessions: 0, sessionMinutes: null }, { maxSessions: 11, sessionMinutes: null }, { maxSessions: null, sessionMinutes: 5 }, { maxSessions: 2.5, sessionMinutes: null }, { maxSessions: null }]) {
      expect((await http().patch('/auth/session-rules/pos').set('Cookie', owner).send(body)).status).toBe(400);
    }
    expect((await http().patch('/auth/session-rules/nobody').set('Cookie', owner).send({ maxSessions: 2, sessionMinutes: null })).status).toBe(400);
    expect((await http().get('/auth/users/ghost/session-rules').set('Cookie', owner)).status).toBe(404);
  });
});
