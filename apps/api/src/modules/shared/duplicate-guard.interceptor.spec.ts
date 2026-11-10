import 'reflect-metadata';
import { API_PROVIDERS } from './api-providers';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AUTH_STORE } from '../auth/auth.store';
import { MemoryAuthStore } from '../auth/testing/memory-auth.store';
import { ActivityRecorder } from '../office/activity/activity-recorder';
import { OfficeKernel } from '../office/kernel/office-kernel';
import { OFFICE_CONTROLLERS, OFFICE_PROVIDERS } from '../office/office.module';
import { DuplicateGuardInterceptor, SAME_WRITE_SECONDS, memoryWrites } from './duplicate-guard.interceptor';

// A write sent twice runs once (spec 2026-11-08-duplicate-writes): the repeat gets the first answer, a repeat while the
// first still runs is refused, a failure can be sent again, and reads and other sessions are untouched.
describe('DuplicateGuardInterceptor over HTTP', () => {
  let app: INestApplication;
  let guard: DuplicateGuardInterceptor;
  let clock = 1_000_000;
  let updates = 0;
  let hold: Promise<void> | null = null;
  const sessions: Record<string, string> = {};

  beforeAll(async () => {
    const store = new MemoryAuthStore();
    for (const id of ['u1', 'u2']) {
      store.addUser({ id, loginName: id, nickname: id, disabledAt: null, mustChangePassword: false, layer: 'pos', twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x' });
      sessions[id] = await store.saveSession({ userId: id, scope: 'full', userAgent: '', ip: '' });
    }
    const moduleRef = await Test.createTestingModule({
      controllers: OFFICE_CONTROLLERS,
      providers: [
        ...OFFICE_PROVIDERS,
        ...API_PROVIDERS,
        { provide: AUTH_STORE, useValue: store },
        { provide: ActivityRecorder, useValue: { recordOffice: async () => undefined } },
      ],
    }).compile();
    moduleRef.get(OfficeKernel).prismaClient = {
      user: { findUnique: async () => ({ id: 'u1', liveGrants: 'read' }) },
      notice: {
        updateMany: async () => {
          updates += 1;
          if (hold) await hold;
          return { count: 1 };
        },
        count: async () => 0,
        findMany: async () => [],
      },
    } as unknown as OfficeKernel['prismaClient'];
    app = moduleRef.createNestApplication();
    // Global, as OfficeModule registers it (APP_INTERCEPTOR): it runs before each controller's own interceptors.
    guard = new DuplicateGuardInterceptor();
    app.useGlobalInterceptors(guard);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    updates = 0;
    hold = null;
    clock += 60_000;
    guard.store = memoryWrites(() => clock);
  });

  const post = (who: string, body: object, key?: string) => {
    const call = request(app.getHttpServer()).post('/office/notices/read').set('Cookie', `sid=${sessions[who]}`);
    return (key ? call.set('Idempotency-Key', key) : call).send(body);
  };

  it('runs the same write once and answers the repeat with the first answer', async () => {
    const first = await post('u1', { id: 'n1' });
    const again = await post('u1', { id: 'n1' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(updates).toBe(1);
    // Another body, another session: both run.
    await post('u1', { id: 'n2' });
    await post('u2', { id: 'n1' });
    expect(updates).toBe(3);
    // After the window the same write runs again.
    clock += (SAME_WRITE_SECONDS + 1) * 1000;
    await post('u1', { id: 'n1' });
    expect(updates).toBe(4);
  });

  it('refuses a repeat while the first is still running', async () => {
    let release = () => undefined as void;
    hold = new Promise<void>((resolve) => { release = resolve; });
    const first = post('u1', { id: 'slow' }).then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = await post('u1', { id: 'slow' });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'DUPLICATE_REQUEST' });
    release();
    expect((await first).status).toBe(201);
    expect(updates).toBe(1);
  });

  it('runs one Idempotency-Key once and marks the repeat as a replay', async () => {
    const first = await post('u1', { id: 'a' }, 'k-1');
    const again = await post('u1', { id: 'a' }, 'k-1');
    expect(updates).toBe(1);
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(again.headers['idempotent-replay']).toBe('true');
  });

  it('refuses an Idempotency-Key reused for another request instead of answering with the first one (review 2026-11-10, M7)', async () => {
    await post('u1', { id: 'a' }, 'k-2');
    const other = await post('u1', { id: 'b' }, 'k-2');
    expect([other.status, other.body.code]).toEqual([400, 'INVALID']);
    expect(updates).toBe(1);
  });
});
