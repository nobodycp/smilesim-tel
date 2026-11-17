import 'reflect-metadata';
import type { PrismaClient } from './generated/prisma/client';
import type { NoticeWriter } from './modules/platform/notices';
import { UnitOfWork } from './modules/platform/unit-of-work';
import type { DispatchSettings } from './modules/providers/integration/dispatch/dispatch-policy';
import { RoutingProviderGateway } from './modules/providers/integration/dispatch/routing-gateway';
import { NO_ADAPTERS } from './modules/providers/integration/dispatch/provider-adapters';
import { RECOVERY_EVERY_MS, RELAY_EVERY_MS, SWEEP_EVERY_MS, startProviderDispatchTimers, workerShutdown } from './worker/provider-dispatch';
import { startReadiness } from './modules/providers/integration/dispatch/worker-readiness';

// Slice R.2.1: the worker's stop, run for real (`workerShutdown`, the function `worker.ts` calls on SIGTERM), with
// the real readiness loop and the real timers. Only what reaches the outside is a stand-in: the database the
// readiness round reads, and the relay, recovery and sweep bodies, each of which can be held open. The clock is
// Jest's, so a timer that is still armed fires when time is moved on.

/** A promise held open until `release` is called. */
function held<T = void>() {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release };
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** A deployment that may build adapters, so the readiness loop really runs (this build has none to attest). */
const SETTINGS: DispatchSettings = { on: true, adapters: ['p1'], target: 'sandbox', deployment: 'race', problems: [] };

function harness() {
  const log: string[] = [];
  const started = { relay: 0, recovery: 0, sweep: 0 };
  // The readiness round reads the stored credentials first: that read is held open, so its round is slow.
  const readinessRead = held<{ generation: number; provider: { code: string } }[]>();
  const prisma = {
    providerCredential: { findMany: () => readinessRead.promise },
    $executeRaw: async () => 0,
    providerWorkerAttestation: { deleteMany: async () => { log.push('attestations removed'); return { count: 0 }; } },
  } as unknown as PrismaClient;
  // A round finishes at once unless the test holds it open (`holdRelay`, `holdSweep`).
  let relay: { promise: Promise<void> } = { promise: Promise.resolve() };
  let sweep: { promise: Promise<number> } = { promise: Promise.resolve(0) };
  const parts = {
    relay: { runOnce: () => { started.relay += 1; log.push('relay round'); return relay.promise; } },
    operations: { expiredPending: async () => { started.recovery += 1; log.push('recovery round'); return []; } },
    gate: {},
    waiting: { round: async () => 0, stop: () => log.push('waiting pass stopped') },
    settlement: { applyPending: () => { started.sweep += 1; log.push('sweep round'); return sweep.promise; }, stopSweeping: () => log.push('sweeping stopped') },
    publisher: { close: async () => void log.push('queue publisher closed') },
  } as unknown as Parameters<typeof startProviderDispatchTimers>[0];
  const stopTimers = startProviderDispatchTimers(parts);
  const uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as unknown as NoticeWriter);
  uow.prismaClient = prisma;
  const readiness = startReadiness(uow, SETTINGS, new RoutingProviderGateway(NO_ADAPTERS), async () => NO_ADAPTERS, 'race-worker', 10 * 60_000);
  // A BullMQ worker as `close()` behaves: it stops taking jobs at once and resolves when its running job ended.
  const job = held();
  let jobRunning = false;
  const queue = {
    taking: true,
    close: async () => {
      queue.taking = false;
      log.push('queue stops taking jobs');
      if (jobRunning) await job.promise;
      log.push('queue closed');
    },
  };
  // The alert pass (system monitor M.6): its round in flight writes notices, so it is waited for before the writer closes.
  let alertRound: { promise: Promise<void> } = { promise: Promise.resolve() };
  const stop = workerShutdown({
    readiness,
    heartbeat: { stop: async () => void log.push('heartbeat stopped') },
    alerts: { stop: async () => { log.push('alert pass told to stop'); await alertRound.promise; log.push('alert pass stopped'); } },
    stopTimers,
    queues: [queue],
    closeNotices: async () => void log.push('notice writer closed'),
    release: async () => void log.push('database and redis released'),
  });
  return {
    log, started, readinessRead, queue, stop,
    holdRelay: () => { const round = held(); relay = round; return round; },
    holdSweep: () => { const round = held<number>(); sweep = round; return round; },
    holdAlerts: () => { const round = held(); alertRound = round; return round; },
    /** A settlement job that is running: it commits, then publishes its notices, when released. */
    startJob: () => {
      jobRunning = true;
      return () => { log.push('settlement committed'); log.push('notices published'); job.release(); };
    },
  };
}

describe('stopping a worker while its readiness round is slow (SIGTERM during readiness)', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('starts no relay, recovery or sweep round after the stop was asked for, however long readiness takes', async () => {
    const h = harness();
    // The readiness round started at once and is waiting on the database.
    let stopped = false;
    const stopping = h.stop().then(() => { stopped = true; });
    await settle();
    const before = { ...h.started };
    // Readiness is still waiting: move the clock past every timer, several times.
    jest.advanceTimersByTime(Math.max(RELAY_EVERY_MS, RECOVERY_EVERY_MS, SWEEP_EVERY_MS) * 3);
    await settle();
    expect(h.started).toEqual(before);
    expect(stopped).toBe(false);
    h.readinessRead.release([]);
    await stopping;
    expect(h.started).toEqual(before);
  });

  it('the queues stop taking jobs at once, and the notice writer waits for readiness to remove its rows', async () => {
    const h = harness();
    const stopping = h.stop();
    await settle();
    expect(h.queue.taking).toBe(false);
    // The heartbeat (system monitor M.5) is told in the same turn, and is let go of before the database.
    expect(h.log).toContain('heartbeat stopped');
    // The timers had no round in flight: their publisher may close at once, it serves the relay only.
    expect(h.log).not.toContain('notice writer closed');
    expect(h.log).not.toContain('database and redis released');
    h.readinessRead.release([]);
    await stopping;
    const at = (step: string) => h.log.indexOf(step);
    expect(at('attestations removed')).toBeGreaterThanOrEqual(0);
    expect(at('notice writer closed')).toBeGreaterThan(at('attestations removed'));
    expect(at('database and redis released')).toBeGreaterThan(at('notice writer closed'));
    expect(at('database and redis released')).toBeGreaterThan(at('heartbeat stopped'));
  });

  it('the alert pass is told in the same turn, and its round in flight ends before the notice writer closes', async () => {
    const h = harness();
    const round = h.holdAlerts();
    const stopping = h.stop();
    await settle();
    expect(h.queue.taking).toBe(false);
    expect(h.log).toContain('alert pass told to stop');
    h.readinessRead.release([]);
    await settle();
    // Readiness and the queues are done; the alert round still writes: the writer stays open.
    expect(h.log).not.toContain('notice writer closed');
    round.release();
    await stopping;
    const at = (step: string) => h.log.indexOf(step);
    expect(at('notice writer closed')).toBeGreaterThan(at('alert pass stopped'));
    expect(at('database and redis released')).toBeGreaterThan(at('notice writer closed'));
  });
});

describe('stopping a worker during a settlement (SIGTERM while a job runs)', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('waits for the job to commit and publish before the notice writer closes; the job publishes once', async () => {
    const h = harness();
    h.readinessRead.release([]);
    const finishJob = h.startJob();
    const stopping = h.stop();
    await settle();
    expect(h.log).not.toContain('notice writer closed');
    finishJob();
    await stopping;
    const at = (step: string) => h.log.indexOf(step);
    expect(at('notices published')).toBeLessThan(at('notice writer closed'));
    expect(h.log.filter((step) => step === 'notices published')).toHaveLength(1);
  });

  it('a sweep that is settling finishes before the queue publisher and the notice writer close, and no other sweep starts', async () => {
    const h = harness();
    h.readinessRead.release([]);
    const sweep = h.holdSweep();
    jest.advanceTimersByTime(SWEEP_EVERY_MS);
    await settle();
    expect(h.started.sweep).toBe(1);
    const stopping = h.stop();
    jest.advanceTimersByTime(SWEEP_EVERY_MS * 3);
    await settle();
    expect(h.log).not.toContain('queue publisher closed');
    sweep.release(0);
    await stopping;
    expect(h.started.sweep).toBe(1);
    const at = (step: string) => h.log.indexOf(step);
    expect(at('sweeping stopped')).toBeLessThan(at('queue publisher closed'));
    expect(at('queue publisher closed')).toBeLessThan(at('notice writer closed'));
  });
});

describe('stopping a worker during a relay round (SIGTERM while the relay publishes)', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('the queue publisher is not closed while the relay uses it, and no other relay round starts', async () => {
    const h = harness();
    h.readinessRead.release([]);
    const relay = h.holdRelay();
    jest.advanceTimersByTime(RELAY_EVERY_MS);
    await settle();
    expect(h.started.relay).toBe(1);
    const stopping = h.stop();
    jest.advanceTimersByTime(RELAY_EVERY_MS * 10);
    await settle();
    expect(h.log).not.toContain('queue publisher closed');
    expect(h.started.relay).toBe(1);
    relay.release();
    await stopping;
    expect(h.log.indexOf('queue publisher closed')).toBeGreaterThan(h.log.indexOf('relay round'));
  });
});

describe('a stop asked for twice (SIGTERM then SIGINT)', () => {
  it('lets go of everything once', async () => {
    const h = harness();
    h.readinessRead.release([]);
    await Promise.all([h.stop(), h.stop()]);
    expect(h.log.filter((step) => step === 'notice writer closed')).toHaveLength(1);
    expect(h.log.filter((step) => step === 'database and redis released')).toHaveLength(1);
    expect(h.log.filter((step) => step === 'queue stops taking jobs')).toHaveLength(1);
  });
});
