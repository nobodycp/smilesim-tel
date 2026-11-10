import 'reflect-metadata';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../../../db';
import { OPERATIONS_QUEUE, buildProviderDispatch } from '../../../provider-dispatch';
import { capturedOutput } from '../../shared/testing/captured-output';
import { UnitOfWork } from '../kernel/unit-of-work';
import type { NoticeService } from '../notices/notice.service';
import { OPERATION_REQUESTED } from '../providers/operations/provider-operations.repository';
import { ScriptedGateway } from '../providers/testing/scripted-gateway';
import { OutboxRelay, RELAY_LEASE_MS, type OutboxPublisher } from './outbox-relay';
import { OutboxRepository, type ClaimedMessage } from './outbox.repository';

// PostgreSQL (TEST_DATABASE_URL) for the relay; the queue tests also need Redis (TEST_REDIS_URL, e.g.
// redis://127.0.0.1:6379/15). Each run uses its own key prefix and removes it.
const url = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const suite = url ? describe : describe.skip;
const withRedis = url && redisUrl ? describe : describe.skip;

const TOPIC = `relay-test.${randomUUID()}`;

function setup() {
  const prisma = createPrismaClient();
  const uow = new UnitOfWork({ write: async () => [], publish: async () => undefined } as unknown as NoticeService);
  uow.prismaClient = prisma;
  return { prisma, uow };
}

suite('outbox relay (PostgreSQL)', () => {
  jest.setTimeout(30_000);
  const previousUrl = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;
  let uow: UnitOfWork;
  let sent: ClaimedMessage[];
  let publisher: OutboxPublisher;

  const add = (count: number) => prisma.outboxMessage.createMany({ data: Array.from({ length: count }, (_, sequence) => ({ topic: TOPIC, aggregateId: randomUUID(), sequence, payload: { n: sequence } })) });
  const rows = () => prisma.outboxMessage.findMany({ where: { topic: TOPIC }, orderBy: { sequence: 'asc' } });
  const afterLease = () => new Date(Date.now() + RELAY_LEASE_MS + 1_000);
  // Its own topic: the relay takes only the topics it is given, so other specs' messages are not touched.
  const relayWith = (repo: OutboxRepository = new OutboxRepository(), to: OutboxPublisher = publisher) => new OutboxRelay(uow, repo, to, [TOPIC]);

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    ({ prisma, uow } = setup());
  });
  beforeEach(() => {
    sent = [];
    publisher = { publish: async (message) => { sent.push(message); } };
  });
  afterEach(async () => {
    await prisma.outboxMessage.deleteMany({ where: { topic: TOPIC } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('leaves a topic it has no queue for alone', async () => {
    await add(1);
    expect(await new OutboxRelay(uow, new OutboxRepository(), publisher, [`${TOPIC}.other`]).runOnce()).toEqual({ claimed: 0, published: 0, failed: 0 });
    expect((await rows())[0]).toMatchObject({ publishedAt: null, claimedUntil: null });
  });

  it('publishes what waits, stamps it only then, and finds nothing the next round', async () => {
    await add(3);
    const relay = relayWith();
    expect(await relay.runOnce()).toEqual({ claimed: 3, published: 3, failed: 0 });
    // Written in one statement, the three share a creation time: their order among themselves is not promised.
    expect(sent.map((message) => (message.payload as { n: number }).n).sort()).toEqual([0, 1, 2]);
    expect((await rows()).every((row) => row.publishedAt !== null)).toBe(true);
    expect(await relay.runOnce(afterLease())).toEqual({ claimed: 0, published: 0, failed: 0 });
  });

  it('gives each message to one of several relays running at once', async () => {
    await add(40);
    const relays = Array.from({ length: 4 }, () => relayWith());
    const rounds = await Promise.all(relays.map((relay) => relay.runOnce()));
    expect(rounds.reduce((sum, round) => sum + round.published, 0)).toBe(40);
    expect(new Set(sent.map((message) => message.id)).size).toBe(40);
    expect(sent).toHaveLength(40);
  });

  it('takes again, after the lease, a message whose relay died before publishing', async () => {
    await add(1);
    // The relay took the message and died: leased, nothing published.
    const dead = await new OutboxRepository().claimUnpublished(prisma, [TOPIC], new Date(), new Date(Date.now() + RELAY_LEASE_MS), 10);
    expect(dead).toHaveLength(1);
    const relay = relayWith();
    expect(await relay.runOnce()).toEqual({ claimed: 0, published: 0, failed: 0 });
    expect((await rows())[0].publishedAt).toBeNull();
    expect(await relay.runOnce(afterLease())).toEqual({ claimed: 1, published: 1, failed: 0 });
    expect(sent.map((message) => message.id)).toEqual([dead[0].id]);
  });

  it('publishes again a message whose relay died after the queue took it and before the stamp', async () => {
    await add(1);
    class DiesBeforeStamp extends OutboxRepository {
      override async markPublished(): Promise<void> {
        throw new Error('the relay died here');
      }
    }
    expect(await relayWith(new DiesBeforeStamp()).runOnce()).toEqual({ claimed: 1, published: 0, failed: 1 });
    expect((await rows())[0].publishedAt).toBeNull();
    expect(await relayWith().runOnce(afterLease())).toEqual({ claimed: 1, published: 1, failed: 0 });
    // Twice, under one id: at least once, and the id lets the queue and the consumer see the repeat.
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((message) => message.id)).size).toBe(1);
    expect((await rows())[0].publishedAt).toBeInstanceOf(Date);
  });

  it('writes a code, never the queue driver\'s own words, to the log', async () => {
    await add(2);
    const secret = 'redis://default:redis-pass-123@cache.internal:6379';
    let call = 0;
    const leaky: OutboxPublisher = {
      publish: async () => {
        call += 1;
        throw Object.assign(new Error(`connect ECONNREFUSED ${secret}`), call === 1 ? { code: 'ECONNREFUSED' } : {});
      },
    };
    const output = await capturedOutput(async () => {
      expect(await relayWith(new OutboxRepository(), leaky).runOnce()).toEqual({ claimed: 2, published: 0, failed: 2 });
    });
    expect(output).toContain('not published: ECONNREFUSED');
    expect(output).toContain('not published: unclassified');
    for (const part of [secret, 'redis-pass-123', 'cache.internal']) expect(output).not.toContain(part);
  });

  it('leaves a message unpublished when the queue refuses it, and publishes it on a later round', async () => {
    await add(2);
    let down = true;
    const flaky: OutboxPublisher = { publish: async (message) => { if (down) throw new Error('redis is away'); sent.push(message); } };
    const relay = relayWith(new OutboxRepository(), flaky);
    expect(await relay.runOnce()).toEqual({ claimed: 2, published: 0, failed: 2 });
    expect((await rows()).map((row) => row.publishedAt)).toEqual([null, null]);
    down = false;
    // Held by the failed round until the lease is over; then it goes out.
    expect(await relay.runOnce()).toEqual({ claimed: 0, published: 0, failed: 0 });
    expect(await relay.runOnce(afterLease())).toEqual({ claimed: 2, published: 2, failed: 0 });
  });
});

withRedis('outbox relay and dispatcher on a real queue (PostgreSQL + Redis)', () => {
  jest.setTimeout(40_000);
  const previousUrl = process.env.DATABASE_URL;
  const prefix = `test-${randomUUID()}`;
  let prisma: ReturnType<typeof createPrismaClient>;
  let redis: IORedis;
  let gateway: ScriptedGateway;
  let dispatch: ReturnType<typeof buildProviderDispatch>;
  let providerId: string;
  let providerCode: string;
  let worker: Worker | null = null;
  let queue: Queue;

  /**
   * The real relay, publisher and topic, over this spec's own operations only: other specs record operations in
   * the same database at the same time, and their messages are not this one's to publish.
   */
  class OwnOperations extends OutboxRepository {
    override claimUnpublished(db: Parameters<OutboxRepository['claimUnpublished']>[0], topics: string[], now: Date, leaseUntil: Date, limit: number) {
      return db.$queryRaw<ClaimedMessage[]>`
        UPDATE "OutboxMessage" SET "claimedUntil" = ${leaseUntil}
        WHERE "id" IN (
          SELECT m."id" FROM "OutboxMessage" m JOIN "ProviderOperation" o ON o."id" = m."aggregateId"
          WHERE o."providerId" = ${providerId} AND m."topic" = ANY(${topics}) AND m."publishedAt" IS NULL AND (m."claimedUntil" IS NULL OR m."claimedUntil" < ${now})
          ORDER BY m."createdAt", m."id" LIMIT ${limit} FOR UPDATE OF m SKIP LOCKED
        )
        RETURNING "id", "topic", "aggregateId", "sequence", "payload"`;
    }
  }
  const relayOf = (parts: ReturnType<typeof buildProviderDispatch>) => new OutboxRelay(parts.uow, new OwnOperations(), parts.publisher, [OPERATION_REQUESTED]);
  let relay: OutboxRelay;

  const record = async () => (await dispatch.operations.record(`test:${randomUUID()}`, { action: 'activate', providerCode, packageCode: 'pkg-1', msisdn: '0500000001', iccid: null, lineId: null })).id;
  const until = async (check: () => Promise<boolean>) => {
    for (let waited = 0; waited < 15_000; waited += 50) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('the condition was not met in 15 s');
  };
  const startWorker = () => {
    worker = new Worker(OPERATIONS_QUEUE, (job) => dispatch.handle(job.data), { connection: new IORedis(redisUrl as string, { maxRetriesPerRequest: null }), prefix });
  };
  const jobs = () => queue.getJobCountByTypes('waiting', 'active', 'completed', 'failed', 'delayed');
  const afterLease = () => new Date(Date.now() + RELAY_LEASE_MS + 1_000);

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
    redis = new IORedis(redisUrl as string, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    queue = new Queue(OPERATIONS_QUEUE, { connection: new IORedis(redisUrl as string), prefix });
  });
  beforeEach(async () => {
    providerId = randomUUID();
    providerCode = `relay-test-${providerId}`;
    await prisma.provider.create({ data: { id: providerId, code: providerCode, name: 'relay spec' } });
    gateway = new ScriptedGateway();
    dispatch = buildProviderDispatch(prisma, redis, gateway, prefix);
    relay = relayOf(dispatch);
  });
  afterEach(async () => {
    await worker?.close();
    worker = null;
    await queue.obliterate({ force: true });
    const ids = (await prisma.providerOperation.findMany({ where: { providerId } })).map((row) => row.id);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: ids } } });
    await prisma.providerOperation.deleteMany({ where: { providerId } });
    await prisma.provider.deleteMany({ where: { id: providerId } });
  });
  afterAll(async () => {
    await dispatch.publisher.close();
    await queue.close();
    redis.disconnect();
    await prisma.$disconnect();
    process.env.DATABASE_URL = previousUrl;
  });

  it('carries a recorded operation through the outbox, the queue and the dispatcher to its result', async () => {
    const id = await record();
    startWorker();
    expect(await relay.runOnce()).toMatchObject({ published: 1, failed: 0 });
    await until(async () => (await dispatch.operations.status({ id })).status === 'succeeded');
    expect(gateway.calls.map((call) => call.attempt)).toEqual([1]);
    expect((await prisma.outboxMessage.findMany({ where: { aggregateId: id } })).map((row) => row.publishedAt !== null)).toEqual([true]);
  });

  it('makes one job of a message published twice, and one send of two jobs for one operation', async () => {
    const id = await record();
    const [message] = await prisma.outboxMessage.findMany({ where: { aggregateId: id } });
    const claimed: ClaimedMessage = { id: message.id, topic: OPERATION_REQUESTED, aggregateId: id, sequence: 0, payload: { operationId: id } };
    // The relay died between the queue's answer and the stamp, and published again.
    await dispatch.publisher.publish(claimed);
    await dispatch.publisher.publish(claimed);
    expect(await jobs()).toBe(1);
    // A second job for the same operation under another id (a relay bug, a manual replay) still sends once.
    await queue.add(OPERATION_REQUESTED, { operationId: id }, { jobId: `replay-${randomUUID()}` });
    expect(await jobs()).toBe(2);
    startWorker();
    await until(async () => (await queue.getJobCountByTypes('completed')) === 2);
    expect(gateway.calls).toHaveLength(1);
    expect(await dispatch.operations.status({ id })).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('sends an operation that never left again through a new message, without anyone re-queueing it by hand', async () => {
    const id = await record();
    gateway.next({ left: false, error: 'unreachable' });
    startWorker();
    await relay.runOnce();
    await until(async () => (await dispatch.operations.status({ id })).attempts === 1 && (await dispatch.operations.status({ id })).status === 'requested');
    // The first message is consumed and stamped; the retry is a second row, waiting.
    const waiting = await prisma.outboxMessage.findMany({ where: { aggregateId: id, publishedAt: null } });
    expect(waiting.map((row) => row.sequence)).toEqual([1]);
    expect(await relay.runOnce()).toMatchObject({ published: 1 });
    await until(async () => (await dispatch.operations.status({ id })).status === 'succeeded');
    expect(gateway.calls.map((call) => call.attempt)).toEqual([1, 2]);
  });

  it('leaves a code, not the error, in the log and in the failed job the queue keeps', async () => {
    const id = await record();
    const secret = 'postgresql://smilesim:db-pass-456@db.internal:5432/smilesim';
    // The dispatcher fails outright (a database error while settling, say), with text that must not travel.
    dispatch.dispatcher.handle = async () => {
      throw Object.assign(new Error(`Can't reach database server at ${secret}`), { code: 'P1001' });
    };
    let failed: { failedReason?: string; stacktrace?: string[] | null; toJSON?: () => unknown } | undefined;
    const output = await capturedOutput(async () => {
      startWorker();
      await relay.runOnce();
      await until(async () => (await queue.getJobCountByTypes('failed')) === 1);
      [failed] = await queue.getJobs(['failed']);
    });
    expect(output).toContain(`operation ${id}: the job failed (P1001)`);
    expect(failed?.failedReason).toBe('provider-operation job failed: P1001');

    // The same with a made-up code that carries data: the log and the queue get `unclassified`.
    const other = await record();
    dispatch.dispatcher.handle = async () => {
      throw Object.assign(new Error(secret), { code: 'ERR_SECRET_ABCDEF123456' });
    };
    let unlisted: typeof failed;
    const second = await capturedOutput(async () => {
      await relay.runOnce();
      await until(async () => (await queue.getJobCountByTypes('failed')) === 2);
      unlisted = (await queue.getJobs(['failed'])).find((job) => (job.data as { operationId: string }).operationId === other);
    });
    expect(second).toContain(`operation ${other}: the job failed (unclassified)`);
    expect(unlisted?.failedReason).toBe('provider-operation job failed: unclassified');
    for (const text of [second, JSON.stringify(unlisted?.toJSON?.() ?? null)]) expect(text).not.toContain('ERR_SECRET');
    // What Redis holds for the job: its reason and its stack trace.
    for (const text of [output, JSON.stringify(failed?.toJSON?.() ?? null), JSON.stringify(failed?.stacktrace ?? null)]) {
      for (const part of [secret, 'db-pass-456', 'db.internal']) expect(text).not.toContain(part);
    }
  });

  it('keeps the message while Redis is away and publishes it when Redis is back', async () => {
    const id = await record();
    // Nothing listens on this port: every command is refused at once.
    const away = new IORedis('redis://127.0.0.1:1', { maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null });
    away.on('error', () => undefined);
    const broken = buildProviderDispatch(prisma, away, gateway, prefix);
    expect(await relayOf(broken).runOnce()).toMatchObject({ claimed: 1, published: 0, failed: 1 });
    await broken.publisher.close();
    away.disconnect();
    expect((await prisma.outboxMessage.findFirstOrThrow({ where: { aggregateId: id } })).publishedAt).toBeNull();
    expect(await jobs()).toBe(0);
    expect(await dispatch.operations.status({ id })).toMatchObject({ status: 'requested', attempts: 0 });

    // Redis is back: the same row goes out once its lease is over, and the operation runs.
    startWorker();
    expect(await relay.runOnce(afterLease())).toMatchObject({ claimed: 1, published: 1, failed: 0 });
    await until(async () => (await dispatch.operations.status({ id })).status === 'succeeded');
    expect(gateway.calls).toHaveLength(1);
  });
});
