import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../../db';
import { ApiFailure } from '../../../platform/api-failure';
import { PUBLISHED_OUTBOX_RETENTION_DAYS } from '../../../platform/retention';
import { UnitOfWork } from '../../../platform/unit-of-work';
import type { NoticeService } from '../../../notifications/notice.service';
import type { OperationRequest } from './provider-operation.rules';
import { purgeOutbox } from './outbox-retention';
import { OPERATION_REQUESTED, OPERATION_SETTLED, ProviderOperationsRepository } from './provider-operations.repository';
import { ProviderOperationsService } from './provider-operations.service';

// The outbox's retention in PostgreSQL (plan DB.13, ADR 0024). The unique key (topic, aggregateId, sequence) is what
// refuses a second writer of the same verdict; the purge deletes rows that held it. This spec shows the purge takes
// only published messages of applied operations, past 30 days, in batches, and that afterwards every way of writing
// a second verdict for such an operation is still refused, by the guard on its status, so no message is written.
// PostgreSQL only (see wallet-concurrency.db.spec.ts). Its rows are its own provider's; the messages it ages are
// dated in the 1950s and the purge's clock with them, so no other file's message is old enough to go.

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

suite('the outbox\'s retention (PostgreSQL)', () => {
  jest.setTimeout(60_000);
  const previousUrl = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  let uow: UnitOfWork;
  let service: ProviderOperationsService;
  let providerId: string;
  let request: OperationRequest;
  const now = new Date(Date.parse('1950-01-01T08:00:00.000Z') + Math.floor(Math.random() * 3650) * DAY);
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  const refusal = (run: Promise<unknown>) => run.then(() => null, (error: unknown) => (error instanceof ApiFailure ? { status: error.status, code: error.code } : Promise.reject(error)));
  const messages = (operationId: string) => prisma.outboxMessage.findMany({ where: { aggregateId: operationId }, orderBy: [{ topic: 'asc' }, { sequence: 'asc' }] });
  const published = (operationId: string, at: Date | null, topic?: string) => prisma.outboxMessage.updateMany({ where: { aggregateId: operationId, ...(topic ? { topic } : {}) }, data: { publishedAt: at } });

  /** An operation that succeeded on its first attempt: messages `requested` 0 and `settled` 2. */
  const succeeded = async () => {
    const { id } = await service.record(`test:${randomUUID()}`, request);
    const attempt = (await service.claim(id)) as number;
    expect(await service.settle(id, attempt, { kind: 'confirmed', providerRef: 'REF-1' })).toBe('succeeded');
    return id;
  };
  /** The settlement's stamp, as it writes it once it created the line and captured the hold. */
  const applied = async (id: string) => {
    const row = await service.stored(id);
    expect(await service.stampApplied(prisma, id, { resultMsisdn: row?.resultMsisdn ?? null, resultIccid: row?.resultIccid ?? null, resultEsimCode: row?.resultEsimCode ?? null }, new Date())).toBe(true);
  };

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as unknown as NoticeService);
    uow.prismaClient = prisma;
    service = new ProviderOperationsService(uow, new ProviderOperationsRepository());
  });

  beforeEach(async () => {
    providerId = randomUUID();
    await prisma.provider.create({ data: { id: providerId, code: `ret-test-${providerId}`, name: 'outbox retention spec' } });
    request = { action: 'activate', providerCode: `ret-test-${providerId}`, packageCode: 'pkg-1', msisdn: '0500000001', iccid: '8997202000000000777', lineId: null };
  });

  afterEach(async () => {
    const ids = (await prisma.providerOperation.findMany({ where: { providerId }, select: { id: true } })).map((row) => row.id);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: ids } } });
    await prisma.providerOperation.deleteMany({ where: { providerId } });
    await prisma.provider.deleteMany({ where: { id: providerId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('deletes only the published messages of applied operations past 30 days, in batches', async () => {
    expect(PUBLISHED_OUTBOX_RETENTION_DAYS).toBe(30);
    const limit = PUBLISHED_OUTBOX_RETENTION_DAYS;

    // Gone: a succeeded operation, applied (requested 0, settled 2).
    const appliedSuccess = await succeeded();
    await applied(appliedSuccess);
    // Gone: an attempt that came to no answer (unknown, settled 2), then failed by the provider's own late answer
    // (settled 3), and handed to the branch.
    const { id: handedOver } = await service.record(`test:${randomUUID()}`, request);
    const attempt = (await service.claim(handedOver)) as number;
    expect(await service.settle(handedOver, attempt, { kind: 'no-answer', error: 'timeout' })).toBe('unknown');
    await service.resolveUnknown(handedOver, { status: 'failed', error: 'refused' });
    expect(await service.stampHandedOver(prisma, handedOver, new Date())).toBe(true);
    // Kept: succeeded, but the settlement has not acted on it yet.
    const notApplied = await succeeded();
    // Kept: applied, but its messages were published 29 days ago.
    const recent = await succeeded();
    await applied(recent);
    // Applied, its first message published long ago (gone), its second not published (kept).
    const halfPublished = await succeeded();
    await applied(halfPublished);

    for (const id of [appliedSuccess, handedOver, notApplied]) await published(id, ago(limit + 1));
    await published(recent, ago(limit - 1));
    await published(halfPublished, ago(limit + 1), OPERATION_REQUESTED);
    await published(halfPublished, null, OPERATION_SETTLED);

    // Six messages past the limit, two a statement: three full statements and one that removes none.
    expect(await purgeOutbox(prisma, now, 2)).toBe(6);
    expect(await messages(appliedSuccess)).toEqual([]);
    expect(await messages(handedOver)).toEqual([]);
    expect((await messages(notApplied)).map((row) => [row.topic, row.sequence])).toEqual([[OPERATION_REQUESTED, 0], [OPERATION_SETTLED, 2]]);
    expect((await messages(recent)).map((row) => [row.topic, row.sequence])).toEqual([[OPERATION_REQUESTED, 0], [OPERATION_SETTLED, 2]]);
    expect((await messages(halfPublished)).map((row) => [row.topic, row.sequence, row.publishedAt])).toEqual([[OPERATION_SETTLED, 2, null]]);
  });

  it('still refuses a second verdict for an operation whose messages were purged, and writes no message', async () => {
    const success = await succeeded();
    await applied(success);
    const { id: failed } = await service.record(`test:${randomUUID()}`, request);
    const attempt = (await service.claim(failed)) as number;
    expect(await service.settle(failed, attempt, { kind: 'no-answer', error: 'timeout' })).toBe('unknown');
    await service.resolveUnknown(failed, { status: 'failed', error: 'refused' });
    expect(await service.stampHandedOver(prisma, failed, new Date())).toBe(true);
    for (const id of [success, failed]) await published(id, ago(PUBLISHED_OUTBOX_RETENTION_DAYS + 1));
    expect(await purgeOutbox(prisma, now)).toBe(5);

    const duplicate = { status: 409, code: 'DUPLICATE_REQUEST' };
    for (const id of [success, failed]) {
      // The attempt's answer again, as the dispatcher would hand it (the verdict that ends it, and the late one that
      // closes an unknown), several at once.
      const again = await Promise.all([
        refusal(service.settle(id, attempt, { kind: 'confirmed', providerRef: 'REF-2' })),
        refusal(service.settle(id, attempt, { kind: 'refused', error: 'refused' })),
        refusal(service.settle(id, attempt, { kind: 'no-answer', error: 'timeout' })),
        refusal(service.settle(id, attempt, { kind: 'confirmed', providerRef: 'REF-3' })),
      ]);
      expect(again).toEqual([duplicate, duplicate, duplicate, duplicate]);
      // A person's verdicts and recovery's.
      expect(await refusal(service.resolveUnknown(id, { status: 'succeeded', providerRef: 'REF-4' }))).toEqual(duplicate);
      expect(await refusal(service.resolveUnknown(id, { status: 'failed', error: 'refused' }))).toEqual(duplicate);
      expect(await uow.runTx((tx) => service.declareFailed(tx, id))).toBe(false);
      expect(await uow.runTx((tx) => service.confirmUnknown(tx, id, 'REF-5', null))).toBe(false);
      expect(await service.recover(id, new Date(now.getTime() + 3650 * DAY))).toBeNull();
      // No new attempt, and the settlement's stamps are taken once.
      expect(await service.claim(id)).toBeNull();
      expect(await service.stampHandedOver(prisma, id, new Date())).toBe(false);
      expect(await messages(id)).toEqual([]);
    }
    expect(await service.status({ id: success })).toMatchObject({ status: 'succeeded', attempts: 1, providerRef: 'REF-1' });
    expect(await service.status({ id: failed })).toMatchObject({ status: 'failed', attempts: 1, lastError: 'refused' });

    // What refused them is the status guard, not the key: the key's row is gone, and the database would take the
    // same message again. No path above reached that insert.
    const row = await prisma.outboxMessage.create({ data: { topic: OPERATION_SETTLED, aggregateId: success, sequence: 2, payload: { operationId: success } } });
    expect(row.sequence).toBe(2);
  });
});
