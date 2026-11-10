import { KERNEL_PROVIDERS } from './kernel.providers';
import 'reflect-metadata';
import { Body, Controller, INestApplication, Post, UseFilters, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AUTH_STORE } from '../../auth/auth.store';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { ApiExceptionFilter } from '../../shared/api-exception.filter';
import { parseInput } from '../../shared/input';
import { Activity } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { ActivityRecorder } from '../activity/activity-recorder';
import { FundBody } from '../wallets/wallets.schemas';
import { Actor, ActorInterceptor } from './actor.interceptor';
import { OfficeKernel } from './office-kernel';
import type { Actor as ActorShape } from './types';

@Controller('probe')
@UseFilters(ApiExceptionFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
class ProbeController {
  @Post('fund')
  @Activity('fund', 'account')
  fund(@Actor() actor: ActorShape, @Body({ transform: (value: unknown) => parseInput(FundBody, value) }) body: { amount: number; note: string }) {
    return { by: actor.loginName, ...body };
  }
}

// The order the facade always had: no session is 401 before a bad body is 400, and both refusals are logged.
describe('ActorInterceptor with ActivityInterceptor and a body pipe', () => {
  let app: INestApplication;
  let session: string;
  const recorded: unknown[][] = [];

  beforeEach(async () => {
    recorded.length = 0;
    const store = new MemoryAuthStore();
    store.addUser({
      id: 'pos1', loginName: 'pos1', nickname: 'نقطة', disabledAt: null, mustChangePassword: false, layer: 'pos',
      twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: false, passwordHash: 'x',
    });
    session = await store.saveSession({ userId: 'pos1', scope: 'full', userAgent: '', ip: '' });
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        ...KERNEL_PROVIDERS,
        { provide: AUTH_STORE, useValue: store },
        { provide: ActivityRecorder, useValue: { recordOffice: async (...args: unknown[]) => void recorded.push(args) } },
      ],
    }).compile();
    moduleRef.get(OfficeKernel).prismaClient = {
      user: { findUnique: async () => ({ liveGrants: '', isBranchOwner: false }) },
    } as unknown as OfficeKernel['prismaClient'];
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const results = () => recorded.map(([, , , result, reason]) => [result, reason]);

  it('answers 401 for no session even when the body is bad, and logs it', async () => {
    const response = await request(app.getHttpServer()).post('/probe/fund').send({ amount: 'bad' });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(results()).toEqual([['fail', 'LOGIN_REQUIRED']]);
  });

  it('answers 400 INVALID for a signed-in bad body, and logs it', async () => {
    const response = await request(app.getHttpServer()).post('/probe/fund').set('Cookie', `sid=${session}`).send({ amount: 0 });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID' });
    expect(results()).toEqual([['fail', 'INVALID']]);
  });

  it('hands the handler the actor and the parsed body', async () => {
    const response = await request(app.getHttpServer()).post('/probe/fund').set('Cookie', `sid=${session}`).send({ amount: 500, note: ' x ' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ by: 'pos1', amount: 500, note: 'x', reason: 'deposit' });
    expect(results()).toEqual([['ok', '']]);
  });
});
