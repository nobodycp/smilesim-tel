import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../generated/prisma/client';
import { countUpTo } from './paging';

// The capped total of every list (database plan DB.8) on PostgreSQL: `countUpTo` over a Prisma count limited to
// `cap + 1` in the page's order. A small cap stands for TOTAL_CAP, so the spec writes a handful of rows, not 10,001.
// It also keeps what Prisma 7 sends for such a count and the plan PostgreSQL makes of it: a `LIMIT` under the count,
// so the database stops at `cap + 1` rows. The rows are the request log's (no foreign key), held to this file's own
// request ids, so other spec files that write the table at the same time are not counted.

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/** A client that hands every statement it sends to the spec. */
const loggingClient = () => new PrismaClient({ adapter: new PrismaPg(url ?? ''), log: [{ emit: 'event', level: 'query' }] });

suite('a list total counted up to a cap, in PostgreSQL', () => {
  jest.setTimeout(60_000);
  const tag = `paging-${randomUUID().slice(0, 8)}`;
  const where: Prisma.RequestLogWhereInput = { requestId: { startsWith: `${tag}-` } };
  const order: Prisma.RequestLogOrderByWithRelationInput[] = [{ at: 'desc' }, { id: 'desc' }];
  const sent: { query: string; params: string }[] = [];
  let prisma: ReturnType<typeof loggingClient>;

  beforeAll(async () => {
    prisma = loggingClient();
    prisma.$on('query', (event) => sent.push({ query: event.query, params: event.params }));
    await prisma.requestLog.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({ at: new Date(Date.UTC(1999, 0, 1, 0, 0, i)), durationMs: 1, method: 'GET', path: '/paging', status: 200, requestId: `${tag}-${i}` })),
    });
  });

  afterAll(async () => {
    await prisma.requestLog.deleteMany({ where });
    await prisma.$disconnect();
  });

  const count = (take: number) => prisma.requestLog.count({ where, orderBy: order, take });

  it('answers the cap and totalCapped when the filter holds more rows than the cap', async () => {
    expect(await countUpTo(count, 3)).toEqual({ total: 3, totalCapped: true });
    expect(await countUpTo(count, 4)).toEqual({ total: 4, totalCapped: true });
  });

  it('answers the exact count when the filter holds the cap or fewer', async () => {
    expect(await countUpTo(count, 5)).toEqual({ total: 5, totalCapped: false });
    expect(await countUpTo(count, 10_000)).toEqual({ total: 5, totalCapped: false });
    expect(await countUpTo((take) => prisma.requestLog.count({ where: { requestId: `${tag}-none` }, orderBy: order, take }), 3)).toEqual({ total: 0, totalCapped: false });
  });

  it('sends one count over a subquery limited to cap + 1, in the order given, and PostgreSQL plans a Limit under it', async () => {
    sent.length = 0;
    await countUpTo(count, 3);
    expect(sent).toHaveLength(1);
    const [{ query, params }] = sent;
    // SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."RequestLog"."id" FROM "public"."RequestLog" WHERE (…)
    //   ORDER BY "public"."RequestLog"."at" DESC, "public"."RequestLog"."id" DESC LIMIT $2 OFFSET $3) AS "sub"
    expect(query).toMatch(/^SELECT COUNT\(\*\) AS "_count\$_all" FROM \(SELECT "public"\."RequestLog"\."id" FROM "public"\."RequestLog" WHERE .+ ORDER BY "public"\."RequestLog"\."at" DESC, "public"\."RequestLog"\."id" DESC LIMIT \$(\d+) OFFSET \$(\d+)\) AS "sub"$/);
    const [, limitAt, offsetAt] = /LIMIT \$(\d+) OFFSET \$(\d+)/.exec(query) ?? [];
    const values = JSON.parse(params) as unknown[];
    expect(Number(values[Number(limitAt) - 1])).toBe(4);
    expect(Number(values[Number(offsetAt) - 1])).toBe(0);
    // The same statement, explained: the count reads at most the limit's rows.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) ${query}`,
      ...values.map((value, i) => (i === Number(limitAt) - 1 || i === Number(offsetAt) - 1 ? Number(value) : value)),
    );
    const lines = plan.map((row) => row['QUERY PLAN']);
    expect(lines[0]).toMatch(/^Aggregate/);
    expect(lines.find((line) => /->\s+Limit/.test(line))).toMatch(/rows=4(\.00)? loops=1/);
  });
});
