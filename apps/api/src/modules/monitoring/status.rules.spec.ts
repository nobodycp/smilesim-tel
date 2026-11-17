import { judgeApi, judgeOutbox, judgePostgres, judgeProviders, judgeQueues, judgeRedis, judgeRequests, judgeSchema, judgeWorker, share, worst } from './status.rules';

// The thresholds of the spec's table (2026-11-17-system-monitor, section 1), each part on both sides of each line.
describe('system status rules', () => {
  const states = (judge: (figures: never) => { state: string }, cases: unknown[]) => cases.map((figures) => judge(figures as never).state);

  it('API: warn over 80 % of the memory limit, never down', () => {
    expect(states(judgeApi, [{ memoryShare: 0.8 }, { memoryShare: 0.8001 }, { memoryShare: 1.5 }])).toEqual(['ok', 'warn', 'warn']);
  });

  it('worker: warn with no beat for over 60 s, down over 3 min or with none ever', () => {
    expect(states(judgeWorker, [{ lastBeatAgeS: 5 }, { lastBeatAgeS: 60 }, { lastBeatAgeS: 61 }, { lastBeatAgeS: 180 }, { lastBeatAgeS: 181 }, { lastBeatAgeS: null }])).toEqual(['ok', 'ok', 'warn', 'warn', 'down', 'down']);
    expect(judgeWorker({ lastBeatAgeS: null }).note).toBe('no_heartbeat');
    expect(judgeWorker({ lastBeatAgeS: 200 }).note).toBe('stale');
  });

  it('PostgreSQL: warn when the ping is over 200 ms (down is a probe that fails)', () => {
    expect(states(judgePostgres, [{ pingMs: 3 }, { pingMs: 200 }, { pingMs: 201 }])).toEqual(['ok', 'ok', 'warn']);
  });

  it('Redis: warn over 100 ms; ok with a note when none is configured', () => {
    expect(states(judgeRedis, [{ configured: true, pingMs: 1 }, { configured: true, pingMs: 100 }, { configured: true, pingMs: 101 }])).toEqual(['ok', 'ok', 'warn']);
    expect(judgeRedis({ configured: false, pingMs: null })).toEqual({ state: 'ok', note: 'not_configured' });
  });

  it('queues: warn over 100 waiting or with any failed job, never down', () => {
    const queues = (waiting: number, failed: number) => ({ configured: true, queues: [{ waiting: 0, failed: 0 }, { waiting, failed }] });
    expect(states(judgeQueues, [queues(100, 0), queues(101, 0), queues(0, 1), queues(5000, 50)])).toEqual(['ok', 'warn', 'warn', 'warn']);
    expect(judgeQueues(queues(0, 1)).note).toBe('failed_jobs');
    expect(judgeQueues({ configured: false, queues: [] })).toEqual({ state: 'ok', note: 'not_configured' });
  });

  it('outbox: warn when the oldest waits over 1 min, down over 10 min', () => {
    expect(states(judgeOutbox, [{ oldestAgeS: null }, { oldestAgeS: 60 }, { oldestAgeS: 61 }, { oldestAgeS: 600 }, { oldestAgeS: 601 }])).toEqual(['ok', 'ok', 'warn', 'warn', 'down']);
  });

  it('providers: warn when one is in problem, never down', () => {
    expect(states(judgeProviders, [{ problems: 0 }, { problems: 1 }, { problems: 9 }])).toEqual(['ok', 'warn', 'warn']);
  });

  it('requests: warn over 1 % of 5xx, down over 10 %', () => {
    expect(states(judgeRequests, [{ errorRate: 0 }, { errorRate: 0.01 }, { errorRate: 0.0101 }, { errorRate: 0.1 }, { errorRate: 0.1001 }])).toEqual(['ok', 'ok', 'warn', 'warn', 'down']);
    expect(share(1, 99)).toBe(0.0101);
    expect(share(3, 0)).toBe(0);
  });

  it('schema: down when a migration the build carries is not applied', () => {
    expect(states(judgeSchema, [{ missing: [] }, { missing: ['20261117120000_worker_heartbeat'] }])).toEqual(['ok', 'down']);
  });

  it('the page is the worst of its parts', () => {
    expect([worst([]), worst(['ok', 'ok']), worst(['ok', 'warn']), worst(['warn', 'down', 'ok'])]).toEqual(['ok', 'ok', 'warn', 'down']);
  });
});
