import { totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { Injectable } from '@nestjs/common';
import { env, errorCode } from '../platform';
import { requireOwner, type Actor } from '../access';
import { ProviderHealthService } from '../providers';
import { RequestLogRepository } from './request-log.repository';
import { StatusRedis, MONITORED_QUEUES } from './status-redis';
import { StatusRepository } from './status.repository';
import { PROBE_TIMEOUT_MS, REQUESTS_WINDOW_MINUTES } from './thresholds';
import {
  judgeApi, judgeOutbox, judgePostgres, judgeProviders, judgeQueues, judgeRedis, judgeRequests, judgeSchema, judgeWorker, share, worst,
  type Judgement, type PartState,
} from './status.rules';

/** A part of the status: its state, why (a code), and the figures that say it; no figures when its probe failed. */
export type StatusPart<Name extends string, Figures> = { name: Name; state: PartState; note: string; figures: Figures | null };

/** A probe that took too long: its part is `down` with the note `timeout` (`errorCode` names it by this class's name). */
class ProbeTimeout extends Error {
  override name = 'TimeoutError';
}

/** `run`'s answer, or `ProbeTimeout` after `ms`. The probe left behind is not waited for: its answer is dropped. */
async function within<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([run(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new ProbeTimeout('probe')), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/** How long `run` took, in whole milliseconds. */
async function timed(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await run();
  return Math.round(performance.now() - started);
}

const MISSING_NAMED = 10;

/**
 * The system status (spec 2026-11-17-system-monitor, section 1; slice M.5): the nine parts, each a probe of its own
 * with its own time limit (`PROBE_TIMEOUT_MS`), all run beside each other, so a part that hangs or fails answers
 * `down` with its code and the others still answer. Nothing is stored; the branch owner alone reads it (D1).
 */
@Injectable()
export class StatusService {
  /** The time limit of each probe; a spec may shorten it. */
  timeoutMs = PROBE_TIMEOUT_MS;

  constructor(
    private readonly repo: StatusRepository,
    private readonly redis: StatusRedis,
    private readonly requests: RequestLogRepository,
    private readonly providers: ProviderHealthService,
  ) {}

  async status(actor: Actor) {
    requireOwner(actor);
    const parts = await Promise.all([
      this.probe('api', async () => this.api(), judgeApi),
      this.probe('worker', () => this.repo.heartbeat(), judgeWorker),
      this.probe('postgres', () => this.postgres(), judgePostgres),
      this.probe('redis', () => this.redisFigures(), judgeRedis),
      this.probe('queues', () => this.queues(), judgeQueues),
      this.probe('outbox', () => this.repo.outbox(), judgeOutbox),
      this.probe('providers', () => this.providerFigures(), judgeProviders),
      this.probe('requests', () => this.recentRequests(), judgeRequests),
      this.probe('schema', () => this.schema(), judgeSchema),
    ]);
    return { at: new Date().toISOString(), state: worst(parts.map((part) => part.state)), parts };
  }

  private async probe<Name extends string, Figures>(name: Name, run: () => Promise<Figures>, judge: (figures: Figures) => Judgement): Promise<StatusPart<Name, Figures>> {
    try {
      const figures = await within(this.timeoutMs, run);
      return { name, ...judge(figures), figures };
    } catch (error) {
      // A code, never the error's words: a driver's message may name a host or a connection string.
      return { name, state: 'down', note: errorCode(error), figures: null };
    }
  }

  /** This process: how long it has run, its commit when the deployment gives one, and its memory against its limit. */
  private api() {
    const memory = process.memoryUsage();
    // A container's limit when there is one (cgroups), else the JavaScript heap's own limit.
    const constrained = process.constrainedMemory();
    const container = constrained > 0 && constrained < totalmem();
    const limitBytes = container ? constrained : getHeapStatistics().heap_size_limit;
    const used = container ? memory.rss : memory.heapUsed;
    return {
      uptimeS: Math.round(process.uptime()),
      commit: env('SOURCE_COMMIT') ?? null,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      limitBytes,
      memoryBasis: container ? 'container' : 'heap',
      memoryShare: share(used, limitBytes),
    };
  }

  private async postgres() {
    const pingMs = await timed(() => this.repo.ping());
    return { pingMs, ...(await this.repo.database()) };
  }

  private async redisFigures() {
    if (!this.redis.configured()) return { configured: false, pingMs: null, usedMemoryBytes: null };
    const pingMs = await timed(() => this.redis.ping());
    return { configured: true, pingMs, usedMemoryBytes: await this.redis.usedMemory() };
  }

  private async queues() {
    if (!this.redis.configured()) return { configured: false, queues: [] };
    return { configured: true, queues: await Promise.all(MONITORED_QUEUES.map((name) => this.redis.counts(name))) };
  }

  /** The providers' health as the providers module works it out now (`provider-health.service.ts`). */
  private async providerFigures() {
    const rows = await this.providers.current();
    return { problems: rows.filter((row) => row.status === 'problem').length, providers: rows.map(({ code, name, status, reason }) => ({ code, name, status, reason })) };
  }

  /** The request log's last `REQUESTS_WINDOW_MINUTES`: how many, how many 5xx and their share, the slowest route. */
  private async recentRequests() {
    const filter = { from: new Date(Date.now() - REQUESTS_WINDOW_MINUTES * 60_000) };
    const [totals, routes] = await Promise.all([this.requests.totals(filter), this.requests.routeFigures(filter)]);
    const slowest = routes.slowest[0];
    return {
      windowMinutes: REQUESTS_WINDOW_MINUTES,
      count: totals.count,
      failed: totals.failed,
      errorRate: share(totals.failed, totals.count),
      slowestRoute: slowest ? { method: slowest.method, route: slowest.route, p95Ms: slowest.p95Ms } : null,
    };
  }

  /** The migrations the build carries against those applied; the missing ones named, the first ten. */
  private async schema() {
    const [carried, applied] = await Promise.all([this.repo.carriedMigrations(), this.repo.appliedMigrations()]);
    const done = new Set(applied);
    const missing = carried.filter((name) => !done.has(name));
    return { carried: carried.length, applied: applied.length, missing: missing.slice(0, MISSING_NAMED) };
  }
}
