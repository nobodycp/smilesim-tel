import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type IORedis from 'ioredis';
import type { PrismaClient } from './generated/prisma/client';
import { NoticeService, type NoticeBus } from './modules/notifications/notice.service';
import type { SendGate } from './modules/office/providers/dispatch/dispatch-gate';
import type { NoticeWriter } from './modules/shared/notices';
import { SWEEP_EVERY_MS, buildProviderDispatch, startProviderDispatchTimers } from './provider-dispatch';

// How a worker lets go of what it holds (slice R.2 corrections): the timers wait for the round in flight, the
// queues wait for their jobs, and only then is the notice writer it built closed, once; a writer it was handed is
// never closed by it. A sudden kill is not this path: it leaves attempts to recovery, as before.

const redisUrl = process.env.TEST_REDIS_URL;
const NO_GATE = { permits: async () => null } as unknown as SendGate;

type Connection = { status: string; quit: () => Promise<unknown> };
const busOf = (service: NoticeService) => (service as unknown as { bus: { publisher: Connection | null; subscriber: Connection | null } }).bus;

describe('the notice writer closes what it opened, once', () => {
  (redisUrl ? it : it.skip)('a writer that opened both connections ends both, and a second close does nothing', async () => {
    const before = process.env.REDIS_URL;
    process.env.REDIS_URL = redisUrl;
    try {
      const service = new NoticeService();
      // Open the two connections the way the app does: a publish and a subscription.
      await service.publish([{ id: 'n', userId: `shutdown-${Date.now()}`, kind: 'fund.received', payload: {}, actorName: '', href: '/finance', read: false, createdAt: new Date().toISOString() }]);
      const unsubscribe = await service.subscribe(`shutdown-${Date.now()}`, () => undefined);
      await unsubscribe();
      const { publisher, subscriber } = busOf(service);
      expect([publisher?.status, subscriber?.status]).toEqual(['ready', 'ready']);
      const quits = [jest.spyOn(publisher as Connection, 'quit'), jest.spyOn(subscriber as Connection, 'quit')];
      await service.close();
      await service.close();
      await service.onModuleDestroy();
      expect(quits.map((quit) => quit.mock.calls.length)).toEqual([1, 1]);
      // QUIT is answered before the socket closes: the status turns `end` on the close that follows.
      for (let waited = 0; [publisher?.status, subscriber?.status].some((status) => status !== 'end') && waited < 3000; waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
      expect([publisher?.status, subscriber?.status]).toEqual(['end', 'end']);
    } finally {
      if (before === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = before;
    }
  });

  it('a writer that opened nothing closes without opening anything', async () => {
    const service = new NoticeService();
    await service.close();
    expect([busOf(service).publisher, busOf(service).subscriber]).toEqual([null, null]);
  });

  it('a bus handed in is its owner’s: closing the writer leaves it alone', async () => {
    const bus = { publish: jest.fn(), subscribe: jest.fn(), close: jest.fn() };
    const service = new NoticeService(bus as unknown as NoticeBus);
    await service.close();
    expect(bus.close).not.toHaveBeenCalled();
  });
});

describe('the worker’s dispatch closes the writer it built, and only that one', () => {
  it('a writer it built is closed once by closeNotices', async () => {
    const close = jest.spyOn(NoticeService.prototype, 'close');
    try {
      const dispatch = buildProviderDispatch({} as PrismaClient, {} as IORedis, NO_GATE, 'shutdown');
      expect(dispatch.uow.notice).toBeInstanceOf(NoticeService);
      await dispatch.closeNotices();
      await dispatch.closeNotices();
      expect(close).toHaveBeenCalledTimes(1);
      expect(close.mock.contexts[0]).toBe(dispatch.uow.notice);
      await dispatch.publisher.close();
    } finally {
      close.mockRestore();
    }
  });

  it('a writer it was handed is never closed by it', async () => {
    const handed = { write: jest.fn(), publish: jest.fn(), close: jest.fn(), onModuleDestroy: jest.fn() };
    const dispatch = buildProviderDispatch({} as PrismaClient, {} as IORedis, NO_GATE, 'shutdown', handed as unknown as NoticeWriter);
    expect(dispatch.uow.notice).toBe(handed);
    await dispatch.closeNotices();
    expect([handed.close.mock.calls.length, handed.onModuleDestroy.mock.calls.length]).toEqual([0, 0]);
    await dispatch.publisher.close();
  });
});

describe('stopping the timers waits for the round in flight', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('a sweep that is settling when the worker stops finishes before the queues close', async () => {
    const order: string[] = [];
    let finishSweep: () => void = () => undefined;
    const parts = {
      relay: { runOnce: async () => undefined },
      operations: {},
      gate: NO_GATE,
      waiting: { round: async () => undefined, stop: () => order.push('waiting stopped') },
      settlement: {
        applyPending: () => new Promise<number>((resolve) => {
          order.push('sweep started');
          finishSweep = () => {
            order.push('sweep finished');
            resolve(1);
          };
        }),
        stopSweeping: () => order.push('sweeping stopped'),
      },
      publisher: { close: async () => void order.push('queues closed') },
    } as unknown as Parameters<typeof startProviderDispatchTimers>[0];
    const stop = startProviderDispatchTimers(parts);
    jest.advanceTimersByTime(SWEEP_EVERY_MS);
    expect(order).toEqual(['sweep started']);
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await new Promise((resolve) => setImmediate(resolve));
    // Still settling: the queues stay open and stop has not returned.
    expect([stopped, order]).toEqual([false, ['sweep started', 'waiting stopped', 'sweeping stopped']]);
    finishSweep();
    await stopping;
    expect(order).toEqual(['sweep started', 'waiting stopped', 'sweeping stopped', 'sweep finished', 'queues closed']);
    // No round starts after the stop.
    jest.advanceTimersByTime(SWEEP_EVERY_MS * 3);
    expect(order.filter((step) => step === 'sweep started')).toHaveLength(1);
  });
});

describe('the worker stops in this order', () => {
  it('the timers and the queues at once (no new round, no new job), then the notice writer, then the database and Redis', () => {
    const worker = readFileSync(join(__dirname, 'worker.ts'), 'utf8');
    const stop = worker.slice(worker.indexOf('const stop = async () => {'));
    const at = (text: string) => {
      const index = stop.indexOf(text);
      expect({ text, found: index >= 0 }).toEqual({ text, found: true });
      return index;
    };
    // The queues stop taking jobs while the timers wait for their round: no job starts during the wait.
    const steps = ['await Promise.all([stopDispatch(), ...workers.map((worker) => worker.close())]);', 'await dispatch.closeNotices();', 'await dispatchPrisma.$disconnect();', 'relayRedis.disconnect();', 'connection.disconnect();'].map(at);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });
});
