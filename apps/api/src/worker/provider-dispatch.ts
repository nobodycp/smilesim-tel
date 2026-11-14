import type IORedis from 'ioredis';
import type { PrismaClient } from '../generated/prisma/client';
import { AUTH_STORE, type AuthStore } from '../modules/auth/auth.store';
import { UnitOfWork } from '../modules/platform/unit-of-work';
import { ActivationSettlement } from '../modules/sales/settlement/activation-settlement';
import { NoticeService } from '../modules/notifications/notice.service';
import type { NoticeWriter } from '../modules/platform/notices';
import { OutboxRelay } from '../modules/office/outbox/outbox-relay';
import { OutboxRepository } from '../modules/office/outbox/outbox.repository';
import { QueuePublisher } from '../modules/office/outbox/queue-publisher';
import type { SendGate } from '../modules/providers/integration/dispatch/dispatch-gate';
import { OperationDispatcher, WaitingPass, recoverExpired } from '../modules/providers/integration/operations/operation-dispatcher';
import { OPERATION_REQUESTED, OPERATION_SETTLED } from '../modules/providers/integration/operations/provider-operations.repository';
import { ProviderOperationsService } from '../modules/providers/integration/operations/provider-operations.service';
import { errorCode, logger } from '../modules/platform/log';
import { composeWorker } from './composition';

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
 * The settlement of provider verdicts with the services it writes through, composed from the worker's one
 * description (`composition.ts`, slice R.5): the classes the API's modules build, from the same constructors. The
 * worker hands in its unit of work, the operations service it built (one in the whole graph) and an auth store it
 * never reads.
 */
export function buildActivationSettlement(uow: UnitOfWork, operations: ProviderOperationsService): ActivationSettlement {
  return composeWorker(ActivationSettlement, new Map<unknown, unknown>([[UnitOfWork, uow], [ProviderOperationsService, operations], [AUTH_STORE, NO_SESSIONS]]));
}

/** What a failed job leaves in the queue: a code and no stack. */
export class JobFailure extends Error {
  constructor(code: string) {
    super(`provider-operation job failed: ${code}`);
    this.name = 'JobFailure';
    this.stack = undefined;
  }
}

/** The pieces the worker runs for provider operations: the worker is not a Nest application (`composition.ts`). */
/**
 * `gate` is required (ADR 0019, D18): every attempt is taken and marked through it, and sent through the permit
 * it gives at the mark. The worker passes its deployment's gate (`DeploymentSendGate`); there is no default and
 * no gateway here, so nothing sends ungated or through anything the gate did not judge.
 */
export function buildProviderDispatch(prisma: PrismaClient, connection: IORedis, gate: SendGate, prefix?: string, notice?: NoticeWriter) {
  // The worker's notice writer: the same implementation the API's NoticeWriterModule provides, one for the worker
  // (built here because the unit of work no longer builds one; slice R.2). Specs hand in their own. A writer built
  // here is this dispatch's to close (`closeNotices`); one handed in is the caller's and is never closed here.
  let owned: NoticeService | null = notice ? null : new NoticeService();
  const uow = new UnitOfWork(notice ?? (owned as NoticeService));
  uow.prismaClient = prisma;
  const operations = composeWorker(ProviderOperationsService, new Map<unknown, unknown>([[UnitOfWork, uow]]));
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
    /**
     * Closes the Redis connections of the notice writer this dispatch built, once. The worker calls it last, after
     * its queues stopped and every job that was running finished, so no settlement publishes into a closed writer.
     */
    closeNotices: async () => {
      const writer = owned;
      owned = null;
      await writer?.close();
    },
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
  /** The rounds running now. Stopping waits for them, so nothing they write or publish meets a closed connection. */
  const running = new Set<Promise<unknown>>();
  const track = (round: Promise<unknown>) => {
    running.add(round);
    void round.finally(() => running.delete(round));
  };
  let relaying = false;
  const relay = setInterval(() => {
    if (relaying) return;
    relaying = true;
    track(parts.relay.runOnce().catch((error) => log.warn(`relay round failed: ${errorCode(error)}`)).finally(() => { relaying = false; }));
  }, RELAY_EVERY_MS);
  let recovering = false;
  const recovery = setInterval(() => {
    if (recovering) return;
    recovering = true;
    // Attempts whose worker is gone, then the operations a closed gate left waiting: each goes through the gate
    // again, so a provider that was resumed sends what waited and a paused one still sends nothing.
    // Recovery is given the gate: an unsent attempt found while its provider is closed is not counted.
    track(recoverExpired(parts.operations, new Date(), 100, parts.gate)
      .then(() => parts.waiting.round())
      .catch((error) => log.warn(`recovery failed: ${errorCode(error)}`))
      .finally(() => { recovering = false; }));
  }, RECOVERY_EVERY_MS);
  let sweeping = false;
  const sweep = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    track(parts.settlement.applyPending().catch((error) => log.warn(`settlement sweep failed: ${errorCode(error)}`)).finally(() => { sweeping = false; }));
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
    parts.settlement.stopSweeping();
    // The round in flight finishes what it holds (a settlement and the notices it publishes after its commit, a
    // relay publish): each stops at its next step and is bounded by its own timeouts. Then the queues close.
    await Promise.allSettled([...running]);
    await parts.publisher.close();
  };
}

/** What a worker lets go of when it stops, and in which order (`worker.ts` calls the answer on SIGTERM and SIGINT). */
export type WorkerShutdownParts = {
  readiness: { stop: () => Promise<void> };
  stopTimers: () => Promise<void>;
  queues: readonly { close: () => Promise<void> }[];
  closeNotices: () => Promise<void>;
  /** The database and the Redis connections, last. */
  release: () => Promise<void>;
};

/**
 * The worker's stop (slice R.2.1). Everything that starts new work is told to stop **at once**, in the same turn:
 * the readiness loop, the relay, recovery and sweep timers (each stop clears its timer before it waits for
 * anything), and the queues (BullMQ stops taking jobs when `close` is called). Only then does anything wait: the
 * readiness round in flight and the removal of this worker's rows, the timers' rounds in flight and then the
 * queue publisher, the queues' running jobs. After all of them, the notice writer (no settlement is left to
 * publish), then the database and Redis.
 *
 * Before R.2.1 the readiness stop was awaited before the timers were told: while a slow readiness round finished,
 * the timers kept firing and started new relay, recovery and sweep rounds (`worker-shutdown-race.spec.ts`).
 *
 * Asked twice (SIGTERM, then SIGINT), it lets go of everything once: the second call gets the first one's promise.
 */
export function workerShutdown(parts: WorkerShutdownParts): () => Promise<void> {
  let stopping: Promise<void> | null = null;
  return () => {
    stopping ??= (async () => {
      await Promise.all([parts.readiness.stop(), parts.stopTimers(), ...parts.queues.map((queue) => queue.close())]);
      await parts.closeNotices();
      await parts.release();
    })();
    return stopping;
  };
}


