import 'reflect-metadata';
import { OPERATIONS_QUEUE, SETTLEMENTS_QUEUE } from '../../worker/provider-dispatch';
import type { Actor } from '../access';
import type { ProviderHealthService } from '../providers';
import type { RequestLogRepository } from './request-log.repository';
import { MONITORED_QUEUES, type StatusRedis } from './status-redis';
import type { StatusRepository } from './status.repository';
import { StatusService } from './status.service';
import { PROBE_TIMEOUT_MS } from './thresholds';

// The system status over stand-ins (system monitor M.5): the nine parts and their figures, each part's states from
// its figures, a probe that fails or hangs answering `down` alone, and the owner alone reading it.

const OWNER: Actor = { id: 'o', loginName: 'branch', nickname: 'b', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'o', impersonating: false };
const never = () => new Promise<never>(() => undefined);

type Stands = { repo: Record<string, unknown>; redis: Record<string, unknown>; requests: Record<string, unknown>; providers: Record<string, unknown> };

function healthy(): Stands {
  return {
    repo: {
      ping: async () => undefined,
      database: async () => ({ connections: 7, sizeBytes: 12_345_678 }),
      heartbeat: async () => ({ workers: 1, lastBeatAgeS: 4.2 }),
      outbox: async () => ({ unpublished: 0, oldestAgeS: null }),
      appliedMigrations: async () => ['a', 'b'],
      carriedMigrations: async () => ['a', 'b'],
    },
    redis: { configured: () => true, ping: async () => undefined, usedMemory: async () => 1_000_000, counts: async (name: string) => ({ name, waiting: 0, active: 0, failed: 0 }) },
    requests: { totals: async () => ({ count: 200, refused: 3, failed: 1 }), routeFigures: async () => ({ slowest: [{ method: 'GET', route: '/v1/lines', calls: 9, medianMs: 40, p95Ms: 90 }], busiest: [] }) },
    providers: { current: async () => [{ code: 'sky', name: 'Sky', status: 'working', reason: null, failures: 0, available: 10, alertFloor: 0 }] },
  };
}

function serviceOf(stands: Stands, timeoutMs?: number) {
  const service = new StatusService(stands.repo as unknown as StatusRepository, stands.redis as unknown as StatusRedis, stands.requests as unknown as RequestLogRepository, stands.providers as unknown as ProviderHealthService);
  if (timeoutMs) service.timeoutMs = timeoutMs;
  return service;
}

const byName = async (stands: Stands, timeoutMs?: number) => {
  const answer = await serviceOf(stands, timeoutMs).status(OWNER);
  return Object.fromEntries(answer.parts.map((part) => [part.name, part]));
};

describe('StatusService', () => {
  it('answers the nine parts, ok, with the figures that say why', async () => {
    const answer = await serviceOf(healthy()).status(OWNER);
    expect(answer.parts.map((part) => part.name)).toEqual(['api', 'worker', 'postgres', 'redis', 'queues', 'outbox', 'providers', 'requests', 'schema']);
    expect(answer.state).toBe('ok');
    const parts = Object.fromEntries(answer.parts.map((part) => [part.name, part]));
    expect(parts.api.figures).toEqual(expect.objectContaining({ uptimeS: expect.any(Number), rssBytes: expect.any(Number), limitBytes: expect.any(Number), memoryShare: expect.any(Number) }));
    expect(parts.worker.figures).toEqual({ workers: 1, lastBeatAgeS: 4.2 });
    expect(parts.postgres.figures).toEqual({ pingMs: expect.any(Number), connections: 7, sizeBytes: 12_345_678 });
    expect(parts.redis.figures).toEqual({ configured: true, pingMs: expect.any(Number), usedMemoryBytes: 1_000_000 });
    expect(parts.queues.figures).toEqual({ configured: true, queues: MONITORED_QUEUES.map((name) => ({ name, waiting: 0, active: 0, failed: 0 })) });
    expect(parts.requests.figures).toEqual({ windowMinutes: 15, count: 200, failed: 1, errorRate: 0.005, slowestRoute: { method: 'GET', route: '/v1/lines', p95Ms: 90 } });
    expect(parts.schema.figures).toEqual({ carried: 2, applied: 2, missing: [] });
  });

  it('each part turns warn and down from its figures', async () => {
    const stands = healthy();
    stands.repo.heartbeat = async () => ({ workers: 0, lastBeatAgeS: 90 });
    stands.repo.outbox = async () => ({ unpublished: 4, oldestAgeS: 70 });
    stands.redis.counts = async (name: string) => ({ name, waiting: 101, active: 1, failed: 0 });
    stands.requests.totals = async () => ({ count: 100, refused: 0, failed: 5 });
    stands.providers.current = async () => [{ code: 'sky', name: 'Sky', status: 'problem', reason: 'balance', failures: 0, available: 0, alertFloor: 5 }];
    const warned = await byName(stands);
    expect(['worker', 'outbox', 'queues', 'requests', 'providers'].map((name) => [name, warned[name].state, warned[name].note])).toEqual([
      ['worker', 'warn', 'stale'], ['outbox', 'warn', 'late'], ['queues', 'warn', 'waiting'], ['requests', 'warn', 'server_errors'], ['providers', 'warn', 'provider_problem'],
    ]);
    stands.repo.heartbeat = async () => ({ workers: 0, lastBeatAgeS: 400 });
    stands.repo.outbox = async () => ({ unpublished: 4, oldestAgeS: 900 });
    stands.requests.totals = async () => ({ count: 100, refused: 0, failed: 11 });
    stands.repo.carriedMigrations = async () => ['a', 'b', 'c'];
    const down = await byName(stands);
    expect(['worker', 'outbox', 'requests', 'schema'].map((name) => [name, down[name].state])).toEqual([['worker', 'down'], ['outbox', 'down'], ['requests', 'down'], ['schema', 'down']]);
    expect(down.schema.figures).toEqual({ carried: 3, applied: 2, missing: ['c'] });
  });

  it('a probe that fails is down with a code and no figures, never the error\'s words', async () => {
    const stands = healthy();
    stands.repo.ping = async () => {
      throw Object.assign(new Error('connect to postgresql://user:secret@db failed'), { code: 'P1001' });
    };
    stands.redis.ping = async () => {
      throw new Error('redis://:secret@cache refused');
    };
    const parts = await byName(stands);
    expect(parts.postgres).toEqual({ name: 'postgres', state: 'down', note: 'P1001', figures: null });
    expect(parts.redis).toEqual({ name: 'redis', state: 'down', note: 'unclassified', figures: null });
    expect(JSON.stringify(parts)).not.toContain('secret');
  });

  it('a probe that hangs is down after its time limit, and does not hold the others', async () => {
    const stands = healthy();
    stands.repo.ping = never;
    stands.redis.ping = never;
    stands.providers.current = never;
    const started = Date.now();
    const answer = await serviceOf(stands, 300).status(OWNER);
    const took = Date.now() - started;
    // The three ran beside each other, each under its own limit: one limit, not three.
    expect(took).toBeGreaterThanOrEqual(290);
    expect(took).toBeLessThan(1500);
    const parts = Object.fromEntries(answer.parts.map((part) => [part.name, part]));
    expect(['postgres', 'redis', 'providers'].map((name) => [parts[name].state, parts[name].note])).toEqual([['down', 'timeout'], ['down', 'timeout'], ['down', 'timeout']]);
    expect(['api', 'worker', 'queues', 'outbox', 'requests', 'schema'].map((name) => parts[name].state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(answer.state).toBe('down');
    expect(PROBE_TIMEOUT_MS).toBe(2_000);
  });

  it('Redis not configured: ok with a note, and the queues the same', async () => {
    const stands = healthy();
    stands.redis.configured = () => false;
    const parts = await byName(stands);
    expect([parts.redis.state, parts.redis.note, parts.queues.state, parts.queues.note]).toEqual(['ok', 'not_configured', 'ok', 'not_configured']);
  });

  it('counts the queues the worker opens', () => {
    expect([...MONITORED_QUEUES]).toEqual([OPERATIONS_QUEUE, SETTLEMENTS_QUEUE]);
  });

  it('is the branch owner\'s alone, in person', async () => {
    const service = serviceOf(healthy());
    await expect(service.status({ ...OWNER, isBranchOwner: false })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(service.status({ ...OWNER, impersonating: true })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});
