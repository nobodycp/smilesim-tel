import 'reflect-metadata';
import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { API_PROVIDERS } from './api-providers';
import { fail } from './api-failure';

// Review 2026-11-10, A2: every error answers `{ message, code }`, whatever threw it, and a write with no body
// reaches its handler as `{}`.
@Controller('probe')
class ProbeController {
  @Get('refusal')
  refusal() {
    fail(403, 'FORBIDDEN');
  }

  @Get('bug')
  bug() {
    throw new TypeError("Cannot read properties of undefined (reading 'secret')");
  }

  @Get('conflict')
  conflict() {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }

  @Get('gone')
  gone() {
    throw Object.assign(new Error('Record not found'), { code: 'P2025' });
  }

  @Post('echo')
  echo(@Body() body: Record<string, unknown>) {
    return { keys: Object.keys(body) };
  }
}

describe('ApiExceptionFilter and EmptyBodyPipe', () => {
  let app: INestApplication;
  const get = (path: string) => request(app.getHttpServer()).get(path);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController], providers: API_PROVIDERS }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a refusal with its status and code', async () => {
    const response = await get('/probe/refusal');
    expect([response.status, response.body]).toEqual([403, { message: 'غير مسموح', code: 'FORBIDDEN' }]);
  });

  it('answers an unknown route as NOT_FOUND', async () => {
    const response = await get('/nowhere');
    expect([response.status, response.body]).toEqual([404, { message: 'غير موجود', code: 'NOT_FOUND' }]);
  });

  it('answers malformed JSON as INVALID', async () => {
    const response = await request(app.getHttpServer()).post('/probe/echo').set('content-type', 'application/json').send('{"broken"');
    expect([response.status, response.body.code]).toEqual([400, 'INVALID']);
  });

  it('answers a bug as SERVER_ERROR and tells the client nothing about it', async () => {
    const response = await get('/probe/bug');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'حدث خطأ في الخادم. أعد المحاولة', code: 'SERVER_ERROR' });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('answers a lost race on a unique column as a conflict, and a missing row as NOT_FOUND', async () => {
    expect((await get('/probe/conflict')).status).toBe(409);
    expect([(await get('/probe/gone')).status, (await get('/probe/gone')).body.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('hands a handler `{}` when a write carries no body', async () => {
    const response = await request(app.getHttpServer()).post('/probe/echo');
    expect([response.status, response.body]).toEqual([201, { keys: [] }]);
  });
});
