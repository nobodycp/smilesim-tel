import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { visibleAccountIds } from '../office-rules';
import { NEWEST_FIRST } from '../office-paging';
import { REFUND_KINDS, SALE_KINDS } from '../profit-ladder';
import { taskWhereFor } from '../task-access';
import { PROVIDER_OPERATION_KINDS } from '../wallets/provider-cost';
import { WalletsService } from '../wallets/wallets.service';
import { csvOf } from './report-csv';

// The «التقارير» page (spec 2026-11-08-reports, roadmap N5): sales, orders, balances and providers, each scoped to the
// signed-in account's chain like the ledger, with totals and a CSV of the same filters.
export const REPORT_LIMIT = 5_000;

type Period = { from?: string; to?: string; q?: string };
const TASK_OPEN = ['pending', 'working'];

function dateRange(query: Period): Prisma.DateTimeFilter | undefined {
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999` : query.to) : null;
  const range = {
    ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
    ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
  };
  return Object.keys(range).length ? range : undefined;
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly kernel: OfficeKernel,
    private readonly wallets: WalletsService,
  ) {}

  /** Every sale under the viewer: what the point of sale paid and what the viewer earned on it. */
  async sales(actor: Actor, query: Period & { account?: string; kind?: string } = {}) {
    const kind = query.kind && query.kind in SALE_KINDS ? query.kind : undefined;
    const account = (query.account ?? '').trim();
    const rows = await this.kernel.prisma.walletEntry.findMany({
      where: {
        AND: [
          await this.wallets.financeWhere(actor, { from: query.from, to: query.to, q: query.q }),
          { kind: kind ?? { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } },
          ...(account ? [{ user: { loginName: account } }] : []),
        ],
      },
      include: { user: true },
      orderBy: [...NEWEST_FIRST],
      take: REPORT_LIMIT,
    });
    const margins = await this.wallets.marginsFor(actor, rows);
    const list = rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      loginName: row.user.loginName,
      kind: row.kind,
      msisdn: row.msisdn ?? '',
      companyName: row.companyName ?? '',
      packageName: row.packageName ?? '',
      amount: -row.amount,
      margin: margins.get(row.id) ?? null,
    }));
    // The «الحساب» chip: the points of sale under the viewer, whatever the filters.
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const points = accounts
      .filter((row) => row.layer === 'pos' && visible.has(row.id))
      .map((row) => ({ loginName: row.loginName, nickname: row.nickname ?? '' }))
      .sort((a, b) => a.loginName.localeCompare(b.loginName));
    return {
      rows: list,
      totals: {
        count: list.length,
        amount: list.reduce((sum, row) => sum + row.amount, 0),
        profit: list.reduce((sum, row) => sum + (row.margin ?? 0), 0),
      },
      accounts: points,
      capped: rows.length === REPORT_LIMIT,
    };
  }

  /** Every line operation: the done ones from the ledger, and the tasks still open or cancelled. */
  async orders(actor: Actor, query: Period & { status?: string; action?: string } = {}) {
    const action = (query.action ?? '').trim();
    const createdAt = dateRange(query);
    const needle = (query.q ?? '').trim();
    const wantDone = !query.status || query.status === 'done';
    const taskStatuses = !query.status ? [...TASK_OPEN, 'cancelled'] : query.status === 'open' ? TASK_OPEN : query.status === 'cancelled' ? ['cancelled'] : [];
    const accounts = await this.kernel.accounts();
    const [entries, tasks] = await Promise.all([
      wantDone
        ? this.kernel.prisma.walletEntry.findMany({
          where: { AND: [await this.wallets.financeWhere(actor, { from: query.from, to: query.to, q: query.q }), { kind: action ? { in: PROVIDER_OPERATION_KINDS.filter((kind) => kind === action) } : { in: PROVIDER_OPERATION_KINDS } }] },
          include: { user: true, actor: true },
          orderBy: [...NEWEST_FIRST],
          take: REPORT_LIMIT,
        })
        : [],
      taskStatuses.length
        ? this.kernel.prisma.officeTask.findMany({
          where: {
            AND: [
              taskWhereFor(actor, accounts),
              { status: { in: taskStatuses } },
              ...(action ? [{ action }] : []),
              ...(createdAt ? [{ createdAt }] : []),
              ...(needle ? [{ OR: [{ msisdn: { contains: needle.replace(/\s/g, '') } }, { note: { contains: needle, mode: 'insensitive' as const } }] }] : []),
            ],
          },
          orderBy: [...NEWEST_FIRST],
          take: REPORT_LIMIT,
        })
        : [],
    ]);
    // A task has no relation to its point of sale or package: they are read beside it.
    const loginOf = new Map(accounts.map((account) => [account.id, account.loginName]));
    const packages = tasks.length
      ? await this.kernel.prisma.package.findMany({ where: { id: { in: [...new Set(tasks.map((task) => task.packageId))] } }, select: { id: true, name: true, company: { select: { name: true } } } })
      : [];
    const packageOf = new Map(packages.map((row) => [row.id, row]));
    const rows = [
      ...entries.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        loginName: row.user.loginName,
        action: row.kind,
        msisdn: row.msisdn ?? '',
        companyName: row.companyName ?? '',
        packageName: row.packageName ?? '',
        status: 'done',
        amount: row.amount,
        // Who did it: the account that ran the operation; a ledger entry has no task.
        taskId: null as string | null,
        handlerLogin: row.actor?.loginName ?? '',
      })),
      ...tasks.map((task) => ({
        id: task.id,
        at: task.createdAt.toISOString(),
        loginName: loginOf.get(task.posId) ?? '',
        action: task.action,
        msisdn: task.msisdn ?? '',
        companyName: packageOf.get(task.packageId)?.company?.name ?? '',
        packageName: packageOf.get(task.packageId)?.name ?? '',
        status: task.status === 'cancelled' ? 'cancelled' : 'open',
        amount: task.posDelta,
        taskId: task.id as string | null,
        handlerLogin: task.assigneeId ? loginOf.get(task.assigneeId) ?? '' : '',
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, REPORT_LIMIT);
    return {
      rows,
      totals: {
        count: rows.length,
        done: rows.filter((row) => row.status === 'done').length,
        open: rows.filter((row) => row.status === 'open').length,
        cancelled: rows.filter((row) => row.status === 'cancelled').length,
      },
      capped: entries.length === REPORT_LIMIT || tasks.length === REPORT_LIMIT,
    };
  }

  /** The accounts under the viewer, with their wallets and their last movement. */
  async balances(actor: Actor, query: { q?: string; layer?: string; negative?: string } = {}) {
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const needle = (query.q ?? '').trim();
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const listed = accounts.filter((account) => visible.has(account.id) && account.id !== actor.id)
      .filter((account) => !query.layer || account.layer === query.layer)
      .filter((account) => !needle || account.loginName.includes(needle) || account.nickname.includes(needle));
    const ids = listed.map((account) => account.id);
    const [wallets, last] = await Promise.all([
      this.kernel.prisma.wallet.findMany({ where: { userId: { in: ids } } }),
      this.kernel.prisma.walletEntry.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { createdAt: true } }),
    ]);
    const walletOf = new Map(wallets.map((row) => [row.userId, row]));
    const lastOf = new Map(last.map((row) => [row.userId, row._max.createdAt]));
    const rows = listed.map((account) => {
      const balance = walletOf.get(account.id)?.balance ?? 0;
      const ceiling = account.layer === 'branch' ? 0 : walletOf.get(account.id)?.ceiling ?? 0;
      const held = walletOf.get(account.id)?.held ?? 0;
      return {
        loginName: account.loginName,
        nickname: account.nickname,
        layer: account.layer,
        parentLogin: account.parentId ? byId.get(account.parentId)?.loginName ?? null : null,
        balance,
        ceiling,
        used: Math.max(0, -balance),
        held,
        available: balance + ceiling - held,
        frozen: account.disabledAt !== null,
        lastAt: lastOf.get(account.id)?.toISOString() ?? null,
      };
    }).filter((row) => query.negative !== '1' || row.balance < 0);
    return {
      rows,
      totals: {
        count: rows.length,
        balance: rows.reduce((sum, row) => sum + row.balance, 0),
        used: rows.reduce((sum, row) => sum + row.used, 0),
      },
      capped: false,
    };
  }

  /** Per provider over the dates (branch, with the reports grant): operations, what they cost, and the branch's profit. */
  async supply(actor: Actor, query: Period = {}) {
    if (actor.layer !== 'branch' || actor.impersonating || (!actor.isBranchOwner && !actor.grants.includes('reports'))) fail(403, 'REPORTS_BRANCH_ONLY');
    const createdAt = dateRange(query);
    const rows = await this.kernel.prisma.walletEntry.findMany({
      where: { kind: { in: PROVIDER_OPERATION_KINDS }, ...(createdAt ? { createdAt } : {}) },
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true, providerCost: true },
      orderBy: [...NEWEST_FIRST],
      take: REPORT_LIMIT,
    });
    const lines = await this.kernel.prisma.line.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.lineId).filter((id): id is string => Boolean(id)))] } },
      select: { id: true, package: { select: { provider: { select: { code: true, name: true } } } } },
    });
    const providerOf = new Map(lines.map((line) => [line.id, line.package.provider]));
    const margins = await this.wallets.marginsFor(actor, rows.filter((row) => SALE_KINDS[row.kind] || REFUND_KINDS.has(row.kind)));
    const groups = new Map<string, { providerCode: string; providerName: string; operations: number; cost: number; profit: number }>();
    for (const row of rows) {
      const provider = row.lineId ? providerOf.get(row.lineId) : undefined;
      if (!provider) continue;
      const group = groups.get(provider.code) ?? { providerCode: provider.code, providerName: provider.name, operations: 0, cost: 0, profit: 0 };
      group.operations += 1;
      group.cost += row.providerCost ?? 0;
      group.profit += margins.get(row.id) ?? 0;
      groups.set(provider.code, group);
    }
    const list = [...groups.values()].sort((a, b) => b.operations - a.operations);
    return {
      rows: list,
      totals: list.reduce((sum, row) => ({ operations: sum.operations + row.operations, cost: sum.cost + row.cost, profit: sum.profit + row.profit }), { operations: 0, cost: 0, profit: 0 }),
      capped: rows.length === REPORT_LIMIT,
    };
  }

  /** A report as CSV: the same rows, money in shekels. */
  async csv(actor: Actor, kind: string, query: Record<string, string | undefined>) {
    if (kind === 'sales') {
      const { rows } = await this.sales(actor, query);
      return csvOf(['at', 'account', 'kind', 'number', 'company', 'package', 'amount', 'my_margin'], rows.map((row) => [row.at, row.loginName, row.kind, row.msisdn, row.companyName, row.packageName, { money: row.amount }, row.margin === null ? '' : { money: row.margin }]));
    }
    if (kind === 'orders') {
      const { rows } = await this.orders(actor, query);
      return csvOf(['at', 'task', 'account', 'action', 'number', 'company', 'package', 'status', 'handler', 'amount'], rows.map((row) => [row.at, row.taskId ?? '', row.loginName, row.action, row.msisdn, row.companyName, row.packageName, row.status, row.handlerLogin, { money: row.amount }]));
    }
    if (kind === 'balances') {
      const { rows } = await this.balances(actor, query);
      return csvOf(['account', 'name', 'layer', 'parent', 'balance', 'ceiling', 'used', 'held', 'available', 'frozen', 'last_movement'], rows.map((row) => [row.loginName, row.nickname, row.layer, row.parentLogin ?? '', { money: row.balance }, { money: row.ceiling }, { money: row.used }, { money: row.held }, { money: row.available }, row.frozen ? 'yes' : 'no', row.lastAt ?? '']));
    }
    if (kind === 'supply') {
      const { rows } = await this.supply(actor, query);
      return csvOf(['provider', 'operations', 'cost', 'branch_profit'], rows.map((row) => [row.providerName, row.operations, { money: row.cost }, { money: row.profit }]));
    }
    fail(404, 'NOT_FOUND');
  }
}
