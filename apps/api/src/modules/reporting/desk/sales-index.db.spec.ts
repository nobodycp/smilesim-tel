import 'reflect-metadata';
import { createPrismaClient } from '../../../db';
import { REFUND_KINDS, SALE_KINDS } from '../../postpaid/pricing';

// PostgreSQL only (TEST_DATABASE_URL). The partial index `WalletEntry_sale_or_refund_createdAt_id` (migration
// 20261117150000_newest_first_indexes) serves the overview and the reports only while its predicate names the same
// kinds as `SALE_KINDS` and `REFUND_KINDS`: a kind added to either without a new migration would leave those reads
// on a full scan, with no test failing. This pins the two together.
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('the sales index and the sale kinds (PostgreSQL)', () => {
  const before = process.env.DATABASE_URL;
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    process.env.DATABASE_URL = before;
  });

  it('names exactly the kinds the code sends', async () => {
    const [row] = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'WalletEntry_sale_or_refund_createdAt_id'`,
    );
    expect(row).toBeDefined();
    const [sales, refunds] = row.indexdef.split(' OR ');
    const kindsIn = (text: string) => [...text.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]).sort();
    expect(sales).toContain('amount < 0');
    expect(refunds).toContain('amount > 0');
    expect(kindsIn(sales)).toEqual(Object.keys(SALE_KINDS).sort());
    expect(kindsIn(refunds)).toEqual([...REFUND_KINDS].sort());
  });
});
