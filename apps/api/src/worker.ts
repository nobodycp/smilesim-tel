import 'reflect-metadata';
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { createPrismaClient } from './db';
import { purgeBefore } from './modules/office/activity-log';

export type WorkerProcessor = { queue: string; handle: (data: unknown) => Promise<void> };

// The login release has no background jobs. A later feature appends processors here.
export const backgroundProcessors: WorkerProcessor[] = [];

export async function run(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required');

  // BullMQ requires maxRetriesPerRequest to be null on its blocking connections.
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  connection.on('error', (error) => console.error('worker redis error:', error.message));

  const workers = backgroundProcessors.map(
    (processor) => new Worker(processor.queue, (job) => processor.handle(job.data), { connection }),
  );

  const purge = async () => {
    const prisma = createPrismaClient();
    try {
      const removed = await prisma.activityEvent.deleteMany({ where: { at: { lt: purgeBefore() } } });
      if (removed.count > 0) console.log(`activity purge: ${removed.count}`);
    } catch (error) {
      console.error('activity purge:', error instanceof Error ? error.message : error);
    } finally {
      await prisma.$disconnect();
    }
  };
  await purge();
  const purgeTimer = setInterval(() => void purge(), 24 * 60 * 60 * 1000);
  purgeTimer.unref?.();

  // The open Redis connection keeps the process alive, so the container does not restart.
  console.log(`worker ready: ${workers.length} processors`);

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
    console.error(error);
    process.exit(1);
  });
}
