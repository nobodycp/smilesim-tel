import { OverviewQuery } from './desk.schemas';
import { parseInput } from '../../platform';
import { DeskRepository, type BucketFormat, type SalesBucket, type SalesGroup, type SalesScope } from './desk.repository';
import { AccountTree, holdsAny, visibleAccountIds } from '../../access';
import { Injectable } from '@nestjs/common';
import type { Actor } from '../../access';
import type { Prisma } from '../../../generated/prisma/client';
import { expiringWhere, suspendedWhere } from '../../sales';
import { ProviderAccountsService, ProviderHealthService } from '../../providers';
import { InsightsService } from '../reports/insights.service';
import { taskWhereFor } from '../../tasks';
import { marginViewOf } from '../../wallets';
import { axis, emptyTotals, stepOf, previousWindow, type PulsePoint, type PulseTotals, type Step } from './pulse';

// The home page's full picture (spec 2026-11-08-overview-and-reports-nav, F): every card of one viewer in one read,
// scoped to its chain and its grants, over a period (today, this month, all time). Line counts are "now". The money
// figures are SQL sums of the margins each sale stored (ADR 0026): exact over any period, no row loaded.
export type OverviewPeriod = 'day' | 'month' | 'all';
const TOP = 5;
const TASK_STATUSES = ['working', 'done', 'rejected', 'cancelled'] as const;

/** The first instant of the period, in UTC days like the rest of the money views; null for all time. */
export function periodStart(period: OverviewPeriod, now: Date = new Date()): Date | null {
  if (period === 'day') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return null;
}

type LineCounts = { active: number; expiring: number; frozen: number; disconnected: number; suspended: number };
type Ranked = { key: string; label: string; count: number; amount: number; profit: number };

/** The first five by `by`, then by volume, then the one sold most recently. */
function rank(rows: (Ranked & { newest: number })[], by: 'count' | 'profit'): Ranked[] {
  return [...rows].sort((a, b) => b[by] - a[by] || b.amount - a.amount || b.newest - a.newest).slice(0, TOP).map(({ key, label, count, amount, profit }) => ({ key, label, count, amount, profit }));
}

/** Groups under one key added together (a package stored with no name and one with an empty name rank as one). */
function merged(groups: SalesGroup[], keyOf: (group: SalesGroup) => { key: string; label: string } | null) {
  const rows = new Map<string, Ranked & { newest: number }>();
  for (const group of [...groups].sort((a, b) => b.newest.getTime() - a.newest.getTime())) {
    const named = keyOf(group);
    if (!named) continue;
    const row = rows.get(named.key) ?? { ...named, count: 0, amount: 0, profit: 0, newest: group.newest.getTime() };
    row.count += group.count;
    row.amount += group.amount;
    row.profit += group.profit;
    rows.set(named.key, row);
  }
  return [...rows.values()];
}

const FORMAT: Record<Step, BucketFormat> = { hour: 'YYYY-MM-DD"T"HH24', day: 'YYYY-MM-DD', month: 'YYYY-MM' };

/** The buckets' figures added up: the period's cards. */
function totalsOf(buckets: SalesBucket[]): PulseTotals {
  return buckets.reduce((sum, row) => ({ count: sum.count + row.count, amount: sum.amount + row.amount, activations: sum.activations + row.activations, profit: sum.profit + row.profit }), emptyTotals());
}

@Injectable()
export class OverviewService {
  constructor(
    private readonly tree: AccountTree,
    private readonly insights: InsightsService,
    private readonly providerAccounts: ProviderAccountsService,
    private readonly health: ProviderHealthService,
    private readonly repo: DeskRepository,
  ) {}

  async overview(actor: Actor, input: OverviewQuery = {}) {
    const period: OverviewPeriod = parseInput(OverviewQuery, input).period ?? 'month';
    const now = new Date();
    const from = periodStart(period, now);
    const accounts = await this.tree.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const isBranch = actor.layer === 'branch';
    const readsProviders = isBranch && !actor.impersonating && holdsAny(actor, ['reports', 'accounting']);

    const [lines, money, users, tasks, providers] = await Promise.all([
      // The branch sees every point of sale and sends no id list (database plan DB.10), as `taskWhereFor` does.
      this.lines(isBranch ? null : posIds, now),
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
   * before it — yesterday's for today, the previous month's last for this month, nothing (zero) for all time. The
   * snapshots are written by `LineSnapshotsService` on a timer; this read writes nothing. Null when there is no
   * snapshot to compare with.
   */
  private async lineChange(actor: Actor, period: OverviewPeriod, lines: LineCounts, now: Date): Promise<LineCounts | null> {
    if (period === 'all') return lines;
    const before = (periodStart(period, now) as Date).toISOString().slice(0, 10);
    const base = await this.repo.lineSnapshotBefore(actor.id, before);
    if (!base) return null;
    return {
      active: lines.active - base.active,
      expiring: lines.expiring - base.expiring,
      frozen: lines.frozen - base.frozen,
      disconnected: lines.disconnected - base.disconnected,
      suspended: lines.suspended - base.suspended,
    };
  }

  /**
   * Lines now, under the viewer: each a slice of the donut (suspended and expiring are read from the end date).
   * `posIds` null is every point of sale (the branch).
   */
  private async lines(posIds: string[] | null, now: Date): Promise<LineCounts> {
    const scope: Prisma.LineWhereInput = posIds ? { posId: { in: posIds } } : {};
    const periods = (await this.repo.suspendPeriods()).map((row) => row.suspendAfterDays);
    const suspendedScope = { AND: [scope, suspendedWhere(periods, now)] };
    // The stored statuses in one grouped read (database plan DB.11). Expiring and suspended are windows on the end
    // date, not statuses: each keeps its count, built from the same rule the numbers list filters by.
    const [stored, expiring, suspended] = await Promise.all([
      this.repo.lineCountsByStatus(scope),
      this.repo.lineCount({ AND: [scope, expiringWhere(now)] }),
      this.repo.lineCount(suspendedScope),
    ]);
    const inStatus = (status: string) => stored.find((row) => row.status === status)?._count._all ?? 0;
    const [active, frozen, disconnected] = [inStatus('active'), inStatus('frozen'), inStatus('disconnected')];
    // A suspended line is still stored as active: it leaves the active slice, and so does an expiring one.
    return { active: Math.max(0, active - expiring - suspended), expiring, frozen, disconnected, suspended };
  }

  /**
   * Sales, refunds, a daily trend, the rankings and the most active accounts, over the period: the sales and refunds
   * whose chain held the viewer at the time (every one for the branch), each with the margin it stored (ADR 0026).
   */
  private async money(actor: Actor, from: Date | null, accounts: Awaited<ReturnType<AccountTree['accounts']>>, period: OverviewPeriod, now: Date) {
    const scope: SalesScope = { view: marginViewOf(actor), from, to: null };
    const isBranch = actor.layer === 'branch';
    const first = period === 'all' ? await this.repo.firstSale(scope) : null;
    const step = stepOf(period, now, first);
    const window = previousWindow(period, now);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    // Every account of the sale's chain under the viewer did this sale: the most active accounts per layer.
    const activeOf = async (layer: 'main_agent' | 'agent' | 'pos') =>
      rank(
        merged(await this.repo.salesByAccount(scope, layer), (group) => {
          const account = group.key ? byId.get(group.key) : undefined;
          return account && account.id !== actor.id && account.layer === layer ? { key: account.id, label: account.loginName } : null;
        }),
        'count',
      ).map((row) => ({ ...row, nickname: byId.get(row.key)?.nickname ?? '' }));
    const [steps, days, packages, companies, providers, previous, mainAgents, agents, poses] = await Promise.all([
      this.repo.salesByBucket(scope, FORMAT[step]),
      step === 'day' ? null : this.repo.salesByBucket(scope, FORMAT.day),
      this.repo.salesBy(scope, 'packageName'),
      this.repo.salesBy(scope, 'companyName'),
      isBranch ? this.repo.salesBy(scope, 'providerId') : [],
      window ? this.repo.salesByBucket({ ...scope, from: window.from, to: window.to }, FORMAT.month).then(totalsOf) : null,
      isBranch ? activeOf('main_agent') : [],
      isBranch || actor.layer === 'main_agent' ? activeOf('agent') : [],
      actor.layer === 'pos' ? [] : activeOf('pos'),
    ]);
    // The providers each sale stored (ADR 0025), named only when there is one to name.
    const providerOf = providers.some((group) => group.key) ? new Map((await this.repo.providerNames()).map((row) => [row.id, row])) : new Map<string, { code: string; name: string }>();
    const daily = days ?? steps;
    const current = totalsOf(steps);
    const refunds = daily.reduce((sum, row) => ({ refunds: sum.refunds + row.refunds, refundAmount: sum.refundAmount + row.refundAmount }), { refunds: 0, refundAmount: 0 });
    const byStep = new Map(steps.map((row) => [row.at, row]));
    const trend: PulsePoint[] = axis(period, now, first).map((at) => {
      const row = byStep.get(at);
      return { at, ...(row ? { count: row.count, amount: row.amount, activations: row.activations, profit: row.profit } : emptyTotals()) };
    });
    const named = (group: SalesGroup) => ({ key: group.key ?? '', label: group.key ?? '—' });
    return {
      sales: {
        count: current.count,
        amount: current.amount,
        profit: current.profit,
        ...refunds,
        net: current.amount - refunds.refundAmount,
        activations: current.activations,
        trend: daily.map((row) => ({ day: row.at, amount: row.amount, profit: row.profit, count: row.count })).sort((a, b) => (a.day < b.day ? -1 : 1)),
      },
      // The home's period cards: this period, the same span before it (null over all time), and the trend.
      pulse: { current, previous, trend },
      top: {
        packages: rank(merged(packages, named), 'count'),
        companies: rank(merged(companies, named), 'profit'),
        providers: isBranch
          ? rank(merged(providers, (group) => {
              const provider = group.key ? providerOf.get(group.key) : undefined;
              return provider ? { key: provider.code, label: provider.name } : null;
            }), 'profit')
          : [],
      },
      active: { main_agent: mainAgents, agent: agents, pos: poses },
    };
  }

  /** The accounts below the viewer: how many per layer, what they owe, and their ceilings. */
  private async users(actor: Actor, accounts: Awaited<ReturnType<AccountTree['accounts']>>, visible: Set<string>) {
    const below = accounts.filter((account) => visible.has(account.id) && account.id !== actor.id && account.layer !== 'branch');
    const wallets = below.length
      ? await this.repo.walletsOf(below.map((account) => account.id))
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
  private async tasks(actor: Actor, accounts: Awaited<ReturnType<AccountTree['accounts']>>, now: Date) {
    const where = taskWhereFor(actor, accounts);
    // One grouped read for every status (database plan DB.11); a status with no task counts zero.
    const [counts, oldest] = await Promise.all([this.repo.taskCountsByStatus(where), this.repo.oldestOpenTask(where)]);
    return {
      ...Object.fromEntries(TASK_STATUSES.map((status) => [status, counts.find((row) => row.status === status)?._count._all ?? 0])),
      oldestOpenMinutes: oldest ? Math.max(0, Math.round((now.getTime() - oldest.createdAt.getTime()) / 60_000)) : null,
    } as Record<(typeof TASK_STATUSES)[number], number> & { oldestOpenMinutes: number | null };
  }

  /**
   * The branch's providers: the period's operations and cost, the balance with them, and a status. The books are read
   * once (database plan DB.4): the health is worked out from the same exact summaries the balances show.
   */
  private async providers(actor: Actor, from: Date | null) {
    const [accounts, supply] = await Promise.all([
      this.providerAccounts.list(actor),
      this.insights.supply(actor, from ? { from: from.toISOString() } : {}),
    ]);
    const health = await this.health.current(new Date(), accounts.rows);
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
