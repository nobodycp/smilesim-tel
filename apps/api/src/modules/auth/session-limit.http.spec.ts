import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { ActivityModule } from '../auditing/activity.module';
import { AUTH_STORE, StoredUser } from './auth.store';
import { MemoryAuthStore } from './testing/memory-auth.store';
import { hashPassword } from './password';

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const first = (Array.isArray(header) ? header[0] : header) as string;
  return first.split(';')[0];
}

describe('session limit', () => {
  let app: INestApplication;
  let store: MemoryAuthStore;

  async function user(overrides: Partial<StoredUser> & { loginName: string }, password: string): Promise<StoredUser> {
    return {
      id: overrides.loginName,
      disabledAt: null,
      mustChangePassword: false,
      layer: 'pos',
      twoFactorExempt: true,
      twoFactorEnabled: false,
      isBranchOwner: false,
      passwordHash: await hashPassword(password),
      ...overrides,
    };
  }

  const login = (loginName: string, password: string, agent?: string) => {
    const call = request(app.getHttpServer()).post('/auth/login').send({ loginName, password });
    return agent ? call.set('User-Agent', agent) : call;
  };

  beforeEach(async () => {
    store = new MemoryAuthStore();
    store.addUser(await user({ loginName: 'pos' }, '123456'));
    const moduleRef = await Test.createTestingModule({ imports: [ActivityModule, AuthModule] })
      .overrideProvider(AUTH_STORE)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('revokes the oldest live session on the fourth full login', async () => {
    for (const agent of ['one', 'two', 'three']) {
      await login('pos', '123456', agent);
    }
    const fourth = await login('pos', '123456', 'four');
    expect(fourth.status).toBe(200);
    const live = store.sessions.filter((session) => session.userId === 'pos' && session.scope === 'full' && !session.revokedAt);
    expect(live).toHaveLength(3);
    expect(live.some((session) => session.userAgent === 'one')).toBe(false);
  });

  it('returns 401 for the evicted session cookie', async () => {
    const first = await login('pos', '123456', 'one');
    for (const agent of ['two', 'three', 'four']) {
      await login('pos', '123456', agent);
    }
    const response = await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', cookieOf(first));
    expect(response.status).toBe(401);
  });
});
