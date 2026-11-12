import { errorCode, logger, reason } from './modules/shared/log';
import { env, isProduction, providerDispatchOn } from './config';
import 'reflect-metadata';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { createPrismaClient } from './db';
import { purgeActivity } from './modules/office/activity/activity-log';
import { SimulatedProviderGateway } from './modules/office/providers/gateway/simulated-gateway';
import { OPERATIONS_QUEUE, SETTLEMENTS_QUEUE, buildProviderDispatch, startProviderDispatchTimers } from './provider-dispatch';

const log = logger('Worker');

export type WorkerProcessor = { queue: string; handle: (data: unknown) => Promise<void> };

// Processors that always run. The provider dispatcher is added in `run` when it is switched on.
export const backgroundProcessors: WorkerProcessor[] = [];

export async function run(): Promise<void> {
  const url = env('REDIS_URL');
  if (!url) throw new Error('REDIS_URL is required');

  // BullMQ requires maxRetriesPerRequest to be null on its blocking connections.
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  connection.on('error', (error) => log.error(`redis: ${error.message}`));

  // Provider operations: off unless PROVIDER_DISPATCH=1, and off in production whatever it says. The gateway is
  // the simulated one, which sends nothing: a recorded operation goes back to `requested` and then fails.
  const processors = [...backgroundProcessors];
  let stopDispatch: (() => Promise<void>) | null = null;
  let dispatchPrisma: ReturnType<typeof createPrismaClient> | null = null;
  let relayRedis: IORedis | null = null;
  if (providerDispatchOn()) {
    dispatchPrisma = createPrismaClient();
    // The relay publishes on its own connection: it must fail fast when Redis is away, the workers must not.
    relayRedis = new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    relayRedis.on('error', (error) => log.error(`redis (relay): ${errorCode(error)}`));
    const dispatch = buildProviderDispatch(dispatchPrisma, relayRedis, new SimulatedProviderGateway());
    processors.push({ queue: OPERATIONS_QUEUE, handle: dispatch.handle });
    // Verdicts are acted on by their own queue (ADR 0019, D8): it writes the line and the money, and calls nobody.
    processors.push({ queue: SETTLEMENTS_QUEUE, handle: dispatch.settle });
    stopDispatch = startProviderDispatchTimers(dispatch);
    log.log('provider dispatch: on');
  } else if (isProduction() && env('PROVIDER_DISPATCH')) {
    log.warn('provider dispatch: PROVIDER_DISPATCH is set but the dispatcher never runs in production');
  }

  const workers = processors.map(
    (processor) => new Worker(processor.queue, (job) => processor.handle(job.data), { connection }),
  );

  const purge = async () => {
    const prisma = createPrismaClient();
    try {
      const removed = await purgeActivity(prisma);
      if (removed > 0) log.log(`activity purge: ${removed}`);
    } catch (error) {
      log.error(`activity purge: ${reason(error)}`);
    } finally {
      await prisma.$disconnect();
    }
  };
  await purge();
  const purgeTimer = setInterval(() => void purge(), 24 * 60 * 60 * 1000);
  purgeTimer.unref?.();

  // The open Redis connection keeps the process alive, so the container does not restart.
  log.log(`ready: ${workers.length} processors`);

  const stop = async () => {
    await stopDispatch?.();
    await Promise.all(workers.map((worker) => worker.close()));
    await dispatchPrisma?.$disconnect();
    relayRedis?.disconnect();
    connection.disconnect();
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
}

// Only the container entry point starts the worker; importing this file opens nothing.
if (require.main === module) {
  run().catch((error) => {
    log.error(reason(error));
    process.exit(1);
  });
}
