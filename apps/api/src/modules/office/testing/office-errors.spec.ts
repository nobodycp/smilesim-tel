import { UnitOfWork } from '../kernel/unit-of-work';
import 'reflect-metadata';
import { API_PROVIDERS } from '../../shared/api-providers';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../../auth/auth.module';
import { AUTH_STORE } from '../../auth/auth.store';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { hashOnce } from './test-hash';
import { OFFICE_CONTROLLERS, OFFICE_PROVIDERS } from '../office.module';
import { OfficeFailure } from '../../shared/office-failure';

// A refusal from any office route carries `{ message, code }`. The Arabic message is the one the
// web app has always shown; the code is what it now routes and translates on.

describe('office refusals', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;
  // The routes read the kernel's client; the specs swap in in-memory tables there.
  let kernel: UnitOfWork;
  let posSession: string;

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser({
      id: 'pos1',
      loginName: 'pos1',
      nickname: 'نقطة',
      disabledAt: null,
      mustChangePassword: false,
      layer: 'pos',
      twoFactorExempt: true,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashOnce('123456'),
    });
    posSession = await store.saveSession({ userId: 'pos1', scope: 'full', userAgent: '', ip: '' });
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      // Every office route, whichever controller holds it.
      controllers: OFFICE_CONTROLLERS,
      providers: [...OFFICE_PROVIDERS, ...API_PROVIDERS],
    })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    kernel = moduleRef.get(UnitOfWork);
    (kernel as unknown as { prismaClient: unknown }).prismaClient = {
      user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: false }), findMany: async () => [] },
    };
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 401 LOGIN_REQUIRED without a session', async () => {
    const response = await request(app.getHttpServer()).get('/office/me');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'يلزم تسجيل الدخول', code: 'LOGIN_REQUIRED' });
  });

  it('answers 403 FORBIDDEN when a point of sale adds a company', async () => {
    const response = await request(app.getHttpServer())
      .post('/office/companies')
      .set('Cookie', `sid=${posSession}`)
      .send({ providerCode: 'sky', companyCode: 'golan' });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'غير مسموح', code: 'FORBIDDEN' });
  });

  it('answers 404 NOT_FOUND for a report kind it does not have', async () => {
    store.addUser({
      id: 'admin',
      loginName: 'admin',
      nickname: 'الإدارة',
      disabledAt: null,
      mustChangePassword: false,
      layer: 'branch',
      twoFactorExempt: true,
      twoFactorEnabled: false,
      isBranchOwner: true,
      passwordHash: await hashOnce('ownerpass1'),
    });
    const admin = await store.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
    (kernel as unknown as { prismaClient: unknown }).prismaClient = {
      user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: true }), findMany: async () => [] },
    };
    const response = await request(app.getHttpServer()).get('/office/reports/nothing').set('Cookie', `sid=${admin}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'غير موجود', code: 'NOT_FOUND' });
  });

  it('builds the failure message from the code', () => {
    const failure = new OfficeFailure(400, 'BALANCE_CEILING');
    expect(failure.status).toBe(400);
    expect(failure.code).toBe('BALANCE_CEILING');
    expect(failure.message).toBe('الرصيد لا يكفي ضمن السقف');
  });
});
