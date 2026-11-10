import { ReportsRepository } from './reports.repository';
import { AccountTree } from '../kernel/account-tree';
import { UnitOfWork } from '../kernel/unit-of-work';
import { dayRange } from '../../shared/dates';
import { requireGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { visibleAccountIds } from '../rules/office-rules';
import { NEWEST_FIRST } from '../rules/office-paging';
import { REFUND_KINDS, SALE_KINDS } from '../rules/profit-ladder';
import { PROVIDER_OPERATION_KINDS } from '../wallets/provider-cost';
import { WalletsService } from '../wallets/wallets.service';
import { csvOf } from './report-csv';

// The «التقارير» page (spec 2026-11-08-reports, roadmap N5): balances and providers, each scoped to the signed-in
// account's chain like the ledger, with totals and a CSV of the same filters. Sales and orders left by spec
// 2026-11-09-admin-review, 1 (their rows are read from «المالية» and «المهام»).
export const REPORT_LIMIT = 5_000;

type Period = { from?: string; to?: string; q?: string };

function dateRange(query: Period): Prisma.DateTimeFilter | undefined {
  const { from, to } = dayRange(query.from, query.to);
  const range = {
    ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
    ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
  };
  return Object.keys(range).length ? range : undefined;
}

@Injectable()
export class InsightsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tree: AccountTree,
    private readonly wallets: WalletsService,
    readonly repo: ReportsRepository,
  ) {}

  /** The accounts under the viewer, with their wallets and their last movement. */
  async balances(actor: Actor, query: { q?: string; layer?: string; negative?: string } = {}) {
    const accounts = await this.tree.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const needle = (query.q ?? '').trim();
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const listed = accounts.filter((account) => visible.has(account.id) && account.id !== actor.id)
      .filter((account) => !query.layer || account.layer === query.layer)
      .filter((account) => !needle || account.loginName.includes(needle) || account.nickname.includes(needle));
    const ids = listed.map((account) => account.id);
    const [wallets, last] = await Promise.all([
      this.uow.prisma.wallet.findMany({ where: { userId: { in: ids } } }),
      this.uow.prisma.walletEntry.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { createdAt: true } }),
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
    if (actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    requireGrant(actor, 'reports', 'REPORTS_BRANCH_ONLY');
    const createdAt = dateRange(query);
    const rows = await this.uow.prisma.walletEntry.findMany({
      where: { kind: { in: PROVIDER_OPERATION_KINDS }, ...(createdAt ? { createdAt } : {}) },
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true, providerCost: true },
      orderBy: [...NEWEST_FIRST],
      take: REPORT_LIMIT,
    });
    const lines = await this.uow.prisma.line.findMany({
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
