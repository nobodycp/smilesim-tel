import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActivityRecorder } from '../platform/activity';
import { AuthModule } from './auth.module';
import { ActivityModule } from '../auditing/activity.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MemoryAuthStore } from './testing/memory-auth.store';
import { hashOnce } from '../testing/test-hash';

// Slice R.A: the two writes an account makes on itself that left no record (plan office-retirement, R.0 table):
// changing its profile and turning its own second step off. Each is recorded, the refused ones too, with the
// action and the account only: never a password, a field's value or a code.
describe('an account’s own writes in /auth are recorded, and the record holds no secret', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;
  let seller: string;
  const recorded: { gate: unknown; event: { action: string; subjectKind?: string; subjectRef?: string }; result: string; reason: string }[] = [];

  const user = (overrides: Partial<StoredUser> & { loginName: string }): StoredUser => ({
    id: overrides.loginName, nickname: overrides.loginName, disabledAt: null, mustChangePassword: false, layer: 'pos',
    twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x', ...overrides,
  });

  beforeEach(async () => {
    recorded.length = 0;
    store = new MemoryAuthStore();
    store.addUser(user({ loginName: 'seller', passwordHash: await hashOnce('Current-Pass-123') }));
    const moduleRef = await Test.createTestingModule({ imports: [ActivityModule, AuthModule] })
      .overrideProvider(AUTH_STORE).useValue(store)
      .overrideProvider(ActivityRecorder)
      .useValue({ record: async (gate: unknown, _ip: string, event: { action: string }, result: string, reason: string) => void recorded.push({ gate, event, result, reason }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    seller = `sid=${await store.saveSession({ userId: 'seller', scope: 'full', userAgent: '', ip: '' })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('a change of contact fields is recorded as the account’s contact, without the values', async () => {
    const answer = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', seller).send({ email: 'shop-r-a@example.com', phone: '0521234567', currentPassword: 'Current-Pass-123' });
    expect(answer.status).toBe(200);
    expect(recorded.map(({ event, result, reason }) => ({ event, result, reason }))).toEqual([{ event: { action: 'user_contact' }, result: 'ok', reason: '' }]);
    // The account is named by its session, as every record of the log names it.
    expect(recorded[0].gate).toEqual({ sessionId: seller.slice('sid='.length) });
    expect(JSON.stringify(recorded)).not.toMatch(/shop-r-a|0521234567|Current-Pass-123/);
  });

  it('a password change through the profile is recorded as a password change, refused or not, without either password', async () => {
    const answer = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', seller).send({ currentPassword: 'Wrong-Current-9', nextPassword: 'Next-Secret-Pass-7' });
    expect([answer.status, answer.body.code]).toEqual([401, 'WRONG_CURRENT_PASSWORD']);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].event).toEqual({ action: 'password' });
    expect(recorded[0].result).toBe('fail');
    expect(recorded[0].reason).toBe(answer.body.code);
    expect(JSON.stringify(recorded)).not.toMatch(/Wrong-Current-9|Next-Secret-Pass-7/);
  });

  it('a refused passkey removal is recorded like every other refusal, and a wrong current password on a hand-made hash is a refusal, not a crash', async () => {
    const removal = await request(app.getHttpServer()).delete('/auth/passkeys/no-such-passkey').set('Cookie', seller);
    expect(removal.status).toBeGreaterThanOrEqual(400);
    expect(recorded.map(({ event, result, reason }) => ({ event, result, reason }))).toEqual([{ event: { action: 'passkey_remove' }, result: 'fail', reason: removal.body.code }]);
    store.addUser(user({ loginName: 'handmade', passwordHash: 'x' }));
    const handmade = `sid=${await store.saveSession({ userId: 'handmade', scope: 'full', userAgent: '', ip: '' })}`;
    const change = await request(app.getHttpServer()).patch('/auth/profile').set('Cookie', handmade).send({ currentPassword: 'anything-1234', nextPassword: 'Next-Secret-Pass-7' });
    expect([change.status, change.body.code]).toEqual([401, 'WRONG_CURRENT_PASSWORD']);
  });

  it('turning the account’s own second step off is recorded under two_factor; a request with no session is refused and records nothing', async () => {
    await request(app.getHttpServer()).delete('/auth/two-factor').set('Cookie', seller);
    const anonymous = await request(app.getHttpServer()).delete('/auth/two-factor');
    const anonymousProfile = await request(app.getHttpServer()).patch('/auth/profile').send({ email: 'x@example.com' });
    expect([anonymous.status, anonymousProfile.status]).toEqual([401, 401]);
    // An anonymous call names no account: recording it would let anyone add rows without signing in.
    expect(recorded.map(({ event }) => event)).toEqual([{ action: 'two_factor' }]);
  });
});
