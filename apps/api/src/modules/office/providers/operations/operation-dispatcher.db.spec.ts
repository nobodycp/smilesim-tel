import { OPEN_GATE } from '../testing/open-gate';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPrismaClient } from '../../../../db';
import { capturedOutput } from '../../../shared/testing/captured-output';
import { UnitOfWork } from '../../kernel/unit-of-work';
import type { NoticeService } from '../../notices/notice.service';
import { ScriptedGateway } from '../testing/scripted-gateway';
import { OperationDispatcher, recoverExpired } from './operation-dispatcher';
import { ATTEMPT_LEASE_MS, MAX_ATTEMPTS, type OperationRequest, type SendEvidence } from './provider-operation.rules';
import { OPERATION_REQUESTED, ProviderOperationsRepository } from './provider-operations.repository';
import { ProviderOperationsService } from './provider-operations.service';

// PostgreSQL only (TEST_DATABASE_URL). The provider is a scripted gateway that reaches nothing.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('operation dispatcher and recovery (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  let service: ProviderOperationsService;
  let uowOf: () => UnitOfWork;
  let gateway: ScriptedGateway;
  let dispatcher: OperationDispatcher;
  let providerId: string;
  let request: OperationRequest;

  const record = async () => (await service.record(`test:${randomUUID()}`, request)).id;
  const status = (id: string) => service.status({ id });
  /** The sends scheduled for an operation: its `requested` messages (its verdicts have their own topic). */
  const sends = async (id: string) => (await prisma.outboxMessage.findMany({ where: { aggregateId: id, topic: OPERATION_REQUESTED } })).map((row) => row.sequence).sort();
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
    uowOf = () => {
      const uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as unknown as NoticeService);
      uow.prismaClient = watched as unknown as typeof prisma;
      return uow;
    };
    service = new ProviderOperationsService(uowOf(), new ProviderOperationsRepository());
  });

  beforeEach(async () => {
    providerId = randomUUID();
    const providerCode = `dispatch-test-${providerId}`;
    await prisma.provider.create({ data: { id: providerId, code: providerCode, name: 'dispatcher spec' } });
    request = { action: 'activate', providerCode, packageCode: 'pkg-1', msisdn: '0500000001', iccid: '8997202000000000777', lineId: null };
    gateway = new ScriptedGateway();
    dispatcher = new OperationDispatcher(service, gateway, OPEN_GATE);
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
    const other = new OperationDispatcher(service, gateway, OPEN_GATE);
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
    expect(await new OperationDispatcher(service, gateway, OPEN_GATE, 30).handle(silent)).toBe('unknown');
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
    // It marked the send while its lease ran, then died: the request may be at the provider.
    expect(await service.beginSend(id, attempt, whileLeased())).not.toBeNull();
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

  it('does not let a worker that wakes up after its lease, and before recovery ran, call the provider', async () => {
    const id = await record();
    // A worker whose claim was committed long ago and which only now gets to the send: it stalled past its lease.
    class Stalled extends ProviderOperationsService {
      override claim(operationId: string) {
        return super.claim(operationId, longAgo());
      }
    }
    const stalled = new Stalled(uowOf(), new ProviderOperationsRepository());
    expect(await new OperationDispatcher(stalled, gateway, OPEN_GATE).handle(id)).toBe('skipped');
    expect(gateway.calls).toHaveLength(0);
    // Nothing was marked and nothing changed: the attempt is still pending, for recovery to take back.
    const row = await prisma.providerOperation.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'pending', attempts: 1, sentAt: null });
    // The same holds for a direct call, at the lease's last instant and after it; one instant earlier it is allowed.
    const leaseUntil = row.leaseUntil as Date;
    expect(await service.beginSend(id, 1, new Date(leaseUntil.getTime() + 1))).toBeNull();
    expect(await service.beginSend(id, 1, leaseUntil)).toBeNull();
    expect(await service.beginSend(id, 1)).toBeNull();
    expect((await prisma.providerOperation.findUniqueOrThrow({ where: { id } })).sentAt).toBeNull();

    // Recovery then proves it unsent and schedules it again; the next attempt is sent, once.
    expect(await service.recover(id)).toBe('requested');
    expect(await sends(id)).toEqual([0, 1]);
    expect(await dispatcher.handle(id)).toBe('succeeded');
    expect(gateway.calls.map((call) => call.attempt)).toEqual([2]);
  });

  it('gives an expired attempt to recovery and a leased one to its worker, whoever asks first', async () => {
    for (let round = 0; round < 5; round += 1) {
      // One clock, lease over: the worker can never start, recovery always takes it back.
      const expired = await record();
      const old = (await service.claim(expired, longAgo())) as number;
      expect(await Promise.all([service.beginSend(expired, old), service.recover(expired)])).toEqual([null, 'requested']);
      // One clock, lease running: the worker starts, recovery keeps away.
      const leased = await record();
      const fresh = (await service.claim(leased)) as number;
      const [marked, recovered] = await Promise.all([service.beginSend(leased, fresh), service.recover(leased)]);
      expect([marked === null, recovered]).toEqual([false, null]);
      expect(await status(leased)).toMatchObject({ status: 'pending', attempts: 1 });
    }
    expect(gateway.calls).toHaveLength(0);
  });

  it('lets exactly one of a worker and recovery have an attempt when their clocks disagree about its lease', async () => {
    const results: string[] = [];
    for (let round = 0; round < 12; round += 1) {
      const id = await record();
      const attempt = (await service.claim(id)) as number;
      const leaseUntil = (await prisma.providerOperation.findUniqueOrThrow({ where: { id } })).leaseUntil as Date;
      // The worker's clock says the lease still runs; recovery's says it is over. Both act at once.
      const [marked, recovered] = await Promise.all([
        service.beginSend(id, attempt, new Date(leaseUntil.getTime() - 1)),
        service.recover(id, new Date(leaseUntil.getTime() + 1)),
      ]);
      const row = await prisma.providerOperation.findUniqueOrThrow({ where: { id } });
      if (marked) {
        // The worker won: a call may follow, so the operation was not handed back for a new send.
        expect(recovered === 'requested').toBe(false);
        expect(['pending', 'unknown']).toContain(row.status);
        expect(row.sentAt).toBeInstanceOf(Date);
        expect(await sends(id)).toEqual([0]);
      } else {
        // Recovery won: the worker has nothing to send and the operation waits for a new attempt.
        expect(recovered).toBe('requested');
        expect(row).toMatchObject({ status: 'requested', sentAt: null });
        expect(await sends(id)).toEqual([0, 1]);
      }
      results.push(marked ? 'worker' : 'recovery');
    }
    expect(results).toHaveLength(12);
  });

  it('writes a code, never the gateway\'s own words, to the log', async () => {
    const secrets = ['sk_live_9f8e7d6c5b4a', 'hunter2-password', 'Bearer eyJhbGciOi.token.value', 'https://api-user:api-pass@provider.example/activate'];
    const leaky = () => Object.assign(new Error(`POST ${secrets[3]} failed: Authorization: ${secrets[2]}; password=${secrets[1]}`), {
      stack: `Error: key ${secrets[0]}\n    at send (adapter.ts:1:1)`,
      config: { headers: { Authorization: secrets[2] }, auth: { password: secrets[1] } },
      response: { data: { apiKey: secrets[0] } },
    });
    const thrown = await record();
    const reset = await record();
    const disguised = await record();
    gateway.next(async () => { throw leaky(); }, async () => { throw Object.assign(leaky(), { code: 'ECONNRESET' }); }, async () => { throw Object.assign(leaky(), { code: 'EAPIKEYABC123456789' }); });
    const output = await capturedOutput(async () => {
      expect(await dispatcher.handle(thrown)).toBe('unknown');
      expect(await dispatcher.handle(reset)).toBe('unknown');
      expect(await dispatcher.handle(disguised)).toBe('unknown');
    });
    // The lines are there, and say what happened in codes.
    expect(output).toContain('the gateway failed without evidence (unclassified)');
    expect(output).toContain('the gateway failed without evidence (ECONNRESET)');
    expect(output).toContain(`operation ${thrown} attempt 1: no-answer -> unknown`);
    // A "code" that is not on the list is not written either, though it is shaped like one.
    for (const secret of [...secrets, 'api-pass', 'Authorization', 'password', 'adapter.ts', 'EAPIKEY', 'ABC123456789']) expect(output).not.toContain(secret);
    // Nor in the database.
    const stored = JSON.stringify(await prisma.providerOperation.findMany({ where: { id: { in: [thrown, reset] } } }));
    for (const secret of secrets) expect(stored).not.toContain(secret);
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
