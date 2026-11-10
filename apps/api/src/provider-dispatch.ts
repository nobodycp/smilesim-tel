import type IORedis from 'ioredis';
import type { PrismaClient } from './generated/prisma/client';
import { UnitOfWork } from './modules/office/kernel/unit-of-work';
import { OutboxRelay } from './modules/office/outbox/outbox-relay';
import { OutboxRepository } from './modules/office/outbox/outbox.repository';
import { QueuePublisher } from './modules/office/outbox/queue-publisher';
import type { ProviderGateway } from './modules/office/providers/gateway/provider-gateway';
import { OperationDispatcher, recoverExpired } from './modules/office/providers/operations/operation-dispatcher';
import { OPERATION_REQUESTED, ProviderOperationsRepository } from './modules/office/providers/operations/provider-operations.repository';
import { ProviderOperationsService } from './modules/office/providers/operations/provider-operations.service';
import { errorCode, logger } from './modules/shared/log';

const log = logger('ProviderDispatch');

export const OPERATIONS_QUEUE = 'provider-operations';
export const RELAY_EVERY_MS = 2_000;
export const RECOVERY_EVERY_MS = 30_000;

/** What a failed job leaves in the queue: a code and no stack. */
export class JobFailure extends Error {
  constructor(code: string) {
    super(`provider-operation job failed: ${code}`);
    this.name = 'JobFailure';
    this.stack = undefined;
  }
}

/** The pieces the worker runs for provider operations, built by hand: the worker is not a Nest application. */
export function buildProviderDispatch(prisma: PrismaClient, connection: IORedis, gateway: ProviderGateway, prefix?: string) {
  const uow = new UnitOfWork();
  uow.prismaClient = prisma;
  const operations = new ProviderOperationsService(uow, new ProviderOperationsRepository());
  const publisher = new QueuePublisher(connection, { [OPERATION_REQUESTED]: OPERATIONS_QUEUE }, prefix);
  const dispatcher = new OperationDispatcher(operations, gateway);
  return {
    uow,
    operations,
    publisher,
    relay: new OutboxRelay(uow, new OutboxRepository(), publisher, [OPERATION_REQUESTED]),
    dispatcher,
    /** The queue's processor: a job carries the operation's id and nothing else. */
    handle: async (data: unknown) => {
      const id = (data as { operationId?: unknown } | null)?.operationId;
      if (typeof id !== 'string') throw new Error('a provider-operation job carries no operation id');
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
export function startProviderDispatchTimers(parts: Pick<ReturnType<typeof buildProviderDispatch>, 'relay' | 'operations' | 'publisher'>): () => Promise<void> {
  let relaying = false;
  const relay = setInterval(() => {
    if (relaying) return;
    relaying = true;
    void parts.relay.runOnce().catch((error) => log.warn(`relay round failed: ${errorCode(error)}`)).finally(() => { relaying = false; });
  }, RELAY_EVERY_MS);
  const recovery = setInterval(() => void recoverExpired(parts.operations).catch((error) => log.warn(`recovery failed: ${errorCode(error)}`)), RECOVERY_EVERY_MS);
  relay.unref?.();
  recovery.unref?.();
  return async () => {
    clearInterval(relay);
    clearInterval(recovery);
    await parts.publisher.close();
  };
}
