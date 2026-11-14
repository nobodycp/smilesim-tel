import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../../db';
import { ApiFailure } from '../../../shared/api-failure';
import { UnitOfWork } from '../../kernel/unit-of-work';
import type { NoticeService } from '../../../notifications/notice.service';
import type { OperationRequest } from './provider-operation.rules';
import { OPERATION_REQUESTED, OPERATION_SETTLED, ProviderOperationsRepository } from './provider-operations.repository';
import { ProviderOperationsService } from './provider-operations.service';

// Runs against a real PostgreSQL only (see wallets/wallet-concurrency.db.spec.ts for a throwaway one): a unique
// key under concurrency, and a transaction that rolls back, cannot be shown on in-memory tables.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('provider operations (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  let uow: UnitOfWork;
  let service: ProviderOperationsService;
  let providerId: string;
  let providerCode: string;
  let request: OperationRequest;

  const newKey = () => `test:${randomUUID()}`;
  const refusal = (run: Promise<unknown>) => run.then(() => null, (error: unknown) => (error instanceof ApiFailure ? { status: error.status, code: error.code } : Promise.reject(error)));
  const operations = () => prisma.providerOperation.findMany({ where: { providerId } });
  const outbox = async () => prisma.outboxMessage.findMany({ where: { aggregateId: { in: (await operations()).map((row) => row.id) } } });

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as unknown as NoticeService);
    uow.prismaClient = prisma;
    service = new ProviderOperationsService(uow, new ProviderOperationsRepository());
  });

  beforeEach(async () => {
    providerId = randomUUID();
    providerCode = `op-test-${providerId}`;
    await prisma.provider.create({ data: { id: providerId, code: providerCode, name: 'operations spec' } });
    request = { action: 'activate', providerCode, packageCode: 'pkg-1', msisdn: '0500000001', iccid: '8997202000000000777', lineId: null };
  });

  afterEach(async () => {
    const ids = (await operations()).map((row) => row.id);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: ids } } });
    await prisma.providerOperation.deleteMany({ where: { providerId } });
    await prisma.provider.deleteMany({ where: { id: providerId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('records one operation with its outbox message', async () => {
    const key = newKey();
    const recorded = await service.record(key, request);
    expect(recorded).toMatchObject({ status: 'requested', created: true });
    const [row] = await operations();
    expect(row).toMatchObject({ id: recorded.id, idempotencyKey: key, action: 'activate', providerId, packageCode: 'pkg-1', msisdn: '0500000001', status: 'requested', attempts: 0, providerRef: null, lastError: null });
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime() - 1000);
    expect(await outbox()).toMatchObject([{ topic: OPERATION_REQUESTED, aggregateId: recorded.id, payload: { operationId: recorded.id }, publishedAt: null }]);
    expect(await service.status({ idempotencyKey: key })).toMatchObject({ id: recorded.id, status: 'requested', attempts: 0 });
  });

  it('answers the first operation when the same request comes back with its key, and writes nothing', async () => {
    const key = newKey();
    const first = await service.record(key, request);
    const again = await service.record(key, { ...request });
    expect(again).toEqual({ id: first.id, status: 'requested', created: false });
    expect(await operations()).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
    // Another key is another operation.
    await service.record(newKey(), request);
    expect(await operations()).toHaveLength(2);
    expect(await outbox()).toHaveLength(2);
  });

  it('refuses a key that comes back with another request', async () => {
    const key = newKey();
    await service.record(key, request);
    expect(await refusal(service.record(key, { ...request, msisdn: '0500000002' }))).toEqual({ status: 400, code: 'INVALID' });
    expect(await refusal(service.record(key, { ...request, action: 'extend' }))).toEqual({ status: 400, code: 'INVALID' });
    expect(await operations()).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
  });

  it('refuses a malformed key and an unknown provider, writing nothing', async () => {
    expect(await refusal(service.record('short', request))).toEqual({ status: 400, code: 'INVALID' });
    expect(await refusal(service.record(newKey(), { ...request, providerCode: 'no-such-provider' }))).toEqual({ status: 404, code: 'NOT_FOUND' });
    expect(await operations()).toHaveLength(0);
  });

  it('leaves neither the operation nor the message when the caller\'s transaction fails', async () => {
    const key = newKey();
    let recordedId = '';
    await expect(uow.runTx(async (tx) => {
      recordedId = (await service.recordIn(tx, key, request)).id;
      throw new Error('the caller failed after recording');
    })).rejects.toThrow('the caller failed after recording');
    expect(recordedId).not.toBe('');
    expect(await operations()).toHaveLength(0);
    // Other specs write messages in this database too: this operation's own message is what must be gone.
    expect(await prisma.outboxMessage.count({ where: { aggregateId: recordedId } })).toBe(0);
    expect(await refusal(service.status({ idempotencyKey: key }))).toEqual({ status: 404, code: 'NOT_FOUND' });
  });

  it('leaves no operation when the outbox write fails', async () => {
    class BrokenOutbox extends ProviderOperationsRepository {
      override addOutbox(): never {
        throw new Error('outbox down');
      }
    }
    const broken = new ProviderOperationsService(uow, new BrokenOutbox());
    await expect(broken.record(newKey(), request)).rejects.toThrow('outbox down');
    expect(await operations()).toHaveLength(0);
  });

  it('commits the operation together with what its caller wrote', async () => {
    const key = newKey();
    await uow.runTx(async (tx) => {
      await service.recordIn(tx, key, request);
      await tx.provider.update({ where: { id: providerId }, data: { name: 'written with the operation' } });
    });
    expect(await operations()).toHaveLength(1);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: providerId } })).name).toBe('written with the operation');
  });

  it('makes one operation out of ten requests racing on one key', async () => {
    const key = newKey();
    const answers = await Promise.all(Array.from({ length: 10 }, () => service.record(key, request)));
    expect(answers.filter((answer) => answer.created)).toHaveLength(1);
    expect(new Set(answers.map((answer) => answer.id)).size).toBe(1);
    expect(await operations()).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
  });

  it('lets one request win when two different ones race on one key', async () => {
    const key = newKey();
    const results = await Promise.all([refusal(service.record(key, request)), refusal(service.record(key, { ...request, packageCode: 'pkg-2' }))]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.filter((result) => result !== null)).toEqual([{ status: 400, code: 'INVALID' }]);
    expect(await operations()).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
  });

  /** The sends scheduled so far: the sequences of the operation's `requested` messages. */
  const sends = async () => (await outbox()).filter((row) => row.topic === OPERATION_REQUESTED).map((row) => row.sequence).sort();
  /** The verdicts announced so far: the sequences of its `settled` messages (ADR 0019, D8; slice S.8). */
  const verdicts = async () => (await outbox()).filter((row) => row.topic === OPERATION_SETTLED).map((row) => row.sequence).sort((left, right) => left - right);

  it('hands an operation to one worker only, and names the attempt', async () => {
    const { id } = await service.record(newKey(), request);
    const claims = await Promise.all(Array.from({ length: 8 }, () => service.claim(id)));
    expect(claims.filter((attempt) => attempt !== null)).toEqual([1]);
    expect(await service.status({ id })).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await operations())[0].lastAttemptAt).toBeInstanceOf(Date);
  });

  it('settles a confirmed attempt as succeeded, once', async () => {
    const { id } = await service.record(newKey(), request);
    const attempt = (await service.claim(id)) as number;
    expect(await service.settle(id, attempt, { kind: 'confirmed', providerRef: ' REF-77 ' })).toBe('succeeded');
    expect(await service.status({ id })).toMatchObject({ status: 'succeeded', providerRef: 'REF-77', lastError: null });
    // Settled is final: no second answer for the attempt, no new attempt, no late verdict.
    expect(await refusal(service.settle(id, attempt, { kind: 'refused', error: 'refused' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await refusal(service.settle(id, attempt, { kind: 'confirmed', providerRef: 'OTHER' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await service.claim(id)).toBeNull();
    expect(await refusal(service.resolveUnknown(id, { status: 'failed', error: 'refused' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await service.status({ id })).toMatchObject({ status: 'succeeded', attempts: 1, providerRef: 'REF-77' });
    expect(await sends()).toEqual([0]);
  });

  it('writes one result when the same attempt is settled by several at once', async () => {
    const { id } = await service.record(newKey(), request);
    const attempt = (await service.claim(id)) as number;
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => refusal(service.settle(id, attempt, { kind: 'confirmed', providerRef: `REF-${index}` }))));
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.filter((result) => result !== null)).toEqual(Array.from({ length: 5 }, () => ({ status: 409, code: 'DUPLICATE_REQUEST' })));
    expect(await service.status({ id })).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('settles a refusal as failed, and refuses an answer for an operation nobody claimed', async () => {
    const { id } = await service.record(newKey(), request);
    expect(await refusal(service.settle(id, 1, { kind: 'confirmed', providerRef: null }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await refusal(service.settle(randomUUID(), 1, { kind: 'confirmed', providerRef: null }))).toEqual({ status: 404, code: 'NOT_FOUND' });
    const attempt = (await service.claim(id)) as number;
    expect(await service.settle(id, attempt, { kind: 'refused', error: 'invalid-request' })).toBe('failed');
    expect(await service.status({ id })).toMatchObject({ status: 'failed', lastError: 'invalid-request', providerRef: null });
    expect(await service.claim(id)).toBeNull();
    expect(await sends()).toEqual([0]);
  });

  it('refuses the late answer of an earlier attempt and leaves the attempt in flight untouched', async () => {
    const { id } = await service.record(newKey(), request);
    const first = (await service.claim(id)) as number;
    expect(await service.settle(id, first, { kind: 'not-sent', error: 'unreachable' })).toBe('requested');
    const second = (await service.claim(id)) as number;
    expect([first, second]).toEqual([1, 2]);

    // The first attempt's answer arrives now, in every shape it could take: none of them is written.
    for (const late of [{ kind: 'confirmed', providerRef: 'LATE' }, { kind: 'refused', error: 'refused' }, { kind: 'no-answer', error: 'timeout' }, { kind: 'not-sent', error: 'unreachable' }] as const) {
      expect(await refusal(service.settle(id, first, late))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    }
    expect(await service.status({ id })).toMatchObject({ status: 'pending', attempts: 2, providerRef: null, lastError: null });
    expect(await sends()).toEqual([0, 1]);
    // An attempt that was never made is refused the same way.
    expect(await refusal(service.settle(id, 3, { kind: 'confirmed', providerRef: 'FUTURE' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });

    expect(await service.settle(id, second, { kind: 'confirmed', providerRef: 'REF-2' })).toBe('succeeded');
    expect(await service.status({ id })).toMatchObject({ status: 'succeeded', attempts: 2, providerRef: 'REF-2' });
  });

  it('writes the message for the next send together with the return to requested', async () => {
    const { id } = await service.record(newKey(), request);
    expect(await outbox()).toMatchObject([{ sequence: 0, publishedAt: null }]);
    // The first message is consumed, as a relay would: the retry must not depend on it.
    await prisma.outboxMessage.updateMany({ where: { aggregateId: id }, data: { publishedAt: new Date() } });
    const attempt = (await service.claim(id)) as number;
    expect(await service.settle(id, attempt, { kind: 'not-sent', error: 'unreachable' })).toBe('requested');
    const waiting = (await outbox()).filter((row) => row.publishedAt === null);
    expect(waiting).toMatchObject([{ topic: OPERATION_REQUESTED, aggregateId: id, sequence: 1, payload: { operationId: id } }]);
    expect(await service.status({ id })).toMatchObject({ status: 'requested', attempts: 1, lastError: 'unreachable' });
  });

  it('writes one message for the next send when several report the same attempt at once', async () => {
    const { id } = await service.record(newKey(), request);
    const attempt = (await service.claim(id)) as number;
    const results = await Promise.all(Array.from({ length: 6 }, () => refusal(service.settle(id, attempt, { kind: 'not-sent', error: 'unreachable' }))));
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(await sends()).toEqual([0, 1]);
    // And the database itself holds one message per send, whoever writes it.
    await expect(prisma.outboxMessage.create({ data: { topic: OPERATION_REQUESTED, aggregateId: id, sequence: 1, payload: {} } })).rejects.toThrow();
  });

  it('keeps the operation pending when the message for the next send cannot be written', async () => {
    const { id } = await service.record(newKey(), request);
    const attempt = (await service.claim(id)) as number;
    class BrokenOutbox extends ProviderOperationsRepository {
      override addOutbox(): never {
        throw new Error('outbox down');
      }
    }
    const broken = new ProviderOperationsService(uow, new BrokenOutbox());
    await expect(broken.settle(id, attempt, { kind: 'not-sent', error: 'unreachable' })).rejects.toThrow('outbox down');
    // Neither half happened: the attempt is still in flight and can be reported again.
    expect(await service.status({ id })).toMatchObject({ status: 'pending', attempts: 1, lastError: null });
    expect(await sends()).toEqual([0]);
    expect(await service.settle(id, attempt, { kind: 'not-sent', error: 'unreachable' })).toBe('requested');
    expect(await sends()).toEqual([0, 1]);
  });

  it('sends again what never left, up to the limit, then fails it with no further message', async () => {
    const { id } = await service.record(newKey(), request);
    for (let round = 1; round <= 4; round += 1) {
      const attempt = await service.claim(id);
      expect(attempt).toBe(round);
      expect(await service.settle(id, round, { kind: 'not-sent', error: 'unreachable' })).toBe('requested');
    }
    expect(await service.claim(id)).toBe(5);
    expect(await service.settle(id, 5, { kind: 'not-sent', error: 'unreachable' })).toBe('failed');
    expect(await service.status({ id })).toMatchObject({ status: 'failed', attempts: 5, lastError: 'unreachable' });
    expect(await sends()).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps an attempt with no answer as unknown: never sent again, never rescheduled, closed only by a verdict', async () => {
    const { id } = await service.record(newKey(), request);
    const attempt = (await service.claim(id)) as number;
    expect(await service.settle(id, attempt, { kind: 'no-answer', error: 'timeout' })).toBe('unknown');
    expect(await service.status({ id })).toMatchObject({ status: 'unknown', lastError: 'timeout', attempts: 1 });
    expect(await sends()).toEqual([0]);
    expect(await service.claim(id)).toBeNull();
    // A late result that says nothing certain does not move it; another attempt's number never does.
    expect(await refusal(service.settle(id, attempt, { kind: 'no-answer', error: 'timeout' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await refusal(service.settle(id, attempt, { kind: 'not-sent', error: 'unreachable' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await refusal(service.settle(id, attempt + 1, { kind: 'confirmed', providerRef: 'x' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    // The same key still answers the same operation: a caller that retries gets "unknown", not a second send.
    const key = (await operations())[0].idempotencyKey;
    expect(await service.record(key, request)).toEqual({ id, status: 'unknown', created: false });
    expect(await sends()).toEqual([0]);

    // The unknown verdict was announced once, for the settlement to tell those who may decide.
    expect(await verdicts()).toEqual([2]);

    await service.resolveUnknown(id, { status: 'succeeded', providerRef: 'REF-9' });
    expect(await service.status({ id })).toMatchObject({ status: 'succeeded', providerRef: 'REF-9', lastError: null, attempts: 1 });
    expect(await sends()).toEqual([0]);
    // And the verdict that closed it, under its own sequence: one message per verdict, never two.
    expect(await verdicts()).toEqual([2, 3]);
  });

  it('closes an unknown operation as failed when the provider says it never ran, without a new send', async () => {
    const { id } = await service.record(newKey(), request);
    const attempt = (await service.claim(id)) as number;
    await service.settle(id, attempt, { kind: 'no-answer', error: 'connection-lost' });
    const verdicts = await Promise.all([refusal(service.resolveUnknown(id, { status: 'failed', error: 'refused' })), refusal(service.resolveUnknown(id, { status: 'succeeded', providerRef: null }))]);
    // Two verdicts at once: one is written.
    expect(verdicts.filter((verdict) => verdict === null)).toHaveLength(1);
    expect(['succeeded', 'failed']).toContain((await service.status({ id })).status);
    expect(await service.claim(id)).toBeNull();
    expect(await sends()).toEqual([0]);
  });

  it('gives each of many operations to one of many workers, each attempt settled once', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, async () => (await service.record(newKey(), request)).id));
    // Four workers go over the same list. Whoever takes an operation first reports that nothing left; whoever
    // takes it next (the same worker or another) does the same on their own first turn, or confirms it.
    const worker = async (name: number) => {
      const done: string[] = [];
      for (const id of ids) {
        const first = await service.claim(id);
        if (first === null) continue;
        await service.settle(id, first, { kind: 'not-sent', error: 'unreachable' });
        const second = await service.claim(id);
        if (second === null) continue;
        await service.settle(id, second, { kind: 'confirmed', providerRef: `W${name}` });
        done.push(id);
      }
      return done;
    };
    const finished = (await Promise.all([1, 2, 3, 4].map(worker))).flat();
    // Every operation was confirmed, and by one worker only.
    expect(finished.sort()).toEqual([...ids].sort());
    const messages = (await outbox()).filter((message) => message.topic === OPERATION_REQUESTED);
    for (const row of await operations()) {
      expect(row.status).toBe('succeeded');
      expect(row.attempts).toBeGreaterThanOrEqual(2);
      // One message per send, none missing and none twice: the first, then one for each attempt that went back.
      const sequences = messages.filter((message) => message.aggregateId === row.id).map((message) => message.sequence).sort();
      expect(sequences).toEqual(Array.from({ length: row.attempts }, (_, index) => index));
    }
  });

  it('refuses a state the code does not know, in the database itself', async () => {
    const { id } = await service.record(newKey(), request);
    await expect(prisma.providerOperation.update({ where: { id }, data: { status: 'maybe' } })).rejects.toThrow();
    await expect(prisma.providerOperation.update({ where: { id }, data: { attempts: -1 } })).rejects.toThrow();
  });
});
