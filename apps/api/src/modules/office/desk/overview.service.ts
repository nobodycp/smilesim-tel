import { Injectable } from '@nestjs/common';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { visibleAccountIds } from '../office-rules';
import { NEWEST_FIRST, expiringWhere, suspendedWhere } from '../office-paging';
import { REFUND_KINDS, SALE_KINDS, marginOf } from '../profit-ladder';
import { ProviderAccountsService } from '../providers/provider-accounts.service';
import { InsightsService } from '../reports/insights.service';
import { taskWhereFor } from '../task-access';
import { WalletsService } from '../wallets/wallets.service';

// The home page's full picture (spec 2026-11-08-overview-and-reports-nav, F): every card of one viewer in one read,
// scoped to its chain and its grants, over a period (today, this month, all time). Line counts are "now".
export type OverviewPeriod = 'day' | 'month' | 'all';
const PERIODS: readonly OverviewPeriod[] = ['day', 'month', 'all'];
/** The most sale entries one overview reads; `capped` says when there were more. */
const OVERVIEW_LIMIT = 20_000;
const TOP = 5;
const TASK_STATUSES = ['pending', 'working', 'done', 'rejected', 'cancelled'] as const;

/** The first instant of the period, in UTC days like the rest of the money views; null for all time. */
export function periodStart(period: OverviewPeriod, now: Date = new Date()): Date | null {
  if (period === 'day') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return null;
}

type Ranked = { key: string; label: string; count: number; amount: number; profit: number };

function rank(map: Map<string, Ranked>, by: 'count' | 'profit') {
  return [...map.values()].sort((a, b) => b[by] - a[by] || b.amount - a.amount).slice(0, TOP);
}

function bump(map: Map<string, Ranked>, key: string, label: string, amount: number, profit: number) {
  const row = map.get(key) ?? { key, label, count: 0, amount: 0, profit: 0 };
  row.count += 1;
  row.amount += amount;
  row.profit += profit;
  map.set(key, row);
}

@Injectable()
export class OverviewService {
  constructor(
    private readonly kernel: OfficeKernel,
    private readonly wallets: WalletsService,
    private readonly insights: InsightsService,
    private readonly providerAccounts: ProviderAccountsService,
  ) {}

  async overview(actor: Actor, query: { period?: string } = {}) {
    const period: OverviewPeriod = PERIODS.find((value) => value === query.period) ?? 'month';
    const now = new Date();
    const from = periodStart(period, now);
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const isBranch = actor.layer === 'branch';
    const readsProviders = isBranch && !actor.impersonating && (actor.isBranchOwner || actor.grants.includes('reports') || actor.grants.includes('accounting'));

    const [lines, money, users, tasks, providers] = await Promise.all([
      this.lines(posIds, now),
      this.money(actor, from, accounts),
      this.users(actor, accounts, visible),
      this.tasks(actor, accounts, now),
      readsProviders ? this.providers(actor, from) : Promise.resolve(null),
    ]);
    return { period, from: from?.toISOString() ?? null, lines, ...money, users, tasks, providers };
  }

  /** Lines now, under the viewer: each a slice of the donut (suspended and expiring are read from the end date). */
  private async lines(posIds: string[], now: Date) {
    const prisma = this.kernel.prisma;
    const scope = { posId: { in: posIds } };
    const periods = (await prisma.package.findMany({ distinct: ['suspendAfterDays'], select: { suspendAfterDays: true } })).map((row) => row.suspendAfterDays);
    const suspendedScope = { AND: [scope, suspendedWhere(periods, now)] };
    const [active, expiring, frozen, disconnected, suspended] = await Promise.all([
      prisma.line.count({ where: { ...scope, status: 'active' } }),
      prisma.line.count({ where: { AND: [scope, expiringWhere(now)] } }),
      prisma.line.count({ where: { ...scope, status: 'frozen' } }),
      prisma.line.count({ where: { ...scope, status: 'disconnected' } }),
      prisma.line.count({ where: suspendedScope }),
    ]);
    // A suspended line is still stored as active: it leaves the active slice, and so does an expiring one.
    return { active: Math.max(0, active - expiring - suspended), expiring, frozen, disconnected, suspended };
  }

  /** Sales, refunds, a daily trend, the rankings and the most active accounts, from the period's ledger. */
  private async money(actor: Actor, from: Date | null, accounts: Awaited<ReturnType<OfficeKernel['accounts']>>) {
    const where = await this.wallets.financeWhere(actor, from ? { from: from.toISOString() } : {});
    const rows = await this.kernel.prisma.walletEntry.findMany({
      where: {
        AND: [
          where,
          { OR: [{ kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } }, { kind: { in: [...REFUND_KINDS] }, amount: { gt: 0 } }] },
        ],
      },
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true, packageName: true, companyName: true, providerCost: true },
      orderBy: [...NEWEST_FIRST],
      take: OVERVIEW_LIMIT,
    });
    const ladders = await this.wallets.laddersFor(rows);
    const viewerOf = (chain: string[]) => (actor.layer === 'branch' ? chain[chain.length - 1] : actor.id);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const providerOfLine = await this.providerOfLines(rows.map((row) => row.lineId));

    const sales = { count: 0, amount: 0, profit: 0, refunds: 0, refundAmount: 0, net: 0 };
    const trend = new Map<string, { day: string; amount: number; profit: number; count: number }>();
    const packages = new Map<string, Ranked>();
    const companies = new Map<string, Ranked>();
    const providers = new Map<string, Ranked>();
    const active = new Map<string, Ranked>();

    for (const row of rows) {
      const ladder = ladders.get(row.id);
      const profit = ladder ? marginOf(ladder, viewerOf(ladder.chain)) ?? 0 : 0;
      const day = row.createdAt.toISOString().slice(0, 10);
      const point = trend.get(day) ?? { day, amount: 0, profit: 0, count: 0 };
      if (row.amount < 0) {
        const paid = -row.amount;
        sales.count += 1;
        sales.amount += paid;
        sales.profit += profit;
        point.amount += paid;
        point.count += 1;
        bump(packages, row.packageName ?? '', row.packageName ?? '—', paid, profit);
        bump(companies, row.companyName ?? '', row.companyName ?? '—', paid, profit);
        const provider = row.lineId ? providerOfLine.get(row.lineId) : undefined;
        if (provider) bump(providers, provider.code, provider.name, paid, profit);
        // Every account of the sale's chain under the viewer did this sale: the most active accounts per layer.
        for (const id of ladder?.chain ?? [row.userId]) {
          const account = byId.get(id);
          if (!account || account.layer === 'branch' || id === actor.id) continue;
          bump(active, id, account.loginName, paid, ladder ? marginOf(ladder, id) ?? 0 : 0);
        }
      } else {
        sales.refunds += 1;
        sales.refundAmount += row.amount;
        sales.profit += profit;
      }
      point.profit += profit;
      trend.set(day, point);
    }
    sales.net = sales.amount - sales.refundAmount;
    const activeByLayer = (layer: string) => rank(new Map([...active].filter(([id]) => byId.get(id)?.layer === layer)), 'count')
      .map((row) => ({ ...row, nickname: byId.get(row.key)?.nickname ?? '' }));
    return {
      sales: { ...sales, trend: [...trend.values()].sort((a, b) => (a.day < b.day ? -1 : 1)), capped: rows.length === OVERVIEW_LIMIT },
      top: {
        packages: rank(packages, 'count'),
        companies: rank(companies, 'profit'),
        providers: actor.layer === 'branch' ? rank(providers, 'profit') : [],
      },
      active: {
        main_agent: actor.layer === 'branch' ? activeByLayer('main_agent') : [],
        agent: actor.layer === 'branch' || actor.layer === 'main_agent' ? activeByLayer('agent') : [],
        pos: actor.layer === 'pos' ? [] : activeByLayer('pos'),
      },
    };
  }

  private async providerOfLines(lineIds: (string | null)[]) {
    const ids = [...new Set(lineIds.filter((id): id is string => Boolean(id)))];
    if (!ids.length) return new Map<string, { code: string; name: string }>();
    const lines = await this.kernel.prisma.line.findMany({ where: { id: { in: ids } }, select: { id: true, package: { select: { provider: { select: { code: true, name: true } } } } } });
    return new Map(lines.map((line) => [line.id, line.package.provider]));
  }

  /** The accounts below the viewer: how many per layer, what they owe, and their ceilings. */
  private async users(actor: Actor, accounts: Awaited<ReturnType<OfficeKernel['accounts']>>, visible: Set<string>) {
    const below = accounts.filter((account) => visible.has(account.id) && account.id !== actor.id && account.layer !== 'branch');
    const wallets = below.length
      ? await this.kernel.prisma.wallet.findMany({ where: { userId: { in: below.map((account) => account.id) } }, select: { userId: true, balance: true, ceiling: true } })
      : [];
    const debtors = wallets.filter((wallet) => wallet.balance < 0);
    return {
      counts: {
        main_agent: below.filter((account) => account.layer === 'main_agent').length,
        agent: below.filter((account) => account.layer === 'agent').length,
        pos: below.filter((account) => account.layer === 'pos').length,
      },
      frozen: below.filter((account) => account.disabledAt).length,
      debtors: debtors.length,
      debt: debtors.reduce((sum, wallet) => sum - wallet.balance, 0),
      ceilings: wallets.reduce((sum, wallet) => sum + wallet.ceiling, 0),
      used: debtors.reduce((sum, wallet) => sum + Math.min(-wallet.balance, wallet.ceiling), 0),
    };
  }

  /** Tasks the viewer may see, by status, and how long the oldest open one has waited. */
  private async tasks(actor: Actor, accounts: Awaited<ReturnType<OfficeKernel['accounts']>>, now: Date) {
    const where = taskWhereFor(actor, accounts);
    const prisma = this.kernel.prisma;
    const counts = await Promise.all(TASK_STATUSES.map((status) => prisma.officeTask.count({ where: { AND: [where, { status }] } })));
    const oldest = await prisma.officeTask.findFirst({ where: { AND: [where, { status: { in: ['pending', 'working'] } }] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    return {
      ...Object.fromEntries(TASK_STATUSES.map((status, index) => [status, counts[index]])),
      oldestOpenMinutes: oldest ? Math.max(0, Math.round((now.getTime() - oldest.createdAt.getTime()) / 60_000)) : null,
    } as Record<(typeof TASK_STATUSES)[number], number> & { oldestOpenMinutes: number | null };
  }

  /** The branch's providers: the period's operations and cost, the balance with them, and a status. */
  private async providers(actor: Actor, from: Date | null) {
    const [accounts, supply] = await Promise.all([
      this.providerAccounts.list(actor),
      this.insights.supply(actor, from ? { from: from.toISOString() } : {}),
    ]);
    const used = new Map(supply.rows.map((row) => [row.providerCode, row]));
    return accounts.rows.map((row) => {
      const period = used.get(row.code);
      // Provider health (slice G) adds failed operations; until then a provider over its credit is the problem.
      const problem = row.available < 0 ? 'balance' : null;
      return {
        code: row.code,
        name: row.name,
        operations: period?.operations ?? 0,
        cost: period?.cost ?? 0,
        profit: period?.profit ?? 0,
        balance: row.balance,
        creditLimit: row.creditLimit,
        available: row.available,
        status: problem ? 'problem' : 'working',
        problem,
      };
    });
  }
}
