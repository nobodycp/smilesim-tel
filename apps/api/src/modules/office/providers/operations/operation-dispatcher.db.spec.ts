import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPrismaClient } from '../../../../db';
import { UnitOfWork } from '../../kernel/unit-of-work';
import type { NoticeService } from '../../notices/notice.service';
import { ScriptedGateway } from '../testing/scripted-gateway';
import { OperationDispatcher, recoverExpired } from './operation-dispatcher';
import { ATTEMPT_LEASE_MS, MAX_ATTEMPTS, type OperationRequest, type SendEvidence } from './provider-operation.rules';
import { ProviderOperationsRepository } from './provider-operations.repository';
import { ProviderOperationsService } from './provider-operations.service';

// PostgreSQL only (TEST_DATABASE_URL). The provider is a scripted gateway that reaches nothing.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('operation dispatcher and recovery (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ProviderOperationsService;
  let gateway: ScriptedGateway;
  let dispatcher: OperationDispatcher;
  let providerId: string;
  let request: OperationRequest;

  const record = async () => (await service.record(`test:${randomUUID()}`, request)).id;
  const status = (id: string) => service.status({ id });
  const sends = async (id: string) => (await prisma.outboxMessage.findMany({ where: { aggregateId: id } })).map((row) => row.sequence).sort();
  const afterLease = () => new Date(Date.now() + ATTEMPT_LEASE_MS + 1_000);
  // Other specs hold pending operations in the same database, so the sweep always runs at the real time: an
  // attempt is made to look abandoned by claiming it in the past, never by moving the sweep's clock forward.
  const longAgo = () => new Date(Date.now() - ATTEMPT_LEASE_MS - 5_000);
  const whileLeased = () => new Date(Date.now() - ATTEMPT_LEASE_MS);
  /** Every table the code under test read or wrote through its client, over the whole suite. */
  const touched = new Set<string>();

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    // The service works through a client that notes each table it is asked for. Other specs move wallets in this
    // database at the same time, so counting rows would prove nothing; what this code asked for does.
    const watched = prisma.$extends({
      query: {
        $allModels: {
          $allOperations({ model, args, query }) {
            touched.add(model);
            return query(args);
          },
        },
      },
    });
    const uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as unknown as NoticeService);
    uow.prismaClient = watched as unknown as typeof prisma;
    service = new ProviderOperationsService(uow, new ProviderOperationsRepository());
  });

  beforeEach(async () => {
    providerId = randomUUID();
    const providerCode = `dispatch-test-${providerId}`;
    await prisma.provider.create({ data: { id: providerId, code: providerCode, name: 'dispatcher spec' } });
    request = { action: 'activate', providerCode, packageCode: 'pkg-1', msisdn: '0500000001', iccid: '8997202000000000777', lineId: null };
    gateway = new ScriptedGateway();
    dispatcher = new OperationDispatcher(service, gateway);
  });

  afterEach(async () => {
    const ids = (await prisma.providerOperation.findMany({ where: { providerId } })).map((row) => row.id);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: ids } } });
    await prisma.providerOperation.deleteMany({ where: { providerId } });
    await prisma.provider.deleteMany({ where: { id: providerId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('claims, marks, calls the provider once with the key and the attempt, and settles', async () => {
    const id = await record();
    expect(await dispatcher.handle(id)).toBe('succeeded');
    const row = await prisma.providerOperation.findUniqueOrThrow({ where: { id } });
    expect(gateway.calls).toEqual([{ idempotencyKey: row.idempotencyKey, attempt: 1, action: 'activate', providerCode: request.providerCode, packageCode: 'pkg-1', msisdn: '0500000001', iccid: '8997202000000000777' }]);
    expect(row).toMatchObject({ status: 'succeeded', attempts: 1, providerRef: 'REF-1' });
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.leaseUntil!.getTime() - row.lastAttemptAt!.getTime()).toBe(ATTEMPT_LEASE_MS);
  });

  it('lets one of two workers send an operation they both received', async () => {
    const id = await record();
    const other = new OperationDispatcher(service, gateway);
    const results = await Promise.all([dispatcher.handle(id), other.handle(id), dispatcher.handle(id), other.handle(id)]);
    expect(results.filter((result) => result === 'succeeded')).toHaveLength(1);
    expect(results.filter((result) => result === 'skipped')).toHaveLength(3);
    expect(gateway.calls).toHaveLength(1);
    expect(await status(id)).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('does nothing for a message that comes again, or for an operation that does not exist', async () => {
    const id = await record();
    expect(await dispatcher.handle(id)).toBe('succeeded');
    expect(await dispatcher.handle(id)).toBe('skipped');
    expect(await dispatcher.handle(randomUUID())).toBe('missing');
    expect(gateway.calls).toHaveLength(1);
  });

  it.each([
    ['a refusal', { left: true, answer: 'refused', error: 'invalid-request' }, 'failed', 'invalid-request', [0]],
    ['no answer', { left: true, answer: 'none', error: 'timeout' }, 'unknown', 'timeout', [0]],
    ['a request that never left', { left: false, error: 'unreachable' }, 'requested', 'unreachable', [0, 1]],
  ] as const)('settles %s by its evidence', async (_name, evidence, expected, error, messages) => {
    const id = await record();
    gateway.next(evidence as SendEvidence);
    expect(await dispatcher.handle(id)).toBe(expected);
    expect(await status(id)).toMatchObject({ status: expected, lastError: error, attempts: 1 });
    expect(await sends(id)).toEqual(messages);
  });

  it('reads a gateway that throws, and one that does not answer in time, as "may have left": unknown, not sent again', async () => {
    const thrown = await record();
    gateway.next(async () => { throw new Error('socket hang up: Authorization: Bearer secret-token'); });
    expect(await dispatcher.handle(thrown)).toBe('unknown');
    expect(await status(thrown)).toMatchObject({ status: 'unknown', lastError: 'no-evidence' });
    // Nothing of the error's text is stored.
    expect(JSON.stringify(await prisma.providerOperation.findUniqueOrThrow({ where: { id: thrown } }))).not.toContain('secret-token');

    const silent = await record();
    gateway.next(() => new Promise<SendEvidence>(() => undefined));
    expect(await new OperationDispatcher(service, gateway, 30).handle(silent)).toBe('unknown');
    expect(await status(silent)).toMatchObject({ status: 'unknown', lastError: 'no-evidence' });

    expect(await dispatcher.handle(thrown)).toBe('skipped');
    expect(await dispatcher.handle(silent)).toBe('skipped');
    expect(gateway.calls).toHaveLength(2);
    expect([await sends(thrown), await sends(silent)]).toEqual([[0], [0]]);
  });

  it('schedules what never left again, durably, until the attempts are used up', async () => {
    const id = await record();
    gateway.next(...Array.from({ length: MAX_ATTEMPTS }, () => ({ left: false, error: 'unreachable' }) as const));
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) expect(await dispatcher.handle(id)).toBe('requested');
    expect(await dispatcher.handle(id)).toBe('failed');
    expect(await dispatcher.handle(id)).toBe('skipped');
    expect(gateway.calls.map((call) => call.attempt)).toEqual([1, 2, 3, 4, 5]);
    // Every attempt went out under the same key.
    expect(new Set(gateway.calls.map((call) => call.idempotencyKey)).size).toBe(1);
    expect(await sends(id)).toEqual([0, 1, 2, 3, 4]);
  });

  it('recovers a worker that died before calling the provider: back to requested, and sent once', async () => {
    const id = await record();
    // The worker claimed and died: no send mark.
    expect(await service.claim(id, longAgo())).toBe(1);
    // While its lease ran, recovery left it alone.
    expect(await service.recover(id, whileLeased())).toBeNull();
    expect(await status(id)).toMatchObject({ status: 'pending' });
    expect(await recoverExpired(service)).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toMatchObject({ status: 'requested', attempts: 1, lastError: 'abandoned' });
    expect(await sends(id)).toEqual([0, 1]);
    expect(gateway.calls).toHaveLength(0);

    expect(await dispatcher.handle(id)).toBe('succeeded');
    expect(gateway.calls.map((call) => call.attempt)).toEqual([2]);
  });

  it('recovers a worker that died after the provider may have been called: unknown, never failed, never sent again', async () => {
    const id = await record();
    const attempt = (await service.claim(id, longAgo())) as number;
    expect(await service.beginSend(id, attempt)).not.toBeNull();
    // Died here: the request may be at the provider.
    expect(await service.recover(id, whileLeased())).toBeNull();
    expect(await recoverExpired(service)).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toMatchObject({ status: 'unknown', attempts: 1, lastError: 'abandoned' });
    expect(await sends(id)).toEqual([0]);
    await recoverExpired(service);
    expect(await status(id)).toMatchObject({ status: 'unknown', attempts: 1 });
    expect(await dispatcher.handle(id)).toBe('skipped');
    expect(gateway.calls).toHaveLength(0);
  });

  it('does not let a worker that wakes up after recovery call the provider for its old attempt', async () => {
    const id = await record();
    // Worker A claims attempt 1 and stalls before the send mark.
    const stalled = (await service.claim(id, longAgo())) as number;
    await recoverExpired(service);
    expect(await status(id)).toMatchObject({ status: 'requested' });
    // Worker B takes the operation again and is mid-call.
    let release: (evidence: SendEvidence) => void = () => undefined;
    gateway.next(() => new Promise<SendEvidence>((resolve) => { release = resolve; }));
    const second = dispatcher.handle(id);
    while (gateway.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));

    // A wakes up: its mark is refused, so it has nothing to send; and a result under its number is refused.
    expect(await service.beginSend(id, stalled)).toBeNull();
    await expect(service.settle(id, stalled, { kind: 'confirmed', providerRef: 'OLD' })).rejects.toMatchObject({ status: 409 });
    expect(await status(id)).toMatchObject({ status: 'pending', attempts: 2, providerRef: null });

    release({ left: true, answer: 'confirmed', providerRef: 'NEW' });
    expect(await second).toBe('succeeded');
    expect(await status(id)).toMatchObject({ status: 'succeeded', attempts: 2, providerRef: 'NEW' });
    expect(gateway.calls.map((call) => call.attempt)).toEqual([2]);
  });

  it('keeps recovery away from a worker that marked the send first, and the worker away once recovery won', async () => {
    // Both at the same moment on an expired, unmarked attempt: exactly one of them gets it.
    for (let round = 0; round < 5; round += 1) {
      const id = await record();
      const attempt = (await service.claim(id, longAgo())) as number;
      const [marked, recovered] = await Promise.all([service.beginSend(id, attempt), service.recover(id, new Date())]);
      const row = await status(id);
      if (marked) {
        // The worker won: the call may happen, so the operation is pending (or already unknown), not requested.
        expect(['pending', 'unknown']).toContain(row.status);
        expect(recovered === 'requested').toBe(false);
      } else {
        expect(recovered).toBe('requested');
        expect(row.status).toBe('requested');
      }
    }
  });

  it('takes the provider\'s late answer for an attempt that recovery marked unknown, and no other late result', async () => {
    const confirmed = await record();
    let release: (evidence: SendEvidence) => void = () => undefined;
    gateway.next(() => new Promise<SendEvidence>((resolve) => { release = resolve; }));
    const slow = dispatcher.handle(confirmed);
    while (gateway.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    // The worker outlives its lease; recovery cannot know and marks the operation unknown.
    expect(await service.recover(confirmed, afterLease())).toBe('unknown');
    release({ left: true, answer: 'confirmed', providerRef: 'LATE-BUT-TRUE' });
    expect(await slow).toBe('succeeded');
    expect(await status(confirmed)).toMatchObject({ status: 'succeeded', providerRef: 'LATE-BUT-TRUE', attempts: 1 });

    // A late "no answer" or "never left" says nothing certain about an unknown operation: it stays unknown.
    const silent = await record();
    const attempt = (await service.claim(silent)) as number;
    await service.beginSend(silent, attempt);
    await service.recover(silent, afterLease());
    await expect(service.settle(silent, attempt, { kind: 'no-answer', error: 'timeout' })).rejects.toMatchObject({ status: 409 });
    await expect(service.settle(silent, attempt, { kind: 'not-sent', error: 'unreachable' })).rejects.toMatchObject({ status: 409 });
    expect(await status(silent)).toMatchObject({ status: 'unknown' });
    expect(await sends(silent)).toEqual([0]);
  });

  it('reads and writes operations, their outbox and the provider only: no wallet, entry, line or task', async () => {
    const id = await record();
    gateway.next({ left: false, error: 'unreachable' }, { left: true, answer: 'none', error: 'timeout' });
    await dispatcher.handle(id);
    await dispatcher.handle(id);
    const abandoned = await record();
    await service.claim(abandoned, longAgo());
    await recoverExpired(service);
    // Every test above ran through the watched client: only these three tables were ever asked for.
    expect([...touched].sort()).toEqual(['OutboxMessage', 'Provider', 'ProviderOperation']);
    // And by construction: nothing under operations/ or outbox/ imports the wallets, the lines or the tasks.
    const folders = [__dirname, join(__dirname, '..', '..', 'outbox')];
    const sources = folders.flatMap((folder) => readdirSync(folder).filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts')).map((file) => readFileSync(join(folder, file), 'utf8')));
    expect(sources.length).toBeGreaterThanOrEqual(7);
    for (const source of sources) expect(source).not.toMatch(/from '[^']*\/(wallets|lines|tasks)\//);
  });
});
