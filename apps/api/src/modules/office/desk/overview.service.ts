import { holdsAny } from '../policy';
import { Injectable } from '@nestjs/common';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { visibleAccountIds } from '../rules/office-rules';
import { NEWEST_FIRST, expiringWhere, suspendedWhere } from '../rules/office-paging';
import { REFUND_KINDS, SALE_KINDS, marginOf } from '../rules/profit-ladder';
import { ProviderAccountsService } from '../providers/provider-accounts.service';
import { ProviderHealthService } from '../providers/provider-health.service';
import { InsightsService } from '../reports/insights.service';
import { taskWhereFor } from '../tasks/task-access';
import { WalletsService } from '../wallets/wallets.service';
import { addEntry, axis, bucketOf, emptyTotals, stepOf, previousWindow, type PulsePoint, type PulseTotals } from './pulse';

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

type LineCounts = { active: number; expiring: number; frozen: number; disconnected: number; suspended: number };
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
    private readonly health: ProviderHealthService,
  ) {}

  async overview(actor: Actor, query: { period?: string } = {}) {
    const period: OverviewPeriod = PERIODS.find((value) => value === query.period) ?? 'month';
    const now = new Date();
    const from = periodStart(period, now);
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const isBranch = actor.layer === 'branch';
    const readsProviders = isBranch && !actor.impersonating && holdsAny(actor, ['reports', 'accounting']);

    const [lines, money, users, tasks, providers] = await Promise.all([
      this.lines(posIds, now),
      this.money(actor, from, accounts, period, now),
      this.users(actor, accounts, visible),
      this.tasks(actor, accounts, now),
      readsProviders ? this.providers(actor, from) : Promise.resolve(null),
    ]);
    const lineChange = await this.lineChange(actor, period, lines, now);
    return { period, from: from?.toISOString() ?? null, lines, lineChange, ...money, users, tasks, providers };
  }

  /**
   * How each slice moved over the period (spec 2026-11-09-admin-review, 6.4): now minus the viewer's last snapshot
   * before it — yesterday's for today, the previous month's last for this month, nothing (zero) for all time. Today's
   * snapshot is written here, so history builds as the home is read. Null when there is no snapshot to compare with.
   */
  private async lineChange(actor: Actor, period: OverviewPeriod, lines: LineCounts, now: Date): Promise<LineCounts | null> {
    const store = this.kernel.prisma.lineCountSnapshot;
    const today = now.toISOString().slice(0, 10);
    await store.upsert({ where: { userId_day: { userId: actor.id, day: today } }, update: lines, create: { userId: actor.id, day: today, ...lines } });
    if (period === 'all') return lines;
    const before = (periodStart(period, now) as Date).toISOString().slice(0, 10);
    const base = await store.findFirst({ where: { userId: actor.id, day: { lt: before } }, orderBy: { day: 'desc' } });
    if (!base) return null;
    return {
      active: lines.active - base.active,
      expiring: lines.expiring - base.expiring,
      frozen: lines.frozen - base.frozen,
      disconnected: lines.disconnected - base.disconnected,
      suspended: lines.suspended - base.suspended,
    };
  }

  /** Lines now, under the viewer: each a slice of the donut (suspended and expiring are read from the end date). */
  private async lines(posIds: string[], now: Date): Promise<LineCounts> {
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

  /** The sales and refunds of the period that the viewer may see, newest first, up to the overview's limit. */
  private async periodEntries(actor: Actor, from: Date | null) {
    const where = await this.wallets.financeWhere(actor, from ? { from: from.toISOString() } : {});
    return this.kernel.prisma.walletEntry.findMany({
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
  }

  /** Sales, refunds, a daily trend, the rankings and the most active accounts, from the period's ledger. */
  private async money(actor: Actor, from: Date | null, accounts: Awaited<ReturnType<OfficeKernel['accounts']>>, period: OverviewPeriod, now: Date) {
    const rows = await this.periodEntries(actor, from);
    const ladders = await this.wallets.laddersFor(rows);
    const viewerOf = (chain: string[]) => (actor.layer === 'branch' ? chain[chain.length - 1] : actor.id);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const providerOfLine = await this.providerOfLines(rows.map((row) => row.lineId));

    const sales = { count: 0, amount: 0, profit: 0, refunds: 0, refundAmount: 0, net: 0 };
    const daily = new Map<string, { day: string; amount: number; profit: number; count: number }>();
    const packages = new Map<string, Ranked>();
    const companies = new Map<string, Ranked>();
    const providers = new Map<string, Ranked>();
    const active = new Map<string, Ranked>();
    const current = emptyTotals();
    const steps = new Map<string, PulseTotals>();
    const first = rows.length ? rows[rows.length - 1].createdAt : null;
    const step = stepOf(period, now, first);

    for (const row of rows) {
      const ladder = ladders.get(row.id);
      const profit = ladder ? marginOf(ladder, viewerOf(ladder.chain)) ?? 0 : 0;
      addEntry(current, row, profit);
      const bucket = bucketOf(step, row.createdAt);
      const stepTotals = steps.get(bucket) ?? emptyTotals();
      addEntry(stepTotals, row, profit);
      steps.set(bucket, stepTotals);
      const day = row.createdAt.toISOString().slice(0, 10);
      const point = daily.get(day) ?? { day, amount: 0, profit: 0, count: 0 };
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
      daily.set(day, point);
    }
    sales.net = sales.amount - sales.refundAmount;
    const trend: PulsePoint[] = axis(period, now, first).map((at) => ({ at, ...(steps.get(at) ?? emptyTotals()) }));
    const window = previousWindow(period, now);
    const previous = window ? await this.totalsBetween(actor, window.from, window.to) : null;
    const activeByLayer = (layer: string) => rank(new Map([...active].filter(([id]) => byId.get(id)?.layer === layer)), 'count')
      .map((row) => ({ ...row, nickname: byId.get(row.key)?.nickname ?? '' }));
    return {
      sales: { ...sales, activations: current.activations, trend: [...daily.values()].sort((a, b) => (a.day < b.day ? -1 : 1)), capped: rows.length === OVERVIEW_LIMIT },
      // The home's period cards: this period, the same span before it (null over all time), and the trend.
      pulse: { current, previous, trend },
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

  /** Sales, their volume, activations and the viewer's profit between two instants: the period before, to compare. */
  private async totalsBetween(actor: Actor, from: Date, to: Date): Promise<PulseTotals> {
    const where = await this.wallets.financeWhere(actor, { from: from.toISOString(), to: to.toISOString() });
    const rows = await this.kernel.prisma.walletEntry.findMany({
      where: {
        AND: [
          where,
          { OR: [{ kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } }, { kind: { in: [...REFUND_KINDS] }, amount: { gt: 0 } }] },
        ],
      },
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true },
      take: OVERVIEW_LIMIT,
    });
    const ladders = await this.wallets.laddersFor(rows);
    const totals = emptyTotals();
    for (const row of rows) {
      const ladder = ladders.get(row.id);
      const viewer = actor.layer === 'branch' && ladder ? ladder.chain[ladder.chain.length - 1] : actor.id;
      addEntry(totals, row, ladder ? marginOf(ladder, viewer) ?? 0 : 0);
    }
    return totals;
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
    const [accounts, supply, health] = await Promise.all([
      this.providerAccounts.list(actor),
      this.insights.supply(actor, from ? { from: from.toISOString() } : {}),
      this.health.current(),
    ]);
    const used = new Map(supply.rows.map((row) => [row.providerCode, row]));
    const healthOf = new Map(health.map((row) => [row.code, row]));
    return accounts.rows.map((row) => {
      const period = used.get(row.code);
      // The same rule the alerts use (provider-health.ts): recent failures, or the balance under the owner's floor.
      const now = healthOf.get(row.code);
      const problem = now?.reason ?? null;
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
        failures: now?.failures ?? 0,
        alertFloor: now?.alertFloor ?? 0,
      };
    });
  }
}
