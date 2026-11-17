// The system status's judgements (spec 2026-11-17-system-monitor, section 1): each part's figures to `ok` / `warn` /
// `down` with a code that says why, against `thresholds.ts`. Pure (backend-engineering.mdc 5.1): no Nest, no Prisma.
import {
  API_MEMORY_WARN_SHARE, OUTBOX_DOWN_AFTER_S, OUTBOX_WARN_AFTER_S, POSTGRES_PING_WARN_MS, QUEUE_FAILED_WARN, QUEUE_WAITING_WARN,
  REDIS_PING_WARN_MS, REQUESTS_FAILED_DOWN_SHARE, REQUESTS_FAILED_WARN_SHARE, WORKER_DOWN_AFTER_S, WORKER_WARN_AFTER_S,
} from './thresholds';

export type PartState = 'ok' | 'warn' | 'down';
/** A part's state and why: a code (`memory`, `stale`, `slow`, …), empty when it is `ok` for no particular reason. */
export type Judgement = { state: PartState; note: string };

const OK: Judgement = { state: 'ok', note: '' };
const RANK: Record<PartState, number> = { ok: 0, warn: 1, down: 2 };

/** The worst of the parts: the page's overall state. */
export function worst(states: PartState[]): PartState {
  return states.reduce<PartState>((found, state) => (RANK[state] > RANK[found] ? state : found), 'ok');
}

/** A share of 0 to 1 with four decimals; 0 over nothing. */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : 0;
}

export function judgeApi(figures: { memoryShare: number }): Judgement {
  return figures.memoryShare > API_MEMORY_WARN_SHARE ? { state: 'warn', note: 'memory' } : OK;
}

export function judgeWorker(figures: { lastBeatAgeS: number | null }): Judgement {
  if (figures.lastBeatAgeS === null) return { state: 'down', note: 'no_heartbeat' };
  if (figures.lastBeatAgeS > WORKER_DOWN_AFTER_S) return { state: 'down', note: 'stale' };
  if (figures.lastBeatAgeS > WORKER_WARN_AFTER_S) return { state: 'warn', note: 'stale' };
  return OK;
}

export function judgePostgres(figures: { pingMs: number }): Judgement {
  return figures.pingMs > POSTGRES_PING_WARN_MS ? { state: 'warn', note: 'slow' } : OK;
}

export function judgeRedis(figures: { configured: boolean; pingMs: number | null }): Judgement {
  if (!figures.configured) return { state: 'ok', note: 'not_configured' };
  return (figures.pingMs ?? 0) > REDIS_PING_WARN_MS ? { state: 'warn', note: 'slow' } : OK;
}

/** No `down`: a queue that holds jobs still works. Failed jobs first, they need a person. */
export function judgeQueues(figures: { configured: boolean; queues: { waiting: number; failed: number }[] }): Judgement {
  if (!figures.configured) return { state: 'ok', note: 'not_configured' };
  if (figures.queues.some((queue) => queue.failed > QUEUE_FAILED_WARN)) return { state: 'warn', note: 'failed_jobs' };
  if (figures.queues.some((queue) => queue.waiting > QUEUE_WAITING_WARN)) return { state: 'warn', note: 'waiting' };
  return OK;
}

export function judgeOutbox(figures: { oldestAgeS: number | null }): Judgement {
  const age = figures.oldestAgeS ?? 0;
  if (age > OUTBOX_DOWN_AFTER_S) return { state: 'down', note: 'late' };
  if (age > OUTBOX_WARN_AFTER_S) return { state: 'warn', note: 'late' };
  return OK;
}

/** No `down`: a provider in `problem` is a warning, the others still sell. */
export function judgeProviders(figures: { problems: number }): Judgement {
  return figures.problems > 0 ? { state: 'warn', note: 'provider_problem' } : OK;
}

export function judgeRequests(figures: { errorRate: number }): Judgement {
  if (figures.errorRate > REQUESTS_FAILED_DOWN_SHARE) return { state: 'down', note: 'server_errors' };
  if (figures.errorRate > REQUESTS_FAILED_WARN_SHARE) return { state: 'warn', note: 'server_errors' };
  return OK;
}

/** `down` when a migration the build carries is not applied: the code expects a table or a column that is not there. */
export function judgeSchema(figures: { missing: string[] }): Judgement {
  return figures.missing.length > 0 ? { state: 'down', note: 'migration_missing' } : OK;
}
