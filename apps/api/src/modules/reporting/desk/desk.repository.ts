import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork } from '../../platform';
import { REFUND_KINDS, SALE_KINDS } from '../../postpaid/pricing';
import type { MarginView } from '../../wallets';

/** One viewer's sales and refunds over a period: whose margins (ADR 0026) and the instants, `to` inclusive. */
export type SalesScope = { view: MarginView; from: Date | null; to: Date | null };

/** A bucket of the trend: `to_char` of the entry's UTC time. */
export type BucketFormat = 'YYYY-MM-DD"T"HH24' | 'YYYY-MM-DD' | 'YYYY-MM';

/** What the period's cards add up, per bucket: sales (count, volume, activations), refunds, and the viewer's profit on both. */
export type SalesBucket = { at: string; count: number; amount: number; activations: number; refunds: number; refundAmount: number; profit: number };

/** One ranked group of the period's sales: how many, their volume, the viewer's profit on them, and the newest. */
export type SalesGroup = { key: string | null; count: number; amount: number; profit: number; newest: Date };

/**
 * The branch's operations marked as its loss (spec DB.5 P.8), added up per bucket of their time and what they were for:
 * the sum of the `branchMargin` every marked row stores (− its provider cost, P.7), and how many of them are still
 * open and what those cost (`count`, `cost` positive: a given-back operation charged later is no loss to chase, P.9,
 * though its margin stays in the profit). Not a sale: no count, volume or activation of the sales reads holds them.
 */
export type LossGroup = { at: string; packageName: string | null; companyName: string | null; providerId: string | null; count: number; cost: number; margin: number };

/** The chain columns by layer, and each layer's margin (ADR 0026): the "most active" cards group by them. */
const CHAIN_OF = {
  main_agent: { chain: 'chainMainAgentId', margin: 'mainAgentMargin' },
  agent: { chain: 'chainAgentId', margin: 'agentMargin' },
  pos: { chain: 'chainPosId', margin: 'posMargin' },
} as const;

const column = (name: string) => Prisma.raw(`"${name}"`);
const kinds = (list: string[]) => Prisma.raw(list.map((kind) => `'${kind.replace(/[^a-z_]/g, '')}'`).join(', '));
// Written out, not bound, so the planner matches the partial index `WalletEntry_sale_or_refund_createdAt_id`.
const SALE_OR_REFUND = Prisma.sql`(("kind" IN (${kinds(Object.keys(SALE_KINDS))}) AND "amount" < 0) OR ("kind" IN (${kinds([...REFUND_KINDS])}) AND "amount" > 0))`;
const asNumber = (value: bigint | number | null) => Number(value ?? 0);

/**
 * The database as this domain reads and writes it: the counters and sums the home page shows. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class DeskRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * The system monitor's alerts that are open and not yet seen (M.6), for the owner's sidebar count. A count of
   * monitoring's table, read here because no module imports monitoring (ADR 0020, amended 2026-11-17).
   */
  openUnseenAlerts() {
    return this.uow.prisma.alert.count({ where: { state: 'open', seenAt: null } });
  }

  walletOf(userId: string) {
    return this.uow.prisma.wallet.findUnique({ where: { userId } });
  }

  taskCount(where: Prisma.TaskWhereInput) {
    return this.uow.prisma.task.count({ where });
  }

  /** How many lines of these points of sale (null: of every point of sale, the branch's view) are stored with this status. */
  lineCountInStatus(posIds: string[] | null, status: string) {
    return this.uow.prisma.postpaidLine.count({ where: { ...(posIds ? { posId: { in: posIds } } : {}), status } });
  }

  /** How many lines under `scope` are stored in each status, in one read (database plan DB.11). */
  lineCountsByStatus(scope: Prisma.PostpaidLineWhereInput) {
    return this.uow.prisma.postpaidLine.groupBy({ by: ['status'], where: scope, _count: { _all: true } });
  }

  lineCount(where: Prisma.PostpaidLineWhereInput) {
    return this.uow.prisma.postpaidLine.count({ where });
  }

  /** How many lines each point of sale has under the filter: the daily snapshot sums them per account. */
  lineCountsByPos(where: Prisma.PostpaidLineWhereInput) {
    return this.uow.prisma.postpaidLine.groupBy({ by: ['posId'], where, _count: { _all: true } });
  }

  /** The last eight line operations of these points of sale (null: of every one, the branch's view), with the account that paid. */
  latestOperations(posIds: string[] | null) {
    return this.uow.prisma.walletEntry.findMany({
      where: { ...(posIds ? { userId: { in: posIds } } : {}), kind: { in: ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch'] } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: true },
    });
  }

  /** Writes an account's line counts for the day, over the ones already stored for it. */
  saveLineSnapshot(userId: string, day: string, lines: { active: number; expiring: number; frozen: number; disconnected: number; suspended: number }) {
    return this.uow.prisma.postpaidLineCountSnapshot.upsert({ where: { userId_day: { userId, day } }, update: lines, create: { userId, day, ...lines } });
  }

  /** The viewer's last snapshot before the day. */
  lineSnapshotBefore(userId: string, before: string) {
    return this.uow.prisma.postpaidLineCountSnapshot.findFirst({ where: { userId, day: { lt: before } }, orderBy: { day: 'desc' } });
  }

  /** Every distinct number of days after which a package's line is suspended. */
  suspendPeriods() {
    return this.uow.prisma.postpaidPackage.findMany({ distinct: ['suspendAfterDays'], select: { suspendAfterDays: true } });
  }

  /**
   * The viewer's sales and refunds in the scope: those whose chain held it at the time of the sale, every one for the
   * branch (ADR 0026, the owner's answer 1). The branch's read uses the partial sales index, every other layer its
   * chain column's (migration 20261117230100_stored_margins_indexes).
   */
  private salesWhere(scope: SalesScope, extra: Prisma.Sql = Prisma.empty) {
    const { view, from, to } = scope;
    return Prisma.sql`WHERE ${SALE_OR_REFUND}
      ${view.chain ? Prisma.sql`AND ${column(view.chain)} = ${view.viewerId}` : Prisma.empty}
      ${from ? Prisma.sql`AND "createdAt" >= ${from}` : Prisma.empty}
      ${to ? Prisma.sql`AND "createdAt" <= ${to}` : Prisma.empty}
      ${extra}`;
  }

  /** When the viewer's oldest sale or refund in the scope was made (all time: where its trend starts), or null. */
  async firstSale(scope: SalesScope): Promise<Date | null> {
    const [row] = await this.uow.prisma.$queryRaw<{ first: Date | null }[]>`SELECT min("createdAt") AS first FROM "WalletEntry" ${this.salesWhere(scope)}`;
    return row?.first ?? null;
  }

  /** The scope's sales and refunds added up per bucket of their time, in SQL: no row is loaded. */
  async salesByBucket(scope: SalesScope, format: BucketFormat): Promise<SalesBucket[]> {
    const margin = column(scope.view.margin);
    const rows = await this.uow.prisma.$queryRaw<Record<keyof SalesBucket, string | bigint | number | null>[]>`
      SELECT to_char("createdAt", ${format}) AS at,
        count(*) FILTER (WHERE "amount" < 0) AS count,
        sum(-"amount") FILTER (WHERE "amount" < 0) AS amount,
        count(*) FILTER (WHERE "amount" < 0 AND "kind" = 'activate') AS activations,
        count(*) FILTER (WHERE "amount" > 0) AS refunds,
        sum("amount") FILTER (WHERE "amount" > 0) AS "refundAmount",
        sum(${margin}) AS profit
      FROM "WalletEntry" ${this.salesWhere(scope)}
      GROUP BY 1`;
    return rows.map((row) => ({
      at: String(row.at),
      count: asNumber(row.count as bigint),
      amount: asNumber(row.amount as bigint),
      activations: asNumber(row.activations as bigint),
      refunds: asNumber(row.refunds as bigint),
      refundAmount: asNumber(row.refundAmount as bigint),
      profit: asNumber(row.profit as bigint),
    }));
  }

  /**
   * When the branch's oldest marked operation in the period was made, or null: over all time the trend starts at the
   * older of it and the first sale, so every loss is on the axis (spec DB.5 P.8).
   */
  async firstLoss(from: Date | null): Promise<Date | null> {
    const [row] = await this.uow.prisma.$queryRaw<{ first: Date | null }[]>`
      SELECT min("createdAt") AS first FROM "WalletEntry" WHERE "providerLoss" IS NOT NULL ${from ? Prisma.sql`AND "createdAt" >= ${from}` : Prisma.empty}`;
    return row?.first ?? null;
  }

  /**
   * The branch's marked operations between the instants (`to` inclusive), grouped by the bucket of their time and the
   * package, company and provider each row stores (spec DB.5 P.8). A second read beside the sales read, so that one
   * keeps its predicate and its partial index; this one is served by `WalletEntry_loss_createdAt` (migration
   * 20261118000000_provider_loss_created_at). For the branch only: a marked row has no chain ids.
   */
  async lossesByBucket(from: Date | null, to: Date | null, format: BucketFormat): Promise<LossGroup[]> {
    // Every marked row in the sum of the margin; the open marks alone in the count and the cost (P.9). The WHERE keeps
    // the index's predicate, so the read stays on `WalletEntry_loss_createdAt`.
    const open = Prisma.sql`"providerLoss" IN ('given_back', 'priced_zero')`;
    const rows = await this.uow.prisma.$queryRaw<{ at: string; packageName: string | null; companyName: string | null; providerId: string | null; count: bigint; cost: bigint | null; margin: bigint | null }[]>`
      SELECT to_char("createdAt", ${format}) AS at, "packageName", "companyName", "providerId",
        count(*) FILTER (WHERE ${open}) AS count, -sum("branchMargin") FILTER (WHERE ${open}) AS cost, sum("branchMargin") AS margin
      FROM "WalletEntry"
      WHERE "providerLoss" IS NOT NULL
        ${from ? Prisma.sql`AND "createdAt" >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND "createdAt" <= ${to}` : Prisma.empty}
      GROUP BY 1, 2, 3, 4`;
    return rows.map((row) => ({ at: String(row.at), packageName: row.packageName, companyName: row.companyName, providerId: row.providerId, count: asNumber(row.count), cost: asNumber(row.cost), margin: asNumber(row.margin) }));
  }

  /** The scope's sales (not refunds) grouped by what they sold: the package's name, the company's, or the provider. */
  async salesBy(scope: SalesScope, key: 'packageName' | 'companyName' | 'providerId'): Promise<SalesGroup[]> {
    const rows = await this.uow.prisma.$queryRaw<{ key: string | null; count: bigint; amount: bigint; profit: bigint | null; newest: Date }[]>`
      SELECT ${column(key)} AS key, count(*) AS count, sum(-"amount") AS amount, sum(${column(scope.view.margin)}) AS profit, max("createdAt") AS newest
      FROM "WalletEntry" ${this.salesWhere(scope, Prisma.sql`AND "amount" < 0`)}
      GROUP BY 1`;
    return rows.map((row) => ({ key: row.key, count: asNumber(row.count), amount: asNumber(row.amount), profit: asNumber(row.profit), newest: row.newest }));
  }

  /** The scope's sales grouped by the account of one layer in their chain, with that account's own margin on them. */
  async salesByAccount(scope: SalesScope, layer: keyof typeof CHAIN_OF): Promise<SalesGroup[]> {
    const { chain, margin } = CHAIN_OF[layer];
    const rows = await this.uow.prisma.$queryRaw<{ key: string; count: bigint; amount: bigint; profit: bigint | null; newest: Date }[]>`
      SELECT ${column(chain)} AS key, count(*) AS count, sum(-"amount") AS amount, sum(${column(margin)}) AS profit, max("createdAt") AS newest
      FROM "WalletEntry" ${this.salesWhere(scope, Prisma.sql`AND "amount" < 0 AND ${column(chain)} IS NOT NULL`)}
      GROUP BY 1`;
    return rows.map((row) => ({ key: row.key, count: asNumber(row.count), amount: asNumber(row.amount), profit: asNumber(row.profit), newest: row.newest }));
  }

  /** Every provider's code and name, by id: an entry stores its provider's id (ADR 0025). */
  providerNames() {
    return this.uow.prisma.provider.findMany({ select: { id: true, code: true, name: true } });
  }

  /** The balance and ceiling of each of these accounts. */
  walletsOf(userIds: string[]) {
    return this.uow.prisma.wallet.findMany({ where: { userId: { in: userIds } }, select: { userId: true, balance: true, ceiling: true } });
  }

  /** How many of the tasks under `where` are in each status, in one read (database plan DB.11). */
  taskCountsByStatus(where: Prisma.TaskWhereInput) {
    return this.uow.prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } });
  }

  /** When the oldest working task under `where` was created. */
  oldestOpenTask(where: Prisma.TaskWhereInput) {
    return this.uow.prisma.task.findFirst({ where: { AND: [where, { status: 'working' }] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  }
}
