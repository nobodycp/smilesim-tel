import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActivityRecorder } from '../shared/activity';
import { AuthModule } from './auth.module';
import { ActivityModule } from '../auditing/activity.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MemoryAuthStore } from './testing/memory-auth.store';

// Review 2026-11-10, A6: the owner's writes on session rules and contact details are in the activity log, the
// refused ones too.
describe('owner writes in /auth are recorded', () => {
  let app: INestApplication;
  let owner: string;
  let agent: string;
  const recorded: { action: string; subjectKind?: string; subjectRef?: string; result: string; reason: string }[] = [];

  const user = (overrides: Partial<StoredUser> & { loginName: string }): StoredUser => ({
    id: overrides.loginName, nickname: overrides.loginName, disabledAt: null, mustChangePassword: false, layer: 'pos',
    twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x', ...overrides,
  });
  const patch = (cookie: string, path: string, body: object) => request(app.getHttpServer()).patch(path).set('Cookie', cookie).send(body);

  beforeEach(async () => {
    recorded.length = 0;
    const store = new MemoryAuthStore();
    store.addUser(user({ loginName: 'owner', layer: 'branch', isBranchOwner: true }));
    store.addUser(user({ loginName: 'agent1', layer: 'agent' }));
    store.addUser(user({ loginName: 'seller' }));
    const moduleRef = await Test.createTestingModule({ imports: [ActivityModule, AuthModule] })
      .overrideProvider(AUTH_STORE).useValue(store)
      .overrideProvider(ActivityRecorder)
      .useValue({ recordOffice: async (_gate: unknown, _ip: string, event: { action: string; subjectKind?: string; subjectRef?: string }, result: string, reason: string) => void recorded.push({ ...event, result, reason }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    owner = `sid=${await store.saveSession({ userId: 'owner', scope: 'full', userAgent: '', ip: '' })}`;
    agent = `sid=${await store.saveSession({ userId: 'agent1', scope: 'full', userAgent: '', ip: '' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('records the session rules of a layer and of an account', async () => {
    await patch(owner, '/auth/session-rules/pos', { maxSessions: 2, sessionMinutes: 60 });
    await patch(owner, '/auth/users/seller/session-rules', { maxSessions: 1, sessionMinutes: null });
    expect(recorded).toEqual([
      { action: 'session_rules', subjectKind: 'layer', subjectRef: 'pos', result: 'ok', reason: '' },
      { action: 'session_rules', subjectKind: 'account', subjectRef: 'seller', result: 'ok', reason: '' },
    ]);
  });

  it('records a change of contact details, and a refused one with its code', async () => {
    await patch(owner, '/auth/users/seller/contact', { email: 'shop@example.com', phone: '' });
    await patch(agent, '/auth/users/seller/contact', { email: 'x@example.com', phone: '' });
    expect(recorded).toEqual([
      { action: 'user_contact', subjectKind: 'account', subjectRef: 'seller', result: 'ok', reason: '' },
      { action: 'user_contact', subjectKind: 'account', subjectRef: 'seller', result: 'fail', reason: 'FORBIDDEN' },
    ]);
  });
});
