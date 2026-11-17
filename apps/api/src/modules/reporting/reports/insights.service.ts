import { PeriodQuery, isOn, parseInput, dayRange, keyPage, BALANCES_PAGE, fail } from '../../platform';
import { BalancesQuery, type BalancesFilter } from './reports.schemas';
import { ReportsRepository } from './reports.repository';
import { AccountTree, requireGrant, visibleAccountIds } from '../../access';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import type { Actor } from '../../access';
import { PROVIDER_OPERATION_KINDS, csvOf } from '../../wallets';

// The «التقارير» page (spec 2026-11-08-reports, roadmap N5): balances and providers, each scoped to the signed-in
// account's chain like the ledger, with totals and a CSV of the same filters. Sales and orders left by spec
// 2026-11-09-admin-review, 1 (their rows are read from «المالية» and «المهام»).

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
    private readonly tree: AccountTree,
    private readonly repo: ReportsRepository,
  ) {}

  /** The accounts under the viewer, with their wallets and their last movement. */
  /** One page of the balances report, with the totals of every matching account beside it. */
  async balances(actor: Actor, input: BalancesQuery = {}) {
    const query = parseInput(BalancesQuery, input);
    const rows = await this.balanceRows(actor, query);
    return {
      ...keyPage(rows, BALANCES_PAGE, query.cursor, (row) => row.loginName),
      totals: {
        count: rows.length,
        balance: rows.reduce((sum, row) => sum + row.balance, 0),
        used: rows.reduce((sum, row) => sum + row.used, 0),
      },
    };
  }

  /** Every account of the report under its filters: the page above and the CSV export read it. */
  private async balanceRows(actor: Actor, query: BalancesFilter) {
    const accounts = await this.tree.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const needle = (query.q ?? '').trim();
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const listed = accounts.filter((account) => visible.has(account.id) && account.id !== actor.id)
      .filter((account) => !query.layer || account.layer === query.layer)
      .filter((account) => !needle || account.loginName.includes(needle) || account.nickname.includes(needle));
    const ids = listed.map((account) => account.id);
    const [wallets, last] = await Promise.all([
      this.repo.walletsOf(ids),
      this.repo.lastMovementOf(ids),
    ]);
    const walletOf = new Map(wallets.map((row) => [row.userId, row]));
    const lastOf = new Map(last.map((row) => [row.userId, row._max.createdAt]));
    return listed.map((account) => {
      const balance = walletOf.get(account.id)?.balance ?? 0;
      const ceiling = account.layer === 'branch' ? 0 : walletOf.get(account.id)?.ceiling ?? 0;
      const held = walletOf.get(account.id)?.held ?? 0;
      return {
        loginName: account.loginName,
        nickname: account.nickname,
        layer: account.layer,
        parentLoginName: account.parentId ? byId.get(account.parentId)?.loginName ?? null : null,
        balance,
        ceiling,
        used: Math.max(0, -balance),
        held,
        available: balance + ceiling - held,
        frozen: account.disabledAt !== null,
        lastAt: lastOf.get(account.id)?.toISOString() ?? null,
      };
    }).filter((row) => !isOn(query.negative) || row.balance < 0);
  }

  /**
   * Per provider over the dates (branch, with the reports grant): operations, what they cost, and the branch's
   * profit. The provider and the cost are the ones each operation stored when it was written, as in the provider
   * books (ADR 0025 rule 5: one definition of cost); the profit is the branch's margin each sale and refund stored
   * (ADR 0026). One grouped sum, exact over any dates.
   */
  async supply(actor: Actor, input: PeriodQuery = {}) {
    if (actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    requireGrant(actor, 'reports', 'REPORTS_BRANCH_ONLY');
    const query = parseInput(PeriodQuery, input);
    const [groups, providers] = await Promise.all([this.repo.providerFigures(PROVIDER_OPERATION_KINDS, dateRange(query)), this.repo.providerNames()]);
    const providerOf = new Map(providers.map((provider) => [provider.id, provider]));
    const list = groups
      .flatMap((row) => {
        const provider = row.providerId ? providerOf.get(row.providerId) : undefined;
        // Never null on an operation entry (the CHECK `WalletEntry_operation_priced`).
        return provider
          ? [{ providerCode: provider.code, providerName: provider.name, operations: row._count._all, cost: row._sum.providerCost ?? 0, profit: row._sum.branchMargin ?? 0, newest: row._max.createdAt?.getTime() ?? 0 }]
          : [];
      })
      // The busiest first; between equals, the one with the newest operation.
      .sort((a, b) => b.operations - a.operations || b.newest - a.newest)
      .map(({ providerCode, providerName, operations, cost, profit }) => ({ providerCode, providerName, operations, cost, profit }));
    return {
      rows: list,
      totals: list.reduce((sum, row) => ({ operations: sum.operations + row.operations, cost: sum.cost + row.cost, profit: sum.profit + row.profit }), { operations: 0, cost: 0, profit: 0 }),
    };
  }

  /** The balances report as CSV: every matching account, money in shekels. */
  async balancesCsv(actor: Actor, input: BalancesQuery = {}) {
    const rows = await this.balanceRows(actor, parseInput(BalancesQuery, input));
    return csvOf(['account', 'name', 'layer', 'parent', 'balance', 'ceiling', 'used', 'held', 'available', 'frozen', 'last_movement'], rows.map((row) => [row.loginName, row.nickname, row.layer, row.parentLoginName ?? '', { money: row.balance }, { money: row.ceiling }, { money: row.used }, { money: row.held }, { money: row.available }, row.frozen ? 'yes' : 'no', row.lastAt ?? '']));
  }

  /** The providers report over the dates as CSV. */
  async supplyCsv(actor: Actor, input: PeriodQuery = {}) {
    const { rows } = await this.supply(actor, input);
    return csvOf(['provider', 'operations', 'cost', 'branch_profit'], rows.map((row) => [row.providerName, row.operations, { money: row.cost }, { money: row.profit }]));
  }
}
