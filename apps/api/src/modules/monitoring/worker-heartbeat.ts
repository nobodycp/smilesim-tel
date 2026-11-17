import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client';
import { errorCode, logger } from '../platform';
import { HEARTBEAT_EVERY_MS } from './thresholds';

const log = logger('WorkerHeartbeat');

/** A row this old is any worker's to remove: long past `down`, its worker is gone. */
const FORGET_AFTER_S = 24 * 60 * 60;

/**
 * The worker's heartbeat (system monitor M.5): its own row in `WorkerHeartbeat`, written at once and then every
 * `HEARTBEAT_EVERY_MS`, its time by the database's clock (`now()`), so the status reads the age on the same clock
 * whatever the two machines' clocks say. One beat at a time: a slow one is not overtaken by the next tick. Each beat
 * also writes the worker's own Node.js (`process.version`, M.11), which the versions page reads: the API cannot
 * read another process's runtime.
 *
 * Stopping clears the timer and waits for the beat in flight; the row is left, to go stale. So the status says how
 * long ago the worker was last seen (`warn` after 60 s, `down` after 3 min) instead of no worker at all for a few
 * seconds while a deployment replaces it. Run by the worker's composition (`worker.ts`), stopped by `workerShutdown`.
 */
export function startHeartbeat(prisma: Pick<PrismaClient, '$executeRaw'>, workerId: string = randomUUID(), everyMs: number = HEARTBEAT_EVERY_MS) {
  let stopped = false;
  let running: Promise<void> | null = null;
  const once = async () => {
    await prisma.$executeRaw`
      INSERT INTO "WorkerHeartbeat" ("workerId", "startedAt", "beatAt", "nodeVersion") VALUES (${workerId}, now(), now(), ${process.version})
      ON CONFLICT ("workerId") DO UPDATE SET "beatAt" = now(), "nodeVersion" = ${process.version}`;
    await prisma.$executeRaw`DELETE FROM "WorkerHeartbeat" WHERE "beatAt" < now() - make_interval(secs => ${FORGET_AFTER_S})`;
  };
  const beat = () => {
    if (stopped) return Promise.resolve();
    running ??= once().catch((error) => log.warn(`heartbeat not written: ${errorCode(error)}`)).finally(() => { running = null; });
    return running;
  };
  void beat();
  const timer = setInterval(() => void beat(), everyMs);
  timer.unref?.();
  return {
    workerId,
    beat,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
