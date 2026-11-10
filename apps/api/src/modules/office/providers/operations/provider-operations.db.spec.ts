import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../../db';
import { OfficeFailure } from '../../../shared/office-failure';
import { UnitOfWork } from '../../kernel/unit-of-work';
import type { NoticeService } from '../../notices/notice.service';
import type { OperationRequest } from './provider-operation.rules';
import { OPERATION_REQUESTED, ProviderOperationsRepository } from './provider-operations.repository';
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
  const refusal = (run: Promise<unknown>) => run.then(() => null, (error: unknown) => (error instanceof OfficeFailure ? { status: error.status, code: error.code } : Promise.reject(error)));
  const operations = () => prisma.providerOperation.findMany({ where: { providerId } });
  const outbox = async () => prisma.outboxMessage.findMany({ where: { aggregateId: { in: (await operations()).map((row) => row.id) } } });
  const allOutbox = () => prisma.outboxMessage.count();

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
    const before = await allOutbox();
    const key = newKey();
    await expect(uow.runTx(async (tx) => {
      await service.recordIn(tx, key, request);
      throw new Error('the caller failed after recording');
    })).rejects.toThrow('the caller failed after recording');
    expect(await operations()).toHaveLength(0);
    expect(await allOutbox()).toBe(before);
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

  it('hands an operation to one worker only, and counts the attempt', async () => {
    const { id } = await service.record(newKey(), request);
    const claims = await Promise.all(Array.from({ length: 8 }, () => service.claim(id)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await service.status({ id })).toMatchObject({ status: 'pending', attempts: 1 });
    expect((await operations())[0].lastAttemptAt).toBeInstanceOf(Date);
  });

  it('settles a confirmed attempt as succeeded, once', async () => {
    const { id } = await service.record(newKey(), request);
    await service.claim(id);
    expect(await service.settle(id, { kind: 'confirmed', providerRef: ' REF-77 ' })).toBe('succeeded');
    expect(await service.status({ id })).toMatchObject({ status: 'succeeded', providerRef: 'REF-77', lastError: null });
    // Settled is final: no second answer, no new attempt, no late verdict.
    expect(await refusal(service.settle(id, { kind: 'refused', error: 'refused' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await service.claim(id)).toBe(false);
    expect(await refusal(service.resolveUnknown(id, { status: 'failed', error: 'refused' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    expect(await service.status({ id })).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('settles a refusal as failed, and refuses an answer for an operation nobody claimed', async () => {
    const { id } = await service.record(newKey(), request);
    expect(await refusal(service.settle(id, { kind: 'confirmed', providerRef: null }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    await service.claim(id);
    expect(await service.settle(id, { kind: 'refused', error: 'invalid-request' })).toBe('failed');
    expect(await service.status({ id })).toMatchObject({ status: 'failed', lastError: 'invalid-request', providerRef: null });
    expect(await service.claim(id)).toBe(false);
  });

  it('sends again what never left, up to the limit, then fails it', async () => {
    const { id } = await service.record(newKey(), request);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await service.claim(id)).toBe(true);
      expect(await service.settle(id, { kind: 'not-sent', error: 'unreachable' })).toBe('requested');
    }
    expect(await service.claim(id)).toBe(true);
    expect(await service.settle(id, { kind: 'not-sent', error: 'unreachable' })).toBe('failed');
    expect(await service.status({ id })).toMatchObject({ status: 'failed', attempts: 5, lastError: 'unreachable' });
  });

  it('keeps an attempt with no answer as unknown: never sent again, closed only by a verdict', async () => {
    const { id } = await service.record(newKey(), request);
    await service.claim(id);
    expect(await service.settle(id, { kind: 'no-answer', error: 'timeout' })).toBe('unknown');
    expect(await service.status({ id })).toMatchObject({ status: 'unknown', lastError: 'timeout', attempts: 1 });
    expect(await service.claim(id)).toBe(false);
    expect(await refusal(service.settle(id, { kind: 'confirmed', providerRef: 'x' }))).toEqual({ status: 409, code: 'DUPLICATE_REQUEST' });
    // The same key still answers the same operation: a caller that retries gets "unknown", not a second send.
    const key = (await operations())[0].idempotencyKey;
    expect(await service.record(key, request)).toEqual({ id, status: 'unknown', created: false });
    expect(await outbox()).toHaveLength(1);

    await service.resolveUnknown(id, { status: 'succeeded', providerRef: 'REF-9' });
    expect(await service.status({ id })).toMatchObject({ status: 'succeeded', providerRef: 'REF-9', lastError: null, attempts: 1 });
  });

  it('closes an unknown operation as failed when the provider says it never ran', async () => {
    const { id } = await service.record(newKey(), request);
    await service.claim(id);
    await service.settle(id, { kind: 'no-answer', error: 'connection-lost' });
    const verdicts = await Promise.all([refusal(service.resolveUnknown(id, { status: 'failed', error: 'refused' })), refusal(service.resolveUnknown(id, { status: 'succeeded', providerRef: null }))]);
    // Two verdicts at once: one is written.
    expect(verdicts.filter((verdict) => verdict === null)).toHaveLength(1);
    expect(['succeeded', 'failed']).toContain((await service.status({ id })).status);
  });

  it('refuses a state the code does not know, in the database itself', async () => {
    const { id } = await service.record(newKey(), request);
    await expect(prisma.providerOperation.update({ where: { id }, data: { status: 'maybe' } })).rejects.toThrow();
    await expect(prisma.providerOperation.update({ where: { id }, data: { attempts: -1 } })).rejects.toThrow();
  });
});
