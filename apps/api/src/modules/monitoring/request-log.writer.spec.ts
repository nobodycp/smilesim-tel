import { REQUEST_LOG_BATCH, REQUEST_LOG_BUFFER_MAX, REQUEST_LOG_FLUSH_MS, RequestLogWriter, type RequestLogDraft } from './request-log.writer';
import type { RequestLogRepository } from './request-log.repository';

// The request log's writer (spec 2026-11-17-system-monitor, slice M.1): batches, the timer, a database that refuses,
// and the account named from a session's hash. Over a stand-in repository; the real one is followed into PostgreSQL
// by `request-log.middleware.spec.ts`.

const draft = (n: number, extra: Partial<RequestLogDraft> = {}): RequestLogDraft => ({
  at: new Date(), durationMs: 1, method: 'GET', route: '/v1/x', path: `/v1/x/${n}`, status: 200, code: '',
  ip: '127.0.0.1', userAgent: '', requestId: `r${n}`, bytesIn: 0, bytesOut: 0, account: null, sessionHash: null, ...extra,
});

function repo(insert: (rows: unknown[]) => Promise<unknown> = async () => ({ count: 0 })) {
  const batches: Record<string, unknown>[][] = [];
  const stand = {
    insertMany: async (rows: Record<string, unknown>[]) => {
      batches.push(rows);
      return insert(rows);
    },
    sessionsByHash: async (hashes: string[]) => [
      { tokenHash: 'h-own', kind: 'account', operatorId: null, user: { id: 'u1', loginName: 'branch', layer: 'branch' } },
      { tokenHash: 'h-entered', kind: 'impersonation', operatorId: 'u1', user: { id: 'p1', loginName: 'pos1', layer: 'pos' } },
    ].filter((row) => hashes.includes(row.tokenHash)),
  };
  return { stand: stand as unknown as RequestLogRepository, batches };
}

describe('RequestLogWriter', () => {
  const previousUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://stand-in';
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.DATABASE_URL = previousUrl;
  });

  it('writes a full batch at once, without waiting for the timer', async () => {
    const { stand, batches } = repo();
    const writer = new RequestLogWriter(stand);
    for (let n = 0; n < REQUEST_LOG_BATCH; n += 1) writer.add(draft(n));
    await writer.flush();
    expect(batches.map((rows) => rows.length)).toEqual([REQUEST_LOG_BATCH]);
  });

  it('writes a short batch when the timer runs, two seconds after its first row', async () => {
    jest.useFakeTimers();
    const { stand, batches } = repo();
    const writer = new RequestLogWriter(stand);
    writer.add(draft(1));
    writer.add(draft(2));
    jest.advanceTimersByTime(REQUEST_LOG_FLUSH_MS - 1);
    await Promise.resolve();
    expect(batches).toEqual([]);
    jest.advanceTimersByTime(1);
    jest.useRealTimers();
    await writer.flush();
    expect(batches.map((rows) => rows.map((row) => row.requestId))).toEqual([['r1', 'r2']]);
  });

  it('drops and counts a batch the database refuses; adding never throws', async () => {
    const { stand } = repo(async () => {
      throw new Error('database down');
    });
    const writer = new RequestLogWriter(stand);
    expect(() => {
      for (let n = 0; n < 3; n += 1) writer.add(draft(n));
    }).not.toThrow();
    await expect(writer.flush()).resolves.toBeUndefined();
    expect(writer.dropped).toBe(3);
    // The next batch is tried afresh.
    writer.add(draft(4));
    await writer.flush();
    expect(writer.dropped).toBe(4);
  });

  it('keeps memory bounded while the database hangs: rows past the limit are dropped and counted', async () => {
    let hanging = true;
    const held: (() => void)[] = [];
    const release = () => {
      hanging = false;
      for (const resume of held) resume();
    };
    const { stand } = repo(() => (hanging ? new Promise<void>((resolve) => held.push(resolve)) : Promise.resolve()));
    const writer = new RequestLogWriter(stand);
    for (let n = 0; n < REQUEST_LOG_BATCH; n += 1) writer.add(draft(n));
    await new Promise((resolve) => setImmediate(resolve));
    // The first batch is in flight and hangs; what arrives meanwhile waits, up to the limit.
    for (let n = 0; n < REQUEST_LOG_BUFFER_MAX + 7; n += 1) writer.add(draft(n));
    expect(writer.dropped).toBe(7);
    release();
    await writer.flush();
    expect(writer.dropped).toBe(7);
  });

  it('names the account of a session from its hash, and both accounts of an entered one', async () => {
    const { stand, batches } = repo();
    const writer = new RequestLogWriter(stand);
    writer.add(draft(1, { sessionHash: 'h-own' }));
    writer.add(draft(2, { sessionHash: 'h-entered' }));
    writer.add(draft(3, { sessionHash: 'h-unknown' }));
    writer.add(draft(4, { account: { actorId: 'a9', actorLoginName: 'agent9', layer: 'agent', operatorId: null }, sessionHash: null }));
    await writer.flush();
    const who = batches[0].map(({ actorId, actorLoginName, layer, operatorId }) => ({ actorId, actorLoginName, layer, operatorId }));
    expect(who).toEqual([
      { actorId: 'u1', actorLoginName: 'branch', layer: 'branch', operatorId: null },
      { actorId: 'p1', actorLoginName: 'pos1', layer: 'pos', operatorId: 'u1' },
      { actorId: null, actorLoginName: '', layer: '', operatorId: null },
      { actorId: 'a9', actorLoginName: 'agent9', layer: 'agent', operatorId: null },
    ]);
    // The hash is not a column: it never reaches the table.
    expect(batches[0].every((row) => !('sessionHash' in row) && !('account' in row))).toBe(true);
  });

  it('writes what is waiting when the module stops', async () => {
    const { stand, batches } = repo();
    const writer = new RequestLogWriter(stand);
    writer.add(draft(1));
    await writer.onModuleDestroy();
    expect(batches.map((rows) => rows.length)).toEqual([1]);
  });

  it('keeps nothing without a database', async () => {
    delete process.env.DATABASE_URL;
    const { stand, batches } = repo();
    const writer = new RequestLogWriter(stand);
    writer.add(draft(1));
    await writer.flush();
    expect(batches).toEqual([]);
  });
});
