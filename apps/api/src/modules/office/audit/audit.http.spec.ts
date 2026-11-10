import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { officeTestApp } from '../testing/office-test-app';

// The activity log route over HTTP, written before it left office.controller.ts.
describe('GET /office/audit', () => {
  let app: INestApplication;
  let session: string;
  let asked: { where: Record<string, unknown> }[];

  beforeEach(async () => {
    asked = [];
    const store = new MemoryAuthStore();
    store.addUser({
      id: 'admin', loginName: 'admin', nickname: 'الإدارة', disabledAt: null, mustChangePassword: false, layer: 'branch',
      twoFactorExempt: true, twoFactorEnabled: false, isBranchOwner: true, passwordHash: 'x',
    });
    session = await store.saveSession({ userId: 'admin', scope: 'full', userAgent: '', ip: '' });
    const event = { id: 'ev1', at: new Date('2026-11-08T10:00:00.000Z'), action: 'fund', result: 'fail', reason: 'FORBIDDEN', ip: '1.2.3.4', actorLogin: 'pos1', actorLayer: 'pos', subjectKind: 'account', subjectRef: 'ag1' };
    const tables = {
      user: {
        findUnique: async () => ({ liveGrants: '', isBranchOwner: true }),
        findMany: async () => [{ id: 'admin', loginName: 'admin', nickname: 'الإدارة', layer: 'branch', parentId: null, deniedOps: '', disabledAt: null }],
      },
      activityEvent: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          asked.push(args);
          return [event];
        },
        count: async () => 1,
      },
    };
    ({ app } = await officeTestApp(store, tables));
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers the page of events and passes every filter to the query', async () => {
    const response = await request(app.getHttpServer())
      .get('/office/audit?action=fund&result=fail&layer=pos&q=%20ag1%20&from=2026-11-01&to=2026-11-08')
      .set('Cookie', `sid=${session}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 1,
      items: [{ id: 'ev1', at: '2026-11-08T10:00:00.000Z', action: 'fund', result: 'fail', reason: 'FORBIDDEN', ip: '1.2.3.4', actorLogin: 'pos1', actorLayer: 'pos', subjectKind: 'account', subjectRef: 'ag1' }],
      nextCursor: null,
    });
    expect(asked[0].where).toMatchObject({
      action: 'fund',
      result: 'fail',
      actorLayer: 'pos',
      OR: [{ actorLogin: { contains: 'ag1', mode: 'insensitive' } }, { subjectRef: { contains: 'ag1', mode: 'insensitive' } }],
      // The end of the range is capped at now (clampActivityRange).
      at: { gte: new Date('2026-11-01T00:00:00.000Z'), lte: expect.any(Date) },
    });
  });

  it('ignores a result filter that is neither ok nor fail', async () => {
    await request(app.getHttpServer()).get('/office/audit?result=maybe').set('Cookie', `sid=${session}`);
    expect(asked[0].where).not.toHaveProperty('result');
  });

  it('answers 401 without a session and 400 for a cursor it did not issue', async () => {
    const anonymous = await request(app.getHttpServer()).get('/office/audit');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'LOGIN_REQUIRED' });
    const foreign = await request(app.getHttpServer()).get('/office/audit?cursor=nope').set('Cookie', `sid=${session}`);
    expect(foreign.status).toBe(400);
    expect(foreign.body).toMatchObject({ code: 'INVALID' });
  });
});
