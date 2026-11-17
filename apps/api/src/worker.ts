import { errorCode, logger, reason } from './modules/platform/log';
import { env, wholeEnv } from './config';
import 'reflect-metadata';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { createPrismaClient } from './db';
import { purgeActivity } from './modules/auditing/activity-log';
import { purgeSessions } from './modules/auth/session-retention';
import { purgeNotices } from './modules/notifications/notice-retention';
import { purgeOutbox } from './modules/providers/integration/operations/outbox-retention';
import { purgeLineSnapshots } from './modules/reporting/desk/line-snapshot-retention';
import { DeploymentSendGate } from './modules/providers/integration/dispatch/dispatch-gate';
import { dispatchSettings } from './modules/providers/integration/dispatch/dispatch-policy';
import { buildAdapters } from './modules/providers/integration/dispatch/provider-adapters';
import { RoutingProviderGateway } from './modules/providers/integration/dispatch/routing-gateway';
import { assertWorkerConfig } from './production-config';
import { OPERATIONS_QUEUE, SETTLEMENTS_QUEUE, buildProviderDispatch, startProviderDispatchTimers, workerShutdown } from './worker/provider-dispatch';
import { readCredentials, startReadiness } from './modules/providers/integration/dispatch/worker-readiness';
import { startHeartbeat } from './modules/monitoring/worker-heartbeat';
import { startAlertPass } from './modules/monitoring/alert-pass';
import { purgeMonitoring } from './modules/monitoring/retention';
import { startVersionCheck } from './modules/monitoring/version-check';

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
  const dispatchPrisma = createPrismaClient('worker');
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
  // The readiness loop attests through the dispatch's unit of work, on the same client (slice R.5).
  const readiness = startReadiness(dispatch.uow, settings, gateway, rebuild);
  // The system status reads the worker's age from this row (system monitor M.5), on the dispatch's client.
  const heartbeat = startHeartbeat(dispatchPrisma);
  // The early warnings (system monitor M.6), every 30 s here and nowhere else: on the dispatch's unit of work (its
  // client and its notice writer), apart from the money path.
  const alerts = startAlertPass(dispatch.uow);
  // Codes only: which providers have an adapter, and why each named one has none. Never a credential.
  for (const [code, why] of built.skipped) log.warn(`provider dispatch: no adapter for ${code} (${why})`);
  log.log(`provider dispatch: settling on; sending ${built.adapters.size > 0 ? `on for ${[...built.adapters.keys()].join(', ')} (${settings.target}, ${settings.deployment})` : 'off (no adapter built)'}`);

  const workers = processors.map(
    (processor) => new Worker(processor.queue, (job) => processor.handle(job.data), { connection }),
  );

  const purge = async () => {
    // A small client of its own (two connections, the worker's statement limit: `db.ts`), closed after the purge.
    const prisma = createPrismaClient('purge');
    // The retention of each table (plan DB.13, `platform/retention.ts`), each in its own try, so a failure of one
    // does not stop the others. Counts only, never a row's content.
    const retention: [string, () => Promise<string | null>][] = [
      ['activity', async () => { const n = await purgeActivity(prisma); return n > 0 ? `${n}` : null; }],
      ['notice', async () => { const n = await purgeNotices(prisma); return n.read + n.unread > 0 ? `${n.read} read, ${n.unread} unread` : null; }],
      ['session', async () => { const n = await purgeSessions(prisma); return n > 0 ? `${n}` : null; }],
      ['outbox', async () => { const n = await purgeOutbox(prisma); return n > 0 ? `${n}` : null; }],
      ['line-count', async () => { const n = await purgeLineSnapshots(prisma); return n > 0 ? `${n}` : null; }],
    ];
    for (const [table, run] of retention) {
      try {
        const counts = await run();
        if (counts) log.log(`${table} purge: ${counts}`);
      } catch (error) {
        log.error(`${table} purge: ${errorCode(error)}`);
      }
    }
    // The system monitor's tables (M.8): its own try, so a failure of either purge does not stop the other. Counts only.
    try {
      const purged = await purgeMonitoring(prisma);
      if (purged.requests + purged.errors + purged.alerts > 0) log.log(`monitoring purge: ${purged.requests} requests, ${purged.errors} errors, ${purged.alerts} alerts`);
    } catch (error) {
      log.error(`monitoring purge: ${errorCode(error)}`);
    } finally {
      await prisma.$disconnect();
    }
  };
  await purge();
  const purgeTimer = setInterval(() => void purge(), 24 * 60 * 60 * 1000);
  purgeTimer.unref?.();
  // The versions page's daily check (system monitor M.11), beside the purge and apart from it: its own timers, its
  // own failures (logged by code), first run shortly after the start without holding it up; on the dispatch's unit
  // of work for its one notice. `VERSION_CHECK=off` calls nothing.
  const versions = startVersionCheck(dispatch.uow);
  // The monitor's two timers on the dispatch's unit of work stop together, before its notice writer closes.
  const monitor = { stop: async () => void (await Promise.all([alerts.stop(), versions.stop()])) };

  // The open Redis connection keeps the process alive, so the container does not restart.
  log.log(`ready: ${workers.length} processors`);

  const stop = workerShutdown({
    readiness,
    heartbeat,
    alerts: monitor,
    stopTimers,
    queues: workers,
    closeNotices: dispatch.closeNotices,
    release: async () => {
      await dispatchPrisma.$disconnect();
      relayRedis.disconnect();
      connection.disconnect();
    },
  });
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
