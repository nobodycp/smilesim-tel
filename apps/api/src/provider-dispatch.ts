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
import type { ProviderGateway } from './modules/office/providers/gateway/provider-gateway';
import { OperationDispatcher, recoverExpired } from './modules/office/providers/operations/operation-dispatcher';
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
export function buildProviderDispatch(prisma: PrismaClient, connection: IORedis, gateway: ProviderGateway, prefix?: string, notice?: NoticeService) {
  const uow = new UnitOfWork(notice);
  uow.prismaClient = prisma;
  const operations = new ProviderOperationsService(uow, new ProviderOperationsRepository());
  const publisher = new QueuePublisher(connection, { [OPERATION_REQUESTED]: OPERATIONS_QUEUE, [OPERATION_SETTLED]: SETTLEMENTS_QUEUE }, prefix);
  const dispatcher = new OperationDispatcher(operations, gateway);
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
    relay: new OutboxRelay(uow, new OutboxRepository(), publisher, [OPERATION_REQUESTED, OPERATION_SETTLED]),
    dispatcher,
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
export function startProviderDispatchTimers(parts: Pick<ReturnType<typeof buildProviderDispatch>, 'relay' | 'operations' | 'publisher' | 'settlement'>): () => Promise<void> {
  let relaying = false;
  const relay = setInterval(() => {
    if (relaying) return;
    relaying = true;
    void parts.relay.runOnce().catch((error) => log.warn(`relay round failed: ${errorCode(error)}`)).finally(() => { relaying = false; });
  }, RELAY_EVERY_MS);
  const recovery = setInterval(() => void recoverExpired(parts.operations).catch((error) => log.warn(`recovery failed: ${errorCode(error)}`)), RECOVERY_EVERY_MS);
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
    await parts.publisher.close();
  };
}
