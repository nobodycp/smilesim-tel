import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import type { PrismaClient } from './generated/prisma/client';
import type { AuthStore } from './modules/auth/auth.store';
import { AccountTree } from './modules/office/kernel/account-tree';
import { ActorResolver } from './modules/office/kernel/actor-resolver';
import { UnitOfWork } from './modules/office/kernel/unit-of-work';
import { ActivationSettlement } from './modules/office/lines/activation-settlement';
import { LinePricing } from './modules/office/lines/line-pricing';
import { LinesRepository } from './modules/office/lines/lines.repository';
import { TaskCompletion } from './modules/office/lines/task-completion';
import type { NoticeService } from './modules/office/notices/notice.service';
import { TasksRepository } from './modules/office/tasks/tasks.repository';
import { TasksService } from './modules/office/tasks/tasks.service';
import { PriceLadder } from './modules/office/terms/price-ladder';
import { WalletLedger } from './modules/office/wallets/wallet-ledger';
import { OutboxRelay } from './modules/office/outbox/outbox-relay';
import { OutboxRepository } from './modules/office/outbox/outbox.repository';
import { QueuePublisher } from './modules/office/outbox/queue-publisher';
import type { SendGate } from './modules/office/providers/dispatch/dispatch-gate';
import { READY_EVERY_MS, READY_TTL_MS, type DispatchSettings, type ProviderTarget } from './modules/office/providers/dispatch/dispatch-policy';
import type { BuiltAdapters, OpenedCredential } from './modules/office/providers/dispatch/provider-adapters';
import type { RoutingProviderGateway } from './modules/office/providers/dispatch/routing-gateway';
import { open } from './modules/shared/secret-box';
import { OperationDispatcher, WaitingPass, recoverExpired } from './modules/office/providers/operations/operation-dispatcher';
import { OPERATION_REQUESTED, OPERATION_SETTLED, ProviderOperationsRepository } from './modules/office/providers/operations/provider-operations.repository';
import { ProviderOperationsService } from './modules/office/providers/operations/provider-operations.service';
import { errorCode, logger } from './modules/shared/log';

const log = logger('ProviderDispatch');

export const OPERATIONS_QUEUE = 'provider-operations';
/** The queue of verdicts to act on (ADR 0019, D8): its jobs never reach a provider. */
export const SETTLEMENTS_QUEUE = 'provider-settlements';
export const RELAY_EVERY_MS = 2_000;
export const RECOVERY_EVERY_MS = 30_000;
/** How often the sweeper looks for a verdict that was recorded and not acted on. */
export const SWEEP_EVERY_MS = 60_000;

/** The worker signs nobody in: the settlement reads accounts and their grants, never a session. */
const NO_SESSIONS = new Proxy({}, { get: () => { throw new Error('the worker has no sessions'); } }) as AuthStore;

/**
 * The settlement of provider verdicts with the services it writes through, built by hand as the API's module
 * builds them: the same ledger, the same task completion, the same notices.
 */
export function buildActivationSettlement(uow: UnitOfWork, operations: ProviderOperationsService): ActivationSettlement {
  const tree = new AccountTree(uow);
  const ladder = new PriceLadder(uow);
  const ledger = new WalletLedger(uow, tree, ladder);
  const lines = new LinesRepository(uow);
  const tasks = new TasksService(uow, tree, new ActorResolver(NO_SESSIONS, uow), ledger, new TasksRepository(uow));
  const completion = new TaskCompletion(uow, ledger, tasks, new LinePricing(uow, tree, ladder, lines), lines);
  return new ActivationSettlement(uow, completion, tasks, lines, operations);
}

/** What a failed job leaves in the queue: a code and no stack. */
export class JobFailure extends Error {
  constructor(code: string) {
    super(`provider-operation job failed: ${code}`);
    this.name = 'JobFailure';
    this.stack = undefined;
  }
}

/** The pieces the worker runs for provider operations, built by hand: the worker is not a Nest application. */
/**
 * `gate` is required (ADR 0019, D18): every attempt is taken and marked through it, and sent through the permit
 * it gives at the mark. The worker passes its deployment's gate (`DeploymentSendGate`); there is no default and
 * no gateway here, so nothing sends ungated or through anything the gate did not judge.
 */
export function buildProviderDispatch(prisma: PrismaClient, connection: IORedis, gate: SendGate, prefix?: string, notice?: NoticeService) {
  const uow = new UnitOfWork(notice);
  uow.prismaClient = prisma;
  const operations = new ProviderOperationsService(uow, new ProviderOperationsRepository());
  const publisher = new QueuePublisher(connection, { [OPERATION_REQUESTED]: OPERATIONS_QUEUE, [OPERATION_SETTLED]: SETTLEMENTS_QUEUE }, prefix);
  const dispatcher = new OperationDispatcher(operations, gate);
  const settlement = buildActivationSettlement(uow, operations);
  /** A job carries the operation's id and nothing else. */
  const operationIdOf = (data: unknown): string => {
    const id = (data as { operationId?: unknown } | null)?.operationId;
    if (typeof id !== 'string') throw new Error('a provider-operation job carries no operation id');
    return id;
  };
  return {
    uow,
    operations,
    publisher,
    gate,
    relay: new OutboxRelay(uow, new OutboxRepository(), publisher, [OPERATION_REQUESTED, OPERATION_SETTLED]),
    dispatcher,
    /** The pass over operations that wait to be sent: it keeps its place between rounds. */
    waiting: new WaitingPass(dispatcher, operations),
    settlement,
    /**
     * The settlements queue's processor: acts on the verdict of one operation. A repeat, or a job that comes
     * after the sweeper, finds nothing to do. A failure leaves the job failed with a code; the sweeper is the retry.
     */
    settle: async (data: unknown) => {
      const id = operationIdOf(data);
      try {
        await settlement.apply(id);
      } catch (error) {
        const code = errorCode(error);
        log.error(`operation ${id}: its settlement failed (${code})`);
        throw new JobFailure(code);
      }
    },
    /** The queue's processor: a job carries the operation's id and nothing else. */
    handle: async (data: unknown) => {
      const id = operationIdOf(data);
      try {
        await dispatcher.handle(id);
      } catch (error) {
        // The queue keeps a failed job's error text in Redis: it gets a code, never the message or the stack.
        const code = errorCode(error);
        log.error(`operation ${id}: the job failed (${code})`);
        throw new JobFailure(code);
      }
    },
  };
}

/** Starts the relay and the recovery on their timers. Answers what stops them. */
export function startProviderDispatchTimers(parts: Pick<ReturnType<typeof buildProviderDispatch>, 'relay' | 'operations' | 'publisher' | 'settlement' | 'waiting' | 'gate'>): () => Promise<void> {
  let relaying = false;
  const relay = setInterval(() => {
    if (relaying) return;
    relaying = true;
    void parts.relay.runOnce().catch((error) => log.warn(`relay round failed: ${errorCode(error)}`)).finally(() => { relaying = false; });
  }, RELAY_EVERY_MS);
  let recovering = false;
  const recovery = setInterval(() => {
    if (recovering) return;
    recovering = true;
    // Attempts whose worker is gone, then the operations a closed gate left waiting: each goes through the gate
    // again, so a provider that was resumed sends what waited and a paused one still sends nothing.
    // Recovery is given the gate: an unsent attempt found while its provider is closed is not counted.
    void recoverExpired(parts.operations, new Date(), 100, parts.gate)
      .then(() => parts.waiting.round())
      .catch((error) => log.warn(`recovery failed: ${errorCode(error)}`))
      .finally(() => { recovering = false; });
  }, RECOVERY_EVERY_MS);
  let sweeping = false;
  const sweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void parts.settlement.applyPending().catch((error) => log.warn(`settlement sweep failed: ${errorCode(error)}`)).finally(() => { sweeping = false; });
  }, SWEEP_EVERY_MS);
  relay.unref?.();
  recovery.unref?.();
  sweep.unref?.();
  return async () => {
    clearInterval(relay);
    clearInterval(recovery);
    clearInterval(sweep);
    // The pass in flight takes no further operation: nothing new is sent by a worker that is stopping.
    parts.waiting.stop();
    await parts.publisher.close();
  };
}

/** Whether this deployment may build adapters at all: dispatch on, coherent settings, a target, a name, a provider named. */
function mayBuild(settings: DispatchSettings): settings is DispatchSettings & { target: ProviderTarget; deployment: string } {
  return settings.on && settings.problems.length === 0 && settings.target !== null && settings.deployment !== null && settings.adapters.length > 0;
}

/**
 * The opened credentials of the providers this deployment may build adapters for, as they are stored now (ADR
 * 0019, D18), each with its generation. Only the worker calls this: it is the one place a stored credential is
 * opened. Nothing is read unless dispatch is on, the settings hold together and a target is stated. A credential
 * that does not open (the key changed, the value is damaged) is remembered as unreadable and throws when asked
 * for, so no adapter is built with it; one that is not stored answers null. Neither the value nor the cipher's
 * error is logged.
 */
export async function readCredentials(prisma: PrismaClient, settings: DispatchSettings): Promise<(providerCode: string, target: ProviderTarget) => OpenedCredential | null> {
  const opened = new Map<string, OpenedCredential | Error>();
  if (mayBuild(settings)) {
    const rows = await prisma.providerCredential.findMany({ where: { target: settings.target, provider: { code: { in: [...settings.adapters] } } }, select: { sealedValue: true, generation: true, target: true, provider: { select: { code: true } } } });
    for (const row of rows) {
      try {
        const value = open(row.sealedValue);
        opened.set(`${row.provider.code}:${row.target}`, value === '' ? new Error('empty') : { value, generation: row.generation });
      } catch {
        opened.set(`${row.provider.code}:${row.target}`, new Error('unreadable'));
      }
    }
  }
  return (providerCode, target) => {
    const found = opened.get(`${providerCode}:${target}`);
    if (found instanceof Error) throw new Error('a provider credential could not be opened');
    return found ?? null;
  };
}

/** The generation of each named provider's stored credential for the deployment's target. No value is read. */
async function storedGenerations(prisma: PrismaClient, settings: DispatchSettings & { target: ProviderTarget }): Promise<string> {
  const rows = await prisma.providerCredential.findMany({ where: { target: settings.target, provider: { code: { in: [...settings.adapters] } } }, select: { generation: true, provider: { select: { code: true } } } });
  return rows.map((row) => `${row.provider.code}:${row.generation}`).sort().join(',');
}

/** How old a worker's row may be before any worker's round removes it: well past the time it is believed for. */
const STALE_AFTER_MS = 10 * READY_TTL_MS;

/**
 * This worker's attestation, and its adapters kept true to what is stored (ADR 0019, D18). Each round, on a timer:
 *
 * 1. **Rebuild.** When a credential was written since the adapters were built (its generation moved, or one
 *    appeared), every adapter is built again from what is stored now (`rebuild`) and the gateway is handed the
 *    new set. An adapter built from a replaced credential is never kept.
 * 2. **Attest.** For each adapter it holds, the worker writes **its own row** (`ProviderWorkerAttestation`, by
 *    its `workerId`): this deployment, this target, the generation of the credential the adapter was built from,
 *    and the time **by the database's clock** (`now()`). The provider's row is locked first and the stored
 *    generation read under the lock, so a worker that still holds a replaced credential writes nothing, and what
 *    it wrote before is removed: it cannot bring back what the replacement withdrew. It never writes or removes
 *    another worker's row, except rows long past belief (a worker that was killed), which any round clears.
 *
 * The API opens the dispatch route only on such a row, fresh by the database's clock. A worker with no adapter
 * writes nothing. Stopping removes this worker's rows and nobody else's: another worker of the deployment keeps
 * the route open. Answers `stop`, and `round` for a caller that does not wait for the timer.
 */
export function startReadiness(
  prisma: PrismaClient, settings: DispatchSettings, gateway: RoutingProviderGateway, rebuild: () => Promise<BuiltAdapters>, workerId: string = randomUUID(), everyMs: number = READY_EVERY_MS,
): { stop: () => Promise<void>; round: () => Promise<void>; workerId: string } {
  if (!mayBuild(settings)) return { stop: async () => undefined, round: async () => undefined, workerId };
  const { target, deployment } = settings;
  /** What was stored when the adapters were last built; null until the first round has looked. */
  let builtFrom: string | null = null;
  let stopped = false;
  const attest = async (code: string, generation: number) => {
    await prisma.$transaction(async (tx) => {
      // Shared: several workers attest at once, and each waits for a write of the credential, a pause or an approval.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Provider" WHERE "code" = ${code} FOR SHARE`;
      const provider = rows[0];
      if (!provider) return;
      // Read after the lock is held: a replacement that committed while this waited is what it finds.
      const stored = await tx.$queryRaw<{ generation: number }[]>`SELECT "generation" FROM "ProviderCredential" WHERE "providerId" = ${provider.id} AND "target" = ${target}`;
      if (stored[0]?.generation !== generation) {
        await tx.$executeRaw`DELETE FROM "ProviderWorkerAttestation" WHERE "providerId" = ${provider.id} AND "workerId" = ${workerId}`;
        return;
      }
      await tx.$executeRaw`
        INSERT INTO "ProviderWorkerAttestation" ("id", "providerId", "workerId", "deployment", "target", "generation", "attestedAt")
        VALUES (${randomUUID()}, ${provider.id}, ${workerId}, ${deployment}, ${target}, ${generation}, now())
        ON CONFLICT ("providerId", "workerId") DO UPDATE SET "deployment" = EXCLUDED."deployment", "target" = EXCLUDED."target", "generation" = EXCLUDED."generation", "attestedAt" = now()`;
    });
  };
  /** This worker's rows for providers it no longer holds an adapter for, and anybody's rows long past belief. */
  const clear = async (held: string[]) => {
    await prisma.$executeRaw`
      DELETE FROM "ProviderWorkerAttestation" a USING "Provider" p
      WHERE p."id" = a."providerId" AND ((a."workerId" = ${workerId} AND NOT (p."code" = ANY(${held}::text[]))) OR a."attestedAt" < now() - make_interval(secs => ${STALE_AFTER_MS / 1000}))`;
  };
  let running: Promise<void> | null = null;
  const once = async () => {
    const stored = await storedGenerations(prisma, settings);
    if (builtFrom === null) builtFrom = [...gateway.held()].map((code) => `${code}:${gateway.generation(code)}`).sort().join(',');
    if (stored !== builtFrom) {
      const built = await rebuild();
      gateway.use(built);
      builtFrom = stored;
      for (const [code, why] of built.skipped) log.warn(`provider dispatch: no adapter for ${code} (${why})`);
      log.log(`provider dispatch: adapters rebuilt from the stored credentials (${built.adapters.size} held)`);
    }
    const held = gateway.held();
    for (const code of held) {
      const generation = gateway.generation(code);
      // A worker that was told to stop writes nothing more: its rows are being removed.
      if (generation !== null && !stopped) await attest(code, generation);
    }
    await clear(held);
  };
  /** One round at a time: a slow round is not overtaken by the next tick. */
  const round = () => {
    if (stopped) return Promise.resolve();
    running ??= once().catch((error) => log.warn(`readiness failed: ${errorCode(error)}`)).finally(() => { running = null; });
    return running;
  };
  void round();
  const timer = setInterval(() => void round(), everyMs);
  timer.unref?.();
  return {
    workerId,
    round,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      // The round in flight ends first, so nothing it writes outlives the removal below.
      await running;
      await prisma.providerWorkerAttestation.deleteMany({ where: { workerId } }).catch(() => undefined);
    },
  };
}
