import { logger, reason } from './modules/shared/log';
import { env } from './config';
import 'reflect-metadata';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { createPrismaClient } from './db';
import { purgeBefore } from './modules/office/activity-log';

const log = logger('Worker');

export type WorkerProcessor = { queue: string; handle: (data: unknown) => Promise<void> };

// The login release has no background jobs. A later feature appends processors here.
export const backgroundProcessors: WorkerProcessor[] = [];

export async function run(): Promise<void> {
  const url = env('REDIS_URL');
  if (!url) throw new Error('REDIS_URL is required');

  // BullMQ requires maxRetriesPerRequest to be null on its blocking connections.
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  connection.on('error', (error) => log.error(`redis: ${error.message}`));

  const workers = backgroundProcessors.map(
    (processor) => new Worker(processor.queue, (job) => processor.handle(job.data), { connection }),
  );

  const purge = async () => {
    const prisma = createPrismaClient();
    try {
      const removed = await prisma.activityEvent.deleteMany({ where: { at: { lt: purgeBefore() } } });
      if (removed.count > 0) log.log(`activity purge: ${removed.count}`);
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
    await Promise.all(workers.map((worker) => worker.close()));
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
