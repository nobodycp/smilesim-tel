import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../../db';
import type { Prisma } from '../../../../generated/prisma/client';
import { seal } from '../../../shared/secret-box';
import { UnitOfWork } from '../../kernel/unit-of-work';
import type { NoticeService } from '../../notices/notice.service';
import { ProviderOperationsRepository } from './provider-operations.repository';
import { ProviderOperationsService } from './provider-operations.service';

// PostgreSQL only (TEST_DATABASE_URL). The schema of ADR 0019, slice S.1: what the database itself refuses,
// whatever code is written later. Nothing reads these columns and tables yet.
//
// Every test runs inside a transaction that is rolled back, so it leaves nothing behind: a decision event cannot
// be deleted once committed, which is the point of the table.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Tx = Prisma.TransactionClient;
const ROLLBACK = new Error('rolled back on purpose');

suite('activation settlement schema (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const before = { url: process.env.DATABASE_URL, key: process.env.SECRETS_KEY };
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    process.env.SECRETS_KEY = Buffer.alloc(32, 4).toString('base64');
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = before.key;
  });

  /** Runs in a transaction and rolls it back. */
  const scratch = (run: (tx: Tx) => Promise<void>) =>
    prisma.$transaction(async (tx) => {
      await run(tx);
      throw ROLLBACK;
    }, { timeout: 20_000 }).catch((error: unknown) => (error === ROLLBACK ? undefined : Promise.reject(error)));

  /** The statement is refused by the database, and the transaction goes on (a savepoint takes the failure). */
  const refused = async (tx: Tx, run: () => Promise<unknown>, saying?: RegExp) => {
    await tx.$executeRawUnsafe('SAVEPOINT refused');
    let failure: unknown;
    try {
      await run();
    } catch (error) {
      failure = error;
    }
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT refused');
    expect(failure).toBeDefined();
    if (saying) expect(`${(failure as Error).message} ${JSON.stringify((failure as { meta?: unknown }).meta ?? '')}`).toMatch(saying);
  };

  /** A point of sale, a provider, a package, an open activation task and an operation not yet tied to it. */
  const seed = async (tx: Tx) => {
    const id = randomUUID();
    const user = await tx.user.create({ data: { loginName: `s1-${id}`, nickname: 's1', passwordHash: 'x', layer: 'pos', wallet: { create: { balance: 5000, held: 3500 } } } });
    const provider = await tx.provider.create({ data: { code: `s1-${id}`, name: 's1' } });
    const prices = { branchCost: 1, mainPrice: 2, agentPrice: 3, posPrice: 4, subscriberPrice: 5, renewalBranchCost: 1, renewalMainPrice: 2, renewalAgentPrice: 3, renewalPosPrice: 4, renewalSubscriberPrice: 5 };
    const flags = { autoActivate: false, autoCharge: false, autoDisconnect: false, autoFreeze: false, autoSwitch: false };
    const pkg = await tx.package.create({ data: { code: `s1-${id}`, name: 's1', providerId: provider.id, ...prices, ...flags } });
    const task = (key?: string) => tx.officeTask.create({ data: { action: 'activate', status: 'working', posId: user.id, packageId: pkg.id, submitterId: user.id, posDelta: -3500, held: 3500, unitPrice: 3500, msisdn: null, iccid: null, ...(key ? { requestKey: key, requestHash: 'h' } : {}) } });
    const operation = (taskId?: string) => tx.providerOperation.create({ data: { idempotencyKey: `s1:${randomUUID()}`, requestHash: 'h', action: 'activate', providerId: provider.id, packageCode: pkg.code, status: 'unknown', ...(taskId ? { taskId } : {}) } });
    return { user, provider, pkg, task, operation };
  };

  const event = (operationId: string, sequence: number, over: Partial<Prisma.ProviderDecisionEventUncheckedCreateInput> = {}): Prisma.ProviderDecisionEventUncheckedCreateInput => ({
    operationId, sequence, type: 'proposed', decision: 'declare-failure', evidenceKind: 'provider-portal', note: 'The provider portal shows no activation for it.', accountId: 'acc-1', accountLoginName: 'owner', ...over,
  });

  it('has the indexes, constraints and triggers of the migration', async () => {
    const names = async (sql: string) => (await prisma.$queryRawUnsafe<{ name: string }[]>(sql)).map((row) => row.name).sort();
    expect(await names(`SELECT indexname AS name FROM pg_indexes WHERE indexname IN ('ProviderOperation_taskId_key', 'OfficeTask_requestKey_key', 'ProviderDecisionEvent_operationId_sequence_key', 'ProviderCredential_providerId_target_key') AND indexdef LIKE 'CREATE UNIQUE INDEX%'`))
      .toEqual(['OfficeTask_requestKey_key', 'ProviderCredential_providerId_target_key', 'ProviderDecisionEvent_operationId_sequence_key', 'ProviderOperation_taskId_key']);
    expect(await names(`SELECT conname AS name FROM pg_constraint WHERE contype = 'f' AND conname IN ('ProviderOperation_taskId_fkey', 'ProviderDecisionEvent_operationId_fkey', 'ProviderCredential_providerId_fkey') AND confdeltype = 'r'`))
      .toEqual(['ProviderCredential_providerId_fkey', 'ProviderDecisionEvent_operationId_fkey', 'ProviderOperation_taskId_fkey']);
    expect(await names(`SELECT conname AS name FROM pg_constraint WHERE contype = 'c' AND conrelid IN ('"ProviderOperation"'::regclass, '"Provider"'::regclass, '"ProviderDecisionEvent"'::regclass, '"ProviderCredential"'::regclass) AND convalidated`))
      .toEqual(expect.arrayContaining([
        'ProviderCredential_sealed', 'ProviderCredential_target_known',
        'ProviderDecisionEvent_account_named', 'ProviderDecisionEvent_decision_known', 'ProviderDecisionEvent_evidenceKind_known', 'ProviderDecisionEvent_evidence_given',
        'ProviderDecisionEvent_sequence_positive', 'ProviderDecisionEvent_success_referenced', 'ProviderDecisionEvent_type_known',
        'ProviderOperation_applyError_known', 'ProviderOperation_resultEsimCode_sealed', 'Provider_dispatch_approval_named',
      ]));
    // Both triggers are there and switched on.
    expect(await names(`SELECT tgname AS name FROM pg_trigger WHERE tgrelid = '"ProviderDecisionEvent"'::regclass AND NOT tgisinternal AND tgenabled = 'O'`))
      .toEqual(['ProviderDecisionEvent_no_truncate', 'ProviderDecisionEvent_no_update_or_delete']);
  });

  it('gives a task one operation, for ever', async () => {
    await scratch(async (tx) => {
      const { task, operation } = await seed(tx);
      const first = await task();
      const second = await task();
      const tied = await operation(first.id);
      // A second operation for the same task is refused, as a new row and as an existing one re-pointed.
      await refused(tx, () => operation(first.id), /taskId|Unique constraint/);
      const other = await operation(second.id);
      await refused(tx, () => tx.providerOperation.update({ where: { id: other.id }, data: { taskId: first.id } }), /taskId|Unique constraint/);
      // Operations with no task are as many as needed, and a task that does not exist cannot be named.
      await operation();
      await operation();
      await refused(tx, () => operation(randomUUID()), /Foreign key|taskId/);
      // The task cannot be deleted from under its operation.
      await refused(tx, () => tx.officeTask.delete({ where: { id: first.id } }), /Foreign key|taskId/);
      expect(await tx.officeTask.findUnique({ where: { id: first.id }, include: { providerOperation: true } })).toMatchObject({ providerOperation: { id: tied.id } });
    });
  });

  it('gives a request key one task, and leaves tasks without a key alone', async () => {
    await scratch(async (tx) => {
      const { task } = await seed(tx);
      const key = `key-${randomUUID()}`;
      await task(key);
      await refused(tx, () => task(key), /requestKey|Unique constraint/);
      await task(`key-${randomUUID()}`);
      await task();
      await task();
    });
  });

  it('accepts only known application errors, and an eSIM code only when it is sealed', async () => {
    await scratch(async (tx) => {
      const { operation } = await seed(tx);
      const { id } = await operation();
      const set = (data: Prisma.ProviderOperationUncheckedUpdateInput) => tx.providerOperation.update({ where: { id }, data });
      for (const applyError of ['number-taken', 'sim-taken', 'target-missing', null]) await set({ applyError });
      await refused(tx, () => set({ applyError: 'something-else' }), /applyError_known/);
      const code = 'LPA:1$smdp.example.com$ACTIVATION-CODE-123';
      await refused(tx, () => set({ resultEsimCode: code }), /resultEsimCode_sealed/);
      const sealed = seal(code);
      await set({ resultEsimCode: sealed, resultMsisdn: '0500000001', resultIccid: '8997202000000000777', appliedAt: new Date() });
      const stored = await tx.providerOperation.findUniqueOrThrow({ where: { id } });
      expect(stored.resultEsimCode).toBe(sealed);
      expect(stored.resultEsimCode).not.toContain('ACTIVATION-CODE');
    });
  });

  it('records an approval to dispatch only with who gave it', async () => {
    await scratch(async (tx) => {
      const { provider } = await seed(tx);
      const set = (data: Prisma.ProviderUncheckedUpdateInput) => tx.provider.update({ where: { id: provider.id }, data });
      expect(provider).toMatchObject({ dispatchApprovedAt: null, dispatchApprovedByLoginName: null, dispatchPausedAt: null });
      await refused(tx, () => set({ dispatchApprovedAt: new Date() }), /dispatch_approval_named/);
      await refused(tx, () => set({ dispatchApprovedByLoginName: 'owner' }), /dispatch_approval_named/);
      await set({ dispatchApprovedAt: new Date(), dispatchApprovedByLoginName: 'owner', dispatchPausedAt: new Date() });
      await set({ dispatchApprovedAt: null, dispatchApprovedByLoginName: null });
    });
  });

  it('orders the steps of a decision, one row per step', async () => {
    await scratch(async (tx) => {
      const { operation } = await seed(tx);
      const { id } = await operation();
      const other = await operation();
      await tx.providerDecisionEvent.create({ data: event(id, 1) });
      await tx.providerDecisionEvent.create({ data: event(id, 2, { type: 'approved', evidenceKind: null, note: '', accountId: 'acc-2', accountLoginName: 'accountant' }) });
      // Two writers of the same step: the second is refused. Another operation has its own sequence.
      await refused(tx, () => tx.providerDecisionEvent.create({ data: event(id, 2, { type: 'refused', evidenceKind: null, note: '' }) }), /sequence|Unique constraint/);
      await tx.providerDecisionEvent.create({ data: event(other.id, 1) });
      await refused(tx, () => tx.providerDecisionEvent.create({ data: event(id, 0) }), /sequence_positive/);
      await refused(tx, () => tx.providerDecisionEvent.create({ data: event(randomUUID(), 1) }), /Foreign key|operationId/);
    });
  });

  it('refuses a decision that is not one it knows, has no evidence, a short note, or no reference for a success', async () => {
    await scratch(async (tx) => {
      const { operation } = await seed(tx);
      const { id } = await operation();
      const write = (sequence: number, over: Partial<Prisma.ProviderDecisionEventUncheckedCreateInput>) => tx.providerDecisionEvent.create({ data: event(id, sequence, over) });
      await refused(tx, () => write(1, { type: 'edited' }), /type_known/);
      await refused(tx, () => write(1, { decision: 'refund' }), /decision_known/);
      await refused(tx, () => write(1, { evidenceKind: 'a-feeling' }), /evidenceKind_known/);
      await refused(tx, () => write(1, { evidenceKind: null }), /evidence_given/);
      await refused(tx, () => write(1, { note: 'too short' }), /evidence_given/);
      await refused(tx, () => write(1, { note: `   ${'x'.repeat(19)}   ` }), /evidence_given/);
      await refused(tx, () => write(1, { type: 'applied', decision: 'apply-corrected', note: '' }), /evidence_given/);
      await refused(tx, () => write(1, { type: 'applied', decision: 'confirm-success' }), /success_referenced/);
      await refused(tx, () => write(1, { type: 'applied', decision: 'confirm-success', providerRef: '   ' }), /success_referenced/);
      await refused(tx, () => write(1, { accountId: '' }), /account_named/);
      await refused(tx, () => write(1, { accountLoginName: '' }), /account_named/);
      // What is allowed: twenty characters exactly, a referenced success, and an approval that adds no evidence.
      await write(1, { note: 'x'.repeat(20) });
      await write(2, { type: 'approved', evidenceKind: null, note: '' });
      await write(3, { type: 'applied', decision: 'confirm-success', providerRef: 'REF-1', suppliedEsimCode: true });
      expect(await tx.providerDecisionEvent.count({ where: { operationId: id } })).toBe(3);
    });
  });

  it('never lets a decision event be changed, deleted or emptied, by any statement', async () => {
    await scratch(async (tx) => {
      const { operation } = await seed(tx);
      const { id } = await operation();
      const written = await tx.providerDecisionEvent.create({ data: event(id, 1) });
      const appendOnly = /append-only/;
      await refused(tx, () => tx.providerDecisionEvent.update({ where: { id: written.id }, data: { note: 'A different story, long enough to pass.' } }), appendOnly);
      await refused(tx, () => tx.providerDecisionEvent.updateMany({ where: { operationId: id }, data: { accountLoginName: 'someone-else' } }), appendOnly);
      await refused(tx, () => tx.providerDecisionEvent.delete({ where: { id: written.id } }), appendOnly);
      await refused(tx, () => tx.providerDecisionEvent.deleteMany({ where: { operationId: id } }), appendOnly);
      await refused(tx, () => tx.$executeRawUnsafe(`UPDATE "ProviderDecisionEvent" SET "type" = 'refused' WHERE "id" = '${written.id}'`), appendOnly);
      await refused(tx, () => tx.$executeRawUnsafe(`DELETE FROM "ProviderDecisionEvent"`), appendOnly);
      await refused(tx, () => tx.$executeRawUnsafe(`TRUNCATE "ProviderDecisionEvent"`), appendOnly);
      // Nor by removing the operation it is about.
      await refused(tx, () => tx.providerOperation.delete({ where: { id } }), /Foreign key|operationId/);
      // It is exactly as written, and a new step can still be added.
      expect(await tx.providerDecisionEvent.findUniqueOrThrow({ where: { id: written.id } })).toEqual(written);
      await tx.providerDecisionEvent.create({ data: event(id, 2, { type: 'refused', evidenceKind: null, note: '' }) });
      expect(await tx.providerDecisionEvent.count({ where: { operationId: id } })).toBe(2);
    });
  });

  it('keeps one sealed credential per provider and target', async () => {
    await scratch(async (tx) => {
      const { provider } = await seed(tx);
      const secret = 'api-key-sk_live_123456';
      const row = (target: string, sealedValue: string) => tx.providerCredential.create({ data: { providerId: provider.id, target, sealedValue, updatedByLoginName: 'owner' } });
      await refused(tx, () => row('sandbox', secret), /ProviderCredential_sealed/);
      await refused(tx, () => row('staging', seal(secret)), /target_known/);
      const sandbox = await row('sandbox', seal(secret));
      await row('live', seal(secret));
      await refused(tx, () => row('sandbox', seal('another')), /target|Unique constraint/);
      await refused(tx, () => tx.providerCredential.update({ where: { id: sandbox.id }, data: { sealedValue: secret } }), /ProviderCredential_sealed/);
      await refused(tx, () => tx.providerCredential.create({ data: { providerId: randomUUID(), target: 'sandbox', sealedValue: seal(secret), updatedByLoginName: 'owner' } }), /Foreign key|providerId/);
      // The provider cannot be deleted from under its credentials.
      await refused(tx, () => tx.provider.delete({ where: { id: provider.id } }), /Foreign key/);
      expect(JSON.stringify(await tx.providerCredential.findMany({ where: { providerId: provider.id } }))).not.toContain(secret);
    });
  });

  it('changes nothing for the code that exists: an operation is recorded and dispatched as before, with the new columns empty', async () => {
    const providerId = randomUUID();
    const code = `s1-live-${providerId}`;
    await prisma.provider.create({ data: { id: providerId, code, name: 's1' } });
    try {
      const uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as unknown as NoticeService);
      uow.prismaClient = prisma;
      const service = new ProviderOperationsService(uow, new ProviderOperationsRepository());
      const { id } = await service.record(`s1:${randomUUID()}`, { action: 'activate', providerCode: code, packageCode: 'pkg', msisdn: null, iccid: null, lineId: null });
      const attempt = (await service.claim(id)) as number;
      await service.beginSend(id, attempt);
      expect(await service.settle(id, attempt, { kind: 'confirmed', providerRef: 'R' })).toBe('succeeded');
      expect(await prisma.providerOperation.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'succeeded', taskId: null, appliedAt: null, applyError: null, applyFailedAt: null, resultMsisdn: null, resultIccid: null, resultEsimCode: null,
      });
      expect(await prisma.provider.findUniqueOrThrow({ where: { id: providerId } })).toMatchObject({ dispatchApprovedAt: null, dispatchApprovedByLoginName: null, dispatchPausedAt: null });
      expect(await prisma.providerDecisionEvent.count({ where: { operationId: id } })).toBe(0);
    } finally {
      const ids = (await prisma.providerOperation.findMany({ where: { providerId } })).map((row) => row.id);
      await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: ids } } });
      await prisma.providerOperation.deleteMany({ where: { providerId } });
      await prisma.provider.deleteMany({ where: { id: providerId } });
    }
  });
});
