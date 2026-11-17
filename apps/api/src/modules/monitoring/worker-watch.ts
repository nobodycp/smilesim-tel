import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { UnitOfWork, env, errorCode, isTest, logger } from '../platform';
import { openAlert } from './alert-pass';
import { AlertRepository } from './alert.repository';
import { planRound, serviceDownRule, workerDownSpell } from './alert-rules';
import { within } from './probe-time';
import { StatusRepository } from './status.repository';
import { PROBE_TIMEOUT_MS, WORKER_WATCH_EVERY_MS } from './thresholds';

const log = logger('WorkerWatch');

/** The heartbeat as the watch reads it: the age of the latest beat in seconds, null when no worker ever beat. */
export type HeartbeatReader = () => Promise<{ lastBeatAgeS: number | null }>;

/**
 * The API's look at the worker (spec 2026-11-17-system-monitor, section 6; slice M.9). The worker runs the alert
 * pass, so a worker that is down cannot warn of itself: the API reads the heartbeat (the status's own read and its
 * own `down` limit) and opens "a service is down" for `worker` through the pass's own `openAlert`, so the partial
 * unique index keeps one open alert and its one notice whatever the number of API copies, the worker's own pass
 * included. While the worker stays down each look raises the open alert's `lastAt` by the pass's rule for a state
 * (`planRound`). It never closes: that stays the pass's, 30 quiet minutes once the worker is back.
 */
export class WorkerWatch {
  constructor(
    private readonly repo: AlertRepository,
    private readonly uow: UnitOfWork,
    private readonly heartbeat: HeartbeatReader,
    private readonly apiUptimeS: () => number = () => process.uptime(),
  ) {}

  /** One look: `opened` (this look opened the alert and told the owners), `raised`, or `none`. */
  async check(now: Date = new Date()): Promise<'opened' | 'raised' | 'none'> {
    const beat = await within(PROBE_TIMEOUT_MS, this.heartbeat);
    const spell = workerDownSpell(beat, this.apiUptimeS(), now);
    if (!spell) return 'none';
    const [finding] = serviceDownRule([spell]);
    const open = (await this.repo.openAlerts()).filter((alert) => alert.kind === finding.kind && alert.key === finding.key);
    const plan = planRound(open, [finding], now);
    for (const opening of plan.open) if (await openAlert(this.repo, this.uow, opening)) return 'opened';
    for (const raise of plan.raise) await this.repo.raise(raise.id, raise.add, raise.lastAt);
    return plan.raise.length > 0 ? 'raised' : 'none';
  }
}

/**
 * Runs a watch every `everyMs`, one look at a time (a slow one is not overtaken by the next tick); the first look
 * after one period. A failing look logs a code and never throws. The timer does not keep the process alive; `stop`
 * clears it and waits for the look in flight.
 */
export function startWorkerWatch(watch: Pick<WorkerWatch, 'check'>, everyMs: number = WORKER_WATCH_EVERY_MS) {
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (stopped) return Promise.resolve();
    running ??= watch
      .check()
      .then((done) => {
        if (done === 'opened') log.warn('the worker is down: alert opened');
      })
      .catch((error) => log.warn(`worker watch failed: ${errorCode(error)}`))
      .finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref?.();
  return {
    tick,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

/**
 * The watch as the API runs it: started with the module, stopped with it. Off under tests and without a database,
 * like the API's other timers (the line snapshots, the provider watch): a spec builds a `WorkerWatch` of its own.
 */
@Injectable()
export class WorkerWatchService implements OnModuleInit, OnModuleDestroy {
  private running: ReturnType<typeof startWorkerWatch> | null = null;

  constructor(private readonly repo: AlertRepository, private readonly uow: UnitOfWork, private readonly status: StatusRepository) {}

  onModuleInit() {
    if (isTest() || !env('DATABASE_URL')) return;
    this.running = startWorkerWatch(new WorkerWatch(this.repo, this.uow, () => this.status.heartbeat()));
  }

  async onModuleDestroy() {
    await this.running?.stop();
    this.running = null;
  }
}
