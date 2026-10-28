import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth.module';

// No AUTH_STORE override here: this is the store a booted server really gets.
describe('AuthModule boot without a store override', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lets the trial POS log in with 123456', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ loginName: 'pos', password: '123456' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ next: 'app' });
  });

  it('loads all four trial accounts, with only branch owning the branch', async () => {
    const agent = request.agent(app.getHttpServer());
    for (const loginName of ['branch', 'main', 'agent', 'pos']) {
      const response = await request(app.getHttpServer()).post('/auth/login').send({ loginName, password: '123456' });
      expect(response.body).toEqual({ next: 'app' });
    }
    // only the branch owner may open owner endpoints
    const login = await agent.post('/auth/login').send({ loginName: 'main', password: '123456' });
    expect(login.status).toBe(200);
    const denied = await agent.patch('/auth/exemptions/pos').send({ exempt: false });
    expect(denied.status).toBe(403);
    const owner = request.agent(app.getHttpServer());
    await owner.post('/auth/login').send({ loginName: 'branch', password: '123456' });
    const allowed = await owner.patch('/auth/exemptions/pos').send({ exempt: true });
    expect(allowed.status).toBe(200);
  });
});
