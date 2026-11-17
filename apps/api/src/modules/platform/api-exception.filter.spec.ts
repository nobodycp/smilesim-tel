import 'reflect-metadata';
import { Body, Controller, Get, INestApplication, Logger, Post, Query } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { API_PROVIDERS } from './api-providers';
import { fail } from './api-failure';
import { ServerErrorRecorder, type ServerErrorDraft } from './server-errors';

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

  @Post('crash')
  crash(@Body() body: Record<string, unknown>, @Query() query: Record<string, unknown>) {
    // A bug whose words quote the request: what the log must never print in production.
    throw new Error(`could not save ${JSON.stringify(body)} for token ${String(query.token)}`);
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
    expect([response.status, response.body]).toEqual([403, { message: 'ليست لديك صلاحية لهذا الإجراء', code: 'FORBIDDEN' }]);
  });

  it('answers an unknown route as NOT_FOUND', async () => {
    const response = await get('/nowhere');
    expect([response.status, response.body]).toEqual([404, { message: 'العنصر المطلوب غير موجود', code: 'NOT_FOUND' }]);
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

describe('ApiExceptionFilter keeps a server error through the platform\'s port (system monitor M.4)', () => {
  let app: INestApplication;
  const recorded: ServerErrorDraft[] = [];
  let recorder: (draft: ServerErrorDraft) => void = (draft) => void recorded.push(draft);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [...API_PROVIDERS, { provide: ServerErrorRecorder, useValue: { record: (draft: ServerErrorDraft) => recorder(draft) } }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // As the request log's middleware does: the answer carries its request id before the handler runs.
    app.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
      res.setHeader('X-Request-Id', 'req-1');
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    recorded.length = 0;
    recorder = (draft) => void recorded.push(draft);
  });

  it('a 5xx is recorded with its request id, route, class, a code and frames; the message is not', async () => {
    await request(app.getHttpServer()).get('/probe/bug').expect(500);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ requestId: 'req-1', method: 'GET', route: '/probe/bug', name: 'TypeError', message: 'unclassified' });
    expect(recorded[0].frames.length).toBeGreaterThan(0);
    expect(JSON.stringify(recorded[0])).not.toContain('secret');
  });

  it('a refusal, a conflict or a miss is not a server error', async () => {
    await request(app.getHttpServer()).get('/probe/refusal').expect(403);
    await request(app.getHttpServer()).get('/probe/conflict').expect(409);
    await request(app.getHttpServer()).get('/probe/gone').expect(404);
    await request(app.getHttpServer()).get('/probe/nowhere').expect(404);
    expect(recorded).toEqual([]);
  });

  it('a recorder that throws does not change the answer', async () => {
    recorder = () => {
      throw new Error('the port is broken');
    };
    const answer = await request(app.getHttpServer()).get('/probe/bug');
    expect([answer.status, answer.body.code]).toEqual([500, 'SERVER_ERROR']);
  });
});

describe('ApiExceptionFilter logs a 5xx as errorReport keeps it, with its request id, method and route (system monitor M.10)', () => {
  const SECRET = 'hunter2-s3cr3t-9f1c';
  let app: INestApplication;
  let logged: string[] = [];
  const previousEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController], providers: API_PROVIDERS }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
      res.setHeader('X-Request-Id', 'req-42');
      next();
    });
    await app.init();
  });

  beforeEach(() => {
    logged = [];
    for (const level of ['error', 'warn', 'log', 'debug', 'verbose', 'fatal'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.NODE_ENV = previousEnv;
  });

  afterAll(async () => {
    await app.close();
  });

  const crash = () => request(app.getHttpServer()).post(`/probe/crash?token=${SECRET}`).set('content-type', 'application/json').send({ password: SECRET, note: SECRET }).expect(500);

  it('in production: one entry, the status, method, route, request id, class, a code and frames, and none of the secret', async () => {
    process.env.NODE_ENV = 'production';
    await crash();
    expect(logged).toHaveLength(1);
    const [entry] = logged;
    expect(entry.split('\n')[0]).toBe('500 POST /probe/crash request req-42: Error unclassified');
    expect(entry.split('\n').slice(1).length).toBeGreaterThan(0);
    for (const line of entry.split('\n').slice(1)) expect(line).toMatch(/^ {4}at \S/);
    expect(logged.join('\n')).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain('token');
  });

  it('under the specs (NODE_ENV=test) the same, and nothing raw', async () => {
    process.env.NODE_ENV = 'test';
    await crash();
    expect(logged).toHaveLength(1);
    expect(logged.join('\n')).not.toContain(SECRET);
  });

  it('in a developer\'s own run (NODE_ENV neither production nor test) the raw stack follows, marked, after the same entry', async () => {
    process.env.NODE_ENV = 'development';
    await crash();
    expect(logged).toHaveLength(2);
    expect(logged[0]).not.toContain(SECRET);
    expect(logged[1]).toMatch(/^request req-42, raw \(never logged in production\): Error: could not save/);
    expect(logged[1]).toContain(SECRET);
  });
});
