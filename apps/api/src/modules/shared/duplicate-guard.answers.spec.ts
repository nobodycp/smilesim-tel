import 'reflect-metadata';
import { Body, Controller, HttpCode, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import IORedis from 'ioredis';
import request from 'supertest';
import { API_PROVIDERS } from './api-providers';
import { AwaitsFirstAnswer, DuplicateGuardInterceptor, RUNNING_SECONDS, SecretAnswer, memoryWrites, type WriteStore } from './duplicate-guard.interceptor';
import { OfficeFailure } from './office-failure';
import { capturedOutput } from './testing/captured-output';

// What the duplicate guard keeps of an answer, and what a repeat gets while the first is still running, on a
// route marked as the activation is (`@SecretAnswer`, `@AwaitsFirstAnswer`; ADR 0019 D14 and D17). Over HTTP, on
// the guard's own store: Redis when the spec run has one (TEST_REDIS_URL), memory otherwise.
//   - a secret answer is never in the store in the clear, and nothing of it or of the key is written to the output;
//   - when it cannot be sealed, or no longer opens, a repeat is refused and the write is never run a second time;
//   - a repeat under the same key waits for the first answer and is given it; under another body it is 400.

const SECRET = `data:image/png;base64,${Buffer.from('GUARD-SECRET-ANSWER-'.repeat(12)).toString('base64')}`;
const KEY_A = Buffer.alloc(32, 11).toString('base64');
const KEY_B = Buffer.alloc(32, 12).toString('base64');

let runs = 0;
let hold: Promise<void> | null = null;
let failNext = false;

@Controller('office')
class ProbeController {
  @Post('probe')
  @HttpCode(201)
  @SecretAnswer((answer) => Boolean((answer as { line?: { esimQr?: string } }).line?.esimQr))
  @AwaitsFirstAnswer()
  async probe(@Body() body: { secret?: boolean }) {
    runs += 1;
    const run = runs;
    if (hold) await hold;
    if (failNext) {
      failNext = false;
      throw new OfficeFailure(400, 'BALANCE_CEILING');
    }
    return body.secret ? { applied: true, run, line: { esimQr: SECRET } } : { applied: false, taskId: `task-${run}` };
  }

  /** The same handler without the marks: the general rule of the guard. */
  @Post('plain')
  @HttpCode(201)
  async plain() {
    runs += 1;
    if (hold) await hold;
    return { run: runs };
  }
}

describe('what the duplicate guard keeps and answers on a marked route', () => {
  jest.setTimeout(60_000);
  const before = { key: process.env.SECRETS_KEY, redis: process.env.REDIS_URL };
  let app: INestApplication;
  let guard: DuplicateGuardInterceptor;
  let real: WriteStore;
  let kept: string[] = [];
  let session = 0;
  let sid = '';
  const redisUrl = process.env.TEST_REDIS_URL;

  const post = (path: 'probe' | 'plain', body: object, key?: string, cookie = sid) => {
    const call = request(app.getHttpServer()).post(`/office/${path}`).set('Cookie', `sid=${cookie}`);
    return (key ? call.set('Idempotency-Key', key) : call).send(body);
  };
  const fragments = (text: string) => Array.from({ length: 8 }, (_, at) => text.slice(30 + at * 37, 30 + at * 37 + 20)).filter((part) => part.length === 20);
  /** Every key and value the guard's Redis holds for this spec's sessions, or what was saved when there is no Redis. */
  const stored = async () => {
    if (!redisUrl) return kept.join('\n');
    const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
    try {
      const keys = await redis.keys('write:*');
      const values = await Promise.all(keys.map((name) => redis.get(name)));
      return [...keys, ...values, ...kept].join('\n');
    } finally {
      redis.disconnect();
    }
  };

  beforeAll(async () => {
    if (redisUrl) process.env.REDIS_URL = redisUrl;
    else delete process.env.REDIS_URL;
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController], providers: [...API_PROVIDERS] }).compile();
    app = moduleRef.createNestApplication();
    guard = new DuplicateGuardInterceptor();
    real = guard.store;
    app.useGlobalInterceptors(guard);
    await app.init();
  });

  beforeEach(() => {
    process.env.SECRETS_KEY = KEY_A;
    runs = 0;
    hold = null;
    failNext = false;
    kept = [];
    sid = `answers-spec-${Date.now()}-${(session += 1)}`;
    guard.store = { ...real, save: (name, value, seconds) => { kept.push(value); return real.save(name, value, seconds); } };
  });

  afterAll(async () => {
    await app.close();
    await guard.onModuleDestroy();
    if (before.key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = before.key;
    if (before.redis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = before.redis;
  });

  it('keeps a secret answer sealed, answers the repeat from it, and writes nothing of it or of the key to the output', async () => {
    const key = 'answers-key-sealed-0001';
    let first: request.Response | undefined;
    let again: request.Response | undefined;
    const output = await capturedOutput(async () => {
      first = await post('probe', { secret: true }, key);
      again = await post('probe', { secret: true }, key);
    });
    expect([first?.status, again?.status, again?.headers['idempotent-replay']]).toEqual([201, 201, 'true']);
    expect(again?.body).toEqual(first?.body);
    expect(runs).toBe(1);
    expect(kept).toHaveLength(1);
    expect(kept[0].startsWith('v1:')).toBe(true);
    const everything = await stored();
    for (const part of fragments(SECRET)) {
      expect(everything).not.toContain(part);
      expect(output).not.toContain(part);
    }
    expect(everything).not.toContain(key);
    expect(output).not.toContain(key);
    // Without a key of the client's too: the ten-second copy is sealed the same way.
    const unkeyed = await post('probe', { secret: true, other: 1 });
    expect(unkeyed.status).toBe(201);
    expect(kept[1].startsWith('v1:')).toBe(true);
    for (const part of fragments(SECRET)) expect(await stored()).not.toContain(part);
  });

  it('keeps an answer with no secret as it is, sealing key or not', async () => {
    delete process.env.SECRETS_KEY;
    const first = await post('probe', {}, 'answers-key-plain-0001');
    const again = await post('probe', {}, 'answers-key-plain-0001');
    expect([first.status, again.status, again.headers['idempotent-replay']]).toEqual([201, 201, 'true']);
    expect(again.body).toEqual(first.body);
    expect(runs).toBe(1);
    expect(kept).toEqual([JSON.stringify(first.body)]);
  });

  it('keeps no answer when a secret one cannot be sealed: the repeat is refused and nothing runs twice', async () => {
    delete process.env.SECRETS_KEY;
    const first = await post('probe', { secret: true }, 'answers-key-unsealed-0001');
    expect(first.status).toBe(201);
    expect(kept).toEqual(['__done__']);
    for (const part of fragments(SECRET)) expect(await stored()).not.toContain(part);
    const again = await post('probe', { secret: true }, 'answers-key-unsealed-0001');
    expect([again.status, again.body.code]).toEqual([409, 'DUPLICATE_REQUEST']);
    // Ten at once fare the same: none waits for an answer that will never come, none runs.
    const many = await Promise.all(Array.from({ length: 10 }, () => post('probe', { secret: true }, 'answers-key-unsealed-0001')));
    expect(many.map((response) => response.status)).toEqual(Array.from({ length: 10 }, () => 409));
    expect(runs).toBe(1);
  });

  it('refuses the repeat when the kept answer no longer opens, and runs nothing twice', async () => {
    const first = await post('probe', { secret: true }, 'answers-key-rekeyed-0001');
    expect(first.status).toBe(201);
    process.env.SECRETS_KEY = KEY_B;
    const other = await post('probe', { secret: true }, 'answers-key-rekeyed-0001');
    delete process.env.SECRETS_KEY;
    const none = await post('probe', { secret: true }, 'answers-key-rekeyed-0001');
    expect([other.status, other.body.code, none.status, none.body.code]).toEqual([409, 'DUPLICATE_REQUEST', 409, 'DUPLICATE_REQUEST']);
    expect(JSON.stringify([other.body, none.body])).not.toContain('v1:');
    expect(runs).toBe(1);
  });

  it('gives ten requests sent at once under one key the first answer: one run, no refusal', async () => {
    let release = () => undefined as void;
    hold = new Promise<void>((resolve) => { release = resolve; });
    const calls = Array.from({ length: 10 }, () => post('probe', {}, 'answers-key-ten-0001').then((response) => response));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(runs).toBe(1);
    release();
    const responses = await Promise.all(calls);
    expect(responses.map((response) => response.status)).toEqual(Array.from({ length: 10 }, () => 201));
    expect(new Set(responses.map((response) => response.body.taskId))).toEqual(new Set(['task-1']));
    expect(responses.filter((response) => response.headers['idempotent-replay'] === 'true')).toHaveLength(9);
    expect(runs).toBe(1);
  });

  it('refuses the key with another body while the first runs and after it', async () => {
    let release = () => undefined as void;
    hold = new Promise<void>((resolve) => { release = resolve; });
    const first = post('probe', {}, 'answers-key-body-0001').then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const during = await post('probe', { other: true }, 'answers-key-body-0001');
    release();
    await first;
    const after = await post('probe', { other: true }, 'answers-key-body-0001');
    expect([during.status, during.body.code, after.status, after.body.code]).toEqual([400, 'INVALID', 400, 'INVALID']);
    expect(runs).toBe(1);
  });

  it('lets a waiting repeat run when the first failed, and the others are answered with that run', async () => {
    let release = () => undefined as void;
    hold = new Promise<void>((resolve) => { release = resolve; });
    failNext = true;
    const calls = Array.from({ length: 5 }, () => post('probe', {}, 'answers-key-failed-0001').then((response) => response));
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    const responses = await Promise.all(calls);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 201, 201, 201, 400]);
    expect(new Set(responses.filter((response) => response.status === 201).map((response) => response.body.taskId))).toEqual(new Set(['task-2']));
    expect(runs).toBe(2);
  });

  it('marks a keyed write as running for a short lease, not for the whole day', async () => {
    const claims: number[] = [];
    const inner = guard.store;
    guard.store = { ...inner, claim: (name, seconds, marker) => { if (!name.endsWith(':of')) claims.push(seconds); return inner.claim(name, seconds, marker); } };
    await post('probe', {}, 'answers-key-lease-0001');
    expect(claims).toEqual([RUNNING_SECONDS]);
  });

  it('keeps the general rule elsewhere: a repeat while the first runs is refused', async () => {
    guard.store = memoryWrites();
    let release = () => undefined as void;
    hold = new Promise<void>((resolve) => { release = resolve; });
    const first = post('plain', {}, 'answers-key-plain-route-1').then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const again = await post('plain', {}, 'answers-key-plain-route-1');
    release();
    expect([(await first).status, again.status, again.body.code]).toEqual([201, 409, 'DUPLICATE_REQUEST']);
    expect(runs).toBe(1);
  });
});
