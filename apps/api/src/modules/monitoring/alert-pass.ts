import { SYSTEM_SENDER_NAME, UnitOfWork, errorCode, logger, type NoticeActor } from '../platform';
import { AlertRepository } from './alert.repository';
import { addressSignInsOf, findAlerts, planRound, signInFailuresOf, wrongCodesOf, type AlertFinding, type Counted, type DownSpell } from './alert-rules';
import { within } from './probe-time';
import { StatusRedis } from './status-redis';
import { StatusRepository } from './status.repository';
import { judgeOutbox, judgeWorker } from './status.rules';
import {
  ACCOUNT_LOCK_WINDOW_MINUTES, ALERT_PASS_EVERY_MS, CRACKING_WINDOW_MINUTES, FAILING_WINDOW_MINUTES, MANY_ACCOUNTS_WINDOW_MINUTES,
  PERMISSION_WINDOW_MINUTES, PROBE_TIMEOUT_MS, PROBING_WINDOW_MINUTES, RATE_LIMIT_WINDOW_MINUTES, SECOND_STEP_WINDOW_MINUTES,
  SLOW_WINDOW_MINUTES, WRONG_DOOR_WINDOW_MINUTES,
} from './thresholds';

const log = logger('AlertPass');

/** The sender of the system's own notices: no account. The monitor's notices (alerts, versions) are all from it. */
export const SYSTEM: NoticeActor = { id: 'system', nickname: SYSTEM_SENDER_NAME };

/** The parts whose being down is an alert (spec section 4, "a service is down"). */
export const WATCHED_PARTS = ['worker', 'postgres', 'redis', 'outbox'] as const;
type WatchedPart = (typeof WATCHED_PARTS)[number];

/** Which watched parts are down now. A probe that fails or hangs is a part that is down. */
export type PartsProbe = () => Promise<Record<WatchedPart, boolean>>;

/**
 * The parts as the system status judges them (`status.rules.ts`), each under the probe's time limit: the worker by
 * its heartbeat, PostgreSQL by `SELECT 1`, Redis by `PING` (never down when the deployment names none), the outbox
 * by its oldest message. The same probes as `GET /v1/system/status`, not written twice.
 */
export function partsProbe(status: Pick<StatusRepository, 'heartbeat' | 'ping' | 'outbox'>, redis: Pick<StatusRedis, 'configured' | 'ping'>, timeoutMs = PROBE_TIMEOUT_MS): PartsProbe {
  const down = async (run: () => Promise<boolean>) => {
    try {
      return await within(timeoutMs, run);
    } catch {
      return true;
    }
  };
  return async () => {
    const [worker, postgres, redisDown, outbox] = await Promise.all([
      down(async () => judgeWorker(await status.heartbeat()).state === 'down'),
      down(async () => (await status.ping(), false)),
      down(async () => (redis.configured() ? (await redis.ping(), false) : false)),
      down(async () => judgeOutbox(await status.outbox()).state === 'down'),
    ]);
    return { worker, postgres, redis: redisDown, outbox };
  };
}

const minutesBefore = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

/**
 * One round of the early warnings (spec section 4; slice M.6): count the last minutes of the request log and the
 * activity log, judge them by the ten rules (`alert-rules.ts`), and against the open alerts open new ones, raise
 * those passed again and close those quiet for 30 minutes. A new alert is opened and told to the branch owners in
 * one transaction, once: an open alert only raised tells no one.
 *
 * The parts that are down are remembered here between rounds (`DownSpell`), so that "down for 2 minutes" is seen
 * across rounds, and so that PostgreSQL down, which no round can write while it lasts, is written by the first
 * round after it answers again. A spell is forgotten after a round that wrote and found its part up.
 */
export class AlertPass {
  private readonly spells = new Map<WatchedPart, DownSpell>();

  constructor(private readonly repo: AlertRepository, private readonly uow: UnitOfWork, private readonly probe: PartsProbe) {}

  async round(now: Date = new Date()): Promise<{ opened: number; raised: number; closed: number }> {
    const down = await this.probe();
    for (const part of WATCHED_PARTS) {
      if (!down[part]) continue;
      const spell = this.spells.get(part) ?? { part, since: now, lastDownAt: now };
      this.spells.set(part, { ...spell, lastDownAt: now });
    }
    const [counted, open] = await Promise.all([this.count(now), this.repo.openAlerts()]);
    const plan = planRound(open, findAlerts(counted), now);
    let opened = 0;
    for (const finding of plan.open) if (await this.open(finding)) opened += 1;
    for (const raise of plan.raise) await this.repo.raise(raise.id, raise.add, raise.lastAt);
    const closed = await this.repo.close(plan.close, now);
    for (const part of WATCHED_PARTS) if (!down[part]) this.spells.delete(part);
    return { opened, raised: plan.raise.length, closed };
  }

  private async count(now: Date): Promise<Counted> {
    const since = (minutes: number) => minutesBefore(now, minutes);
    const signInSince = since(Math.max(ACCOUNT_LOCK_WINDOW_MINUTES, CRACKING_WINDOW_MINUTES, MANY_ACCOUNTS_WINDOW_MINUTES));
    const [signIns, wrongCodeRows, rateLimited, probeAnswers, doorRefusals, permissionRefusals, requestFailures, routeCrashes, requestSpeed] = await Promise.all([
      this.repo.signInFailureRows(signInSince),
      this.repo.wrongCodeRows(since(SECOND_STEP_WINDOW_MINUTES)),
      this.repo.rateLimited(since(RATE_LIMIT_WINDOW_MINUTES)),
      this.repo.probeAnswers(since(PROBING_WINDOW_MINUTES)),
      this.repo.doorRefusals(since(WRONG_DOOR_WINDOW_MINUTES)),
      this.repo.permissionRefusals(since(PERMISSION_WINDOW_MINUTES)),
      this.repo.requestFailures(since(FAILING_WINDOW_MINUTES)),
      this.repo.routeCrashes(since(FAILING_WINDOW_MINUTES)),
      this.repo.requestSpeed(since(SLOW_WINDOW_MINUTES)),
    ]);
    // One read of the refused sign-ins serves both rules, each held to its own window: cracking over the longer of
    // its two (the lock's 15 min, the failures' 10), counting failures within the 10; many accounts over its 10.
    const crackingSince = since(Math.max(ACCOUNT_LOCK_WINDOW_MINUTES, CRACKING_WINDOW_MINUTES));
    const manySince = since(MANY_ACCOUNTS_WINDOW_MINUTES);
    return {
      signInFailures: signInFailuresOf(signIns.filter((row) => row.at > crackingSince), since(CRACKING_WINDOW_MINUTES)),
      addressSignIns: addressSignInsOf(signIns.filter((row) => row.at > manySince)),
      wrongCodes: wrongCodesOf(wrongCodeRows),
      rateLimited, probeAnswers, doorRefusals, permissionRefusals, requestFailures, routeCrashes, requestSpeed, downSpells: [...this.spells.values()] };
  }

  private open(finding: AlertFinding): Promise<boolean> {
    return openAlert(this.repo, this.uow, finding);
  }
}

/**
 * Opens one alert and writes its notice to every branch owner, in one transaction; false when it was open already.
 * The one way an alert is opened, by the worker's pass and by the API's watch on the worker (M.9) alike: the partial
 * unique index lets one of any number of racing openers in, and only that one tells the owners.
 */
export function openAlert(repo: AlertRepository, uow: UnitOfWork, finding: AlertFinding): Promise<boolean> {
  return uow.runTx(async (tx) => {
    const alertId = await repo.open(tx, finding);
    if (!alertId) return false;
    const owners = (await repo.branchOwners(tx)).map((owner) => owner.id);
    // Names, never the account's id: the bell shows the login name.
    const { loginName, ip, method, route, path, part, detail } = finding.subject;
    const payload = { alertId, alertKind: finding.kind, loginName, ip, method, route, path, part, detail, count: finding.count };
    uow.queueNotices(tx, await uow.notice.write(tx, owners, SYSTEM, { kind: 'system.alert', payload }));
    return true;
  });
}

/**
 * Runs the pass in the worker (one place, whatever the number of API copies): a round at once and then every
 * `ALERT_PASS_EVERY_MS`, one round at a time (a slow one is not overtaken by the next tick). A failing round logs
 * a code and the next tick tries again; it never stops the worker. Built on the worker's unit of work (its client
 * and its notice writer), with a Redis connection of its own for the probe, closed by `stop`, which clears the timer
 * and waits for the round in flight. Run by `worker.ts`, stopped by `workerShutdown`.
 */
export function startAlertPass(uow: UnitOfWork, everyMs: number = ALERT_PASS_EVERY_MS, pass?: AlertPass) {
  const redis = new StatusRedis();
  const alerts = pass ?? new AlertPass(new AlertRepository(uow), uow, partsProbe(new StatusRepository(uow), redis));
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (stopped) return Promise.resolve();
    running ??= alerts
      .round()
      .then(({ opened, closed }) => {
        if (opened > 0 || closed > 0) log.log(`alerts: ${opened} opened, ${closed} closed`);
      })
      .catch((error) => log.warn(`alert round failed: ${errorCode(error)}`))
      .finally(() => { running = null; });
    return running;
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref?.();
  return {
    tick,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
      await redis.onModuleDestroy();
    },
  };
}
