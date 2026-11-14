import { errorCode, logger, reason } from './modules/shared/log';
import { env, wholeEnv } from './config';
import 'reflect-metadata';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { createPrismaClient } from './db';
import { purgeActivity } from './modules/auditing/activity-log';
import { DeploymentSendGate } from './modules/office/providers/dispatch/dispatch-gate';
import { dispatchSettings } from './modules/office/providers/dispatch/dispatch-policy';
import { buildAdapters } from './modules/office/providers/dispatch/provider-adapters';
import { RoutingProviderGateway } from './modules/office/providers/dispatch/routing-gateway';
import { assertWorkerConfig } from './production-config';
import { OPERATIONS_QUEUE, SETTLEMENTS_QUEUE, buildProviderDispatch, readCredentials, startProviderDispatchTimers, startReadiness } from './provider-dispatch';

const log = logger('Worker');

export type WorkerProcessor = { queue: string; handle: (data: unknown) => Promise<void> };

// Processors that always run, beside the two of provider operations that `run` adds.
export const backgroundProcessors: WorkerProcessor[] = [];

export async function run(): Promise<void> {
  // Before anything is opened (ADR 0019, D18): a production worker that is set up unsafely does not start.
  const environment = wholeEnv();
  assertWorkerConfig(environment);
  const settings = dispatchSettings(environment);

  const url = env('REDIS_URL');
  if (!url) throw new Error('REDIS_URL is required');

  // BullMQ requires maxRetriesPerRequest to be null on its blocking connections.
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  connection.on('error', (error) => log.error(`redis: ${error.message}`));

  // Provider operations (ADR 0018, ADR 0019). Two halves, kept apart on purpose:
  // - SETTLING what was sent (the relay, the settlements queue, recovery, the sweeper) always runs: switching
  //   sending off, or pausing a provider, never strands a result that is on its way or a verdict not acted on.
  // - SENDING goes through the deployment's gate, which is closed unless the four conditions of D18 hold for the
  //   provider **and** this worker built an adapter for it. This build has no adapter (S.12b adds the first), so
  //   nothing is built, nothing is attested and nothing is sent, whatever the settings say.
  const processors = [...backgroundProcessors];
  const dispatchPrisma = createPrismaClient();
  // The relay publishes on its own connection: it must fail fast when Redis is away, the workers must not.
  const relayRedis = new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  relayRedis.on('error', (error) => log.error(`redis (relay): ${errorCode(error)}`));
  // Every adapter is built from the credentials as they are stored at that moment; `startReadiness` builds them
  // again when one is written, so no adapter outlives the credential it was given.
  const rebuild = async () => buildAdapters(settings, await readCredentials(dispatchPrisma, settings));
  const built = await rebuild();
  const gateway = new RoutingProviderGateway(built);
  const dispatch = buildProviderDispatch(dispatchPrisma, relayRedis, new DeploymentSendGate(settings, (code) => gateway.sender(code)));
  processors.push({ queue: OPERATIONS_QUEUE, handle: dispatch.handle });
  // Verdicts are acted on by their own queue (ADR 0019, D8): it writes the line and the money, and calls nobody.
  processors.push({ queue: SETTLEMENTS_QUEUE, handle: dispatch.settle });
  const stopTimers = startProviderDispatchTimers(dispatch);
  const readiness = startReadiness(dispatchPrisma, settings, gateway, rebuild);
  const stopDispatch = async () => {
    await readiness.stop();
    await stopTimers();
  };
  // Codes only: which providers have an adapter, and why each named one has none. Never a credential.
  for (const [code, why] of built.skipped) log.warn(`provider dispatch: no adapter for ${code} (${why})`);
  log.log(`provider dispatch: settling on; sending ${built.adapters.size > 0 ? `on for ${[...built.adapters.keys()].join(', ')} (${settings.target}, ${settings.deployment})` : 'off (no adapter built)'}`);

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

  // In order: no new round or job (the timers, then the queues, which wait for the jobs that are running), then the
  // notice writer this worker built (after the last settlement published), then the database and Redis.
  const stop = async () => {
    await stopDispatch();
    await Promise.all(workers.map((worker) => worker.close()));
    await dispatch.closeNotices();
    await dispatchPrisma.$disconnect();
    relayRedis.disconnect();
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
