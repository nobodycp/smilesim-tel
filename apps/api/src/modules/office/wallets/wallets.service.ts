import { WalletsRepository } from './wallets.repository';
import { PriceLadder } from '../terms/price-ladder';
import { WalletLedger } from './wallet-ledger';
import { AccountTree } from '../kernel/account-tree';
import { UnitOfWork } from '../kernel/unit-of-work';
import { dayRange } from '../../shared/dates';
import { requireGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { parseInput } from '../../shared/input';
import type { Actor } from '../kernel/types';
import { after, cursorPosition, keyPage, page } from '../../shared/paging';
import { BALANCES_PAGE, FEED_PAGE } from '../rules/office-paging';
import { visibleAccountIds } from '../rules/office-rules';
import { CeilingBody, DeductBody, FundBody } from './wallets.schemas';
import { PROVIDER_OPERATION_KINDS, pricedOp } from './provider-cost';
import { matchOf } from '../providers/match-simulator';
import { SUMMARY_DAYS, ledgerCsv, profitCsv, walletSummary, windowStart } from './finance-summary';
import { REFUND_KINDS, SALE_KINDS, ladderOf, marginOf, refundLadder, type Ladder } from '../rules/profit-ladder';
import type { Account } from '../kernel/types';

const FINANCE_CSV_LIMIT = 10_000;
const PROFIT_REPORT_LIMIT = 50_000;

/** Wallets and money reads: the wallets an account sees, funding and ceilings, the ledger, the finance report and provider operations. Branch reports are in ReportsService. */
@Injectable()
export class WalletsService {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree, private readonly money: WalletLedger, private readonly ladder: PriceLadder, private readonly repo: WalletsRepository) {}

  /** One page of the wallets the actor may see, in the tree's order. */
  async list(actor: Actor, cursor?: string) {
    const accounts = await this.tree.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const rows = await this.repo.walletsOf([...visible]);
    const byUser = new Map(rows.map((row) => [row.userId, row]));
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return keyPage(
      accounts
        .filter((account) => visible.has(account.id))
        .map((account) => ({
          loginName: account.loginName,
          nickname: account.nickname,
          layer: account.layer,
          balance: byUser.get(account.id)?.balance ?? 0,
          ceiling: byUser.get(account.id)?.ceiling ?? 0,
          parentLogin: account.parentId ? byId.get(account.parentId)?.loginName ?? null : null,
          self: account.id === actor.id,
          directChild: account.parentId === actor.id,
        })),
      BALANCES_PAGE,
      cursor,
      (row) => row.loginName,
    );
  }

  async fund(actor: Actor, loginName: string, body: unknown) {
    const { amount, note, reason } = parseInput(FundBody, body);
    const accounts = await this.tree.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target) fail(404, 'NOT_FOUND');
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    if (!visible.has(target.id)) fail(404, 'NOT_FOUND');
    const self = target.id === actor.id;
    if (self) {
      if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
      if (!note) fail(400, 'NOTE_REQUIRED');
    } else if (actor.layer !== 'branch' && target.parentId !== actor.id) {
      fail(403, 'FORBIDDEN');
    }
    await this.uow.runTx(async (tx) => {
      await this.money.lockWallets(tx, [actor.id, target.id]);
      if (!self) await this.money.move(tx, actor.id, -amount, actor.operatorId, 'fund', note, undefined, reason);
      await this.money.move(tx, target.id, amount, actor.operatorId, self ? 'self_fund' : 'fund', note, undefined, reason);
      if (!self) {
        this.uow.queueNotices(tx, await this.uow.notice.write(tx, [target.id], actor, {
          kind: 'fund.received',
          payload: { amount, senderName: actor.nickname, note },
        }));
      }
    });
    return { ok: true };
  }

  /**
   * Takes money back from a child (roadmap N6): a return, a correction or a settlement, always with a note. The same
   * accounts that may fund it may take back: the branch any account below it, everyone else a direct child. The
   * child's wallet goes down (`deduct`, within its ceiling) and the parent's up by the same amount (`deduct_in`).
   */
  async deduct(actor: Actor, loginName: string, body: unknown) {
    const { amount, note, reason } = parseInput(DeductBody, body);
    if (!note) fail(400, 'NOTE_REQUIRED');
    const accounts = await this.tree.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target) fail(404, 'NOT_FOUND');
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    if (!visible.has(target.id)) fail(404, 'NOT_FOUND');
    if (target.id === actor.id) fail(403, 'FORBIDDEN');
    if (actor.layer !== 'branch' && target.parentId !== actor.id) fail(403, 'FORBIDDEN');
    await this.uow.runTx(async (tx) => {
      await this.money.lockWallets(tx, [actor.id, target.id]);
      await this.money.move(tx, target.id, -amount, actor.operatorId, 'deduct', note, undefined, reason);
      await this.money.move(tx, actor.id, amount, actor.operatorId, 'deduct_in', note, undefined, reason);
      this.uow.queueNotices(tx, await this.uow.notice.write(tx, [target.id], actor, {
        kind: 'fund.deducted',
        payload: { amount, senderName: actor.nickname, note, reason },
      }));
    });
    return { ok: true };
  }

  async setCeiling(actor: Actor, loginName: string, body: unknown) {
    const { ceiling } = parseInput(CeilingBody, body);
    const accounts = await this.tree.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target || !visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(404, 'NOT_FOUND');
    if (target.parentId !== actor.id) fail(403, 'FORBIDDEN');
    await this.repo.setCeiling(target.id, ceiling);
    return { ok: true };
  }

  /** The signed-in account's own wallet («المحفظة»). The tree's entries are «المالية» (`finance`). */
  async ledger(actor: Actor, query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string }) {
    const allowed = [...PROVIDER_OPERATION_KINDS, 'fund', 'self_fund', 'deduct', 'deduct_in'];
    const kind = query.kind && allowed.includes(query.kind) ? query.kind : '';
    const { from, to } = dayRange(query.from, query.to);
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    const where: Prisma.WalletEntryWhereInput = {
      userId: actor.id,
      kind: { in: kind ? [kind] : allowed },
      ...(query.direction === 'in' ? { amount: { gt: 0 } } : {}),
      ...(query.direction === 'out' ? { amount: { lt: 0 } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };
    const [read, total] = await Promise.all([
      this.repo.entriesWithAccounts({ ...where, AND: after(cursorPosition(query.cursor)) }, FEED_PAGE + 1),
      this.repo.countEntries(where),
    ]);
    const { items: rows, nextCursor } = page(read, FEED_PAGE);
    return {
      items: rows.map((row) => ({
        /** The wallet's account; `margin` stays in the shape and is null (the viewer's own wallet carries none). */
        loginName: row.user?.loginName ?? actor.loginName,
        layer: row.user?.layer ?? actor.layer,
        margin: null as number | null,
        id: row.id,
        at: row.createdAt.toISOString(),
        kind: row.kind,
        amount: row.amount,
        balanceBefore: row.balanceAfter - row.amount,
        balanceAfter: row.balanceAfter,
        note: row.note,
        packageName: row.packageName,
        msisdn: row.msisdn,
        actorLogin: row.actor.loginName,
      })),
      nextCursor,
      total,
    };
  }

  /**
   * Every line operation with what it cost at its provider (provider-cost.ts `pricedOp`, or the cost kept on the
   * entry), newest first. Shared by the provider-operations report and the provider accounts (roadmap N7).
   */
  async pricedOperations(filter: { kind?: string; msisdn?: string } = {}) {
    const rows = await this.repo.operationEntries({
      kind: { in: filter.kind ? [filter.kind] : PROVIDER_OPERATION_KINDS },
      ...(filter.msisdn ? { msisdn: { contains: filter.msisdn } } : {}),
    });
    const lineIds = [...new Set(rows.flatMap((row) => (row.lineId ? [row.lineId] : [])))];
    const [lines, packages] = await Promise.all([
      lineIds.length ? this.repo.linesWithPackage(lineIds) : [],
      this.repo.packagesWithProvider(),
    ]);
    const lineById = new Map(lines.map((line) => [line.id, line]));
    return rows.map((row) => {
      const priced = pricedOp(row.kind, row.packageName ?? '', row.companyName ?? '', row.lineId ? lineById.get(row.lineId) : undefined, packages);
      return {
        id: row.id,
        at: row.createdAt,
        kind: row.kind,
        msisdn: row.msisdn ?? '',
        companyName: row.companyName ?? '',
        packageName: row.packageName ?? '',
        ...priced,
        cost: row.providerCost ?? priced.cost,
        esimPrice: row.esimPrice ?? null,
      };
    });
  }

  async providerOperations(actor: Actor, query: { cursor?: string; kind?: string; provider?: string; q?: string; from?: string; to?: string; match?: string } = {}) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    requireGrant(actor, 'reports', 'REPORTS_BRANCH_ONLY');
    const kind = query.kind && PROVIDER_OPERATION_KINDS.includes(query.kind) ? query.kind : '';
    const needle = (query.q ?? '').replace(/\s/g, '');
    const { from, to } = dayRange(query.from, query.to);
    const [resolved, providers] = await Promise.all([
      this.pricedOperations({ kind: kind || undefined, msisdn: needle || undefined }),
      this.repo.providersByName(),
    ]);
    const chosen = query.provider ? resolved.filter((row) => row.providerCode === query.provider) : resolved;
    // Matching, simulated until real providers are connected (spec E): each row's state against its provider.
    const providerByCode = new Map(providers.map((item) => [item.code, item]));
    const matchFor = (row: { id: string; at: Date; cost: number; providerCode: string }) => {
      const provider = providerByCode.get(row.providerCode);
      return matchOf(row, { matchSource: provider?.matchSource ?? 'statement', lastMatchedAt: provider?.lastMatchedAt ?? null });
    };
    const dated = chosen.filter((row) => {
      if (from && !Number.isNaN(from.getTime()) && row.at < from) return false;
      if (to && !Number.isNaN(to.getTime()) && row.at > to) return false;
      return true;
    });
    const matches = new Map(dated.map((row) => [row.id, matchFor(row)]));
    const ranged = query.match === 'matched' || query.match === 'difference' || query.match === 'pending'
      ? dated.filter((row) => matches.get(row.id)?.state === query.match)
      : dated;
    const now = new Date();
    const monthCost = chosen
      .filter((row) => row.at.getFullYear() === now.getFullYear() && row.at.getMonth() === now.getMonth())
      .reduce((sum, row) => sum + row.cost, 0);
    const position = cursorPosition(query.cursor);
    const window = position
      ? ranged.filter((row) => row.at < position.at || (row.at.getTime() === position.at.getTime() && row.id < position.id))
      : ranged;
    const { items, nextCursor } = page(window, FEED_PAGE, (row) => row.at);
    return {
      items: items.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        kind: row.kind,
        msisdn: row.msisdn,
        providerCode: row.providerCode,
        providerName: row.providerName,
        companyName: row.companyName,
        packageName: row.packageName,
        cost: row.cost,
        esimPrice: row.esimPrice,
        matchSource: providerByCode.get(row.providerCode)?.matchSource ?? 'statement',
        matchState: matches.get(row.id)?.state ?? 'pending',
        providerAmount: matches.get(row.id)?.providerAmount ?? null,
        difference: matches.get(row.id)?.difference ?? null,
      })),
      nextCursor,
      total: ranged.length,
      stats: {
        count: ranged.length,
        cost: ranged.reduce((sum, row) => sum + row.cost, 0),
        monthCost,
        matched: dated.filter((row) => matches.get(row.id)?.state === 'matched').length,
        differences: dated.filter((row) => matches.get(row.id)?.state === 'difference').length,
        pending: dated.filter((row) => matches.get(row.id)?.state === 'pending').length,
        differenceAmount: dated.reduce((sum, row) => sum + (matches.get(row.id)?.difference ?? 0), 0),
      },
      providers: providers.map((item) => ({ code: item.code, name: item.name, matchSource: item.matchSource })),
    };
  }

  /** The ledger's filter: the entries of the visible accounts (every entry for the branch), narrowed by the query. */
  /** Public for the reports, which read the same entries. */
  async financeWhere(actor: Actor, query: { kind?: string; layer?: string; q?: string; from?: string; to?: string; scope?: string }): Promise<Prisma.WalletEntryWhereInput> {
    const accounts = await this.tree.accounts();
    const visible = [...visibleAccountIds(actor.id, actor.layer, accounts)];
    const { from, to } = dayRange(query.from, query.to);
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    const needle = (query.q ?? '').trim();
    const digits = needle.replace(/\s/g, '');
    return {
      ...(actor.layer === 'branch' ? {} : { userId: { in: visible } }),
      // Every entry of the viewer and the accounts below it (owner 2026-11-09: «شامله كل العمليات للاب والابناء»),
      // operations that move no money included. `scope=money` keeps the money movements, and the holds and releases
      // of open tasks, which move no money but change what is spendable.
      ...(query.scope === 'money' ? { AND: [{ OR: [{ amount: { not: 0 } }, { kind: { in: ['hold', 'release'] } }] }] } : {}),
      // `scope=operations` keeps the line operations only (spec 2026-11-09-admin-review, 1): what «العمليات» listed.
      ...(query.scope === 'operations' ? { AND: [{ kind: { in: PROVIDER_OPERATION_KINDS } }] } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.layer ? { user: { layer: query.layer } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(needle
        ? {
            OR: [
              ...(digits ? [{ msisdn: { contains: digits } }] : []),
              { note: { contains: needle, mode: 'insensitive' as const } },
              { packageName: { contains: needle, mode: 'insensitive' as const } },
              { companyName: { contains: needle, mode: 'insensitive' as const } },
              { user: { loginName: { contains: needle, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
  }

  /** Each sale entry's ladder: the one it kept, else today's prices with what the point of sale paid. */
  private async laddersOf(rows: { id: string; userId: string; kind: string; lineId: string | null; packagePrice: number | null; ladder: unknown }[]) {
    const ladders = new Map<string, Ladder>();
    const missing = rows.filter((row) => !row.ladder);
    for (const row of rows) if (row.ladder) ladders.set(row.id, row.ladder as Ladder);
    if (!missing.length) return ladders;
    const accounts = await this.tree.accounts();
    const lines = await this.repo.lineTerms([...new Set(missing.map((row) => row.lineId as string))]);
    const codeOf = new Map(lines.map((line) => [line.id, (line.terms as { packageCode?: string } | null)?.packageCode ?? '']));
    const paths = new Map(missing.map((row) => [row.userId, this.tree.pathOf(row.userId, accounts)]));
    const codes = [...new Set([...codeOf.values()].filter(Boolean))];
    const ids = [...new Set([...paths.values()].flat().map((node) => node.id))];
    const [ladderRows, subscribers] = await Promise.all([
      this.ladder.ladderRows(codes, ids, this.uow.prisma),
      this.repo.subscriberPrices(codes),
    ]);
    for (const row of missing) {
      const pkg = ladderRows.packages.find((item) => item.code === codeOf.get(row.lineId as string));
      const subscriber = subscribers.find((item) => item.code === pkg?.code);
      const path = paths.get(row.userId) ?? [];
      if (!pkg || !subscriber || path.length === 0 || !SALE_KINDS[row.kind]) continue;
      ladders.set(row.id, ladderOf(
        path,
        ladderRows.termRows.filter((term) => term.packageId === pkg.id),
        ladderRows.sellRows.filter((sell) => sell.packageId === pkg.id),
        { ...pkg, ...subscriber },
        SALE_KINDS[row.kind],
        row.packagePrice,
      ));
    }
    return ladders;
  }

  /**
   * What the signed-in account earned on each sale entry, and gave back on each refund (profit-ladder.ts). A sale uses
   * the chain it kept, or, recorded before chains were kept, today's prices with what the point of sale paid. A refund
   * takes back its share of the line's last sale before it. A branch account (the owner or staff) sees the branch's
   * margin. Entries that are neither, or not in its chain, get none.
   */
  /** Each sale's and refund's ladder (the chain and what each paid), keyed by entry id; other entries are left out. */
  async laddersFor(
    rows: { id: string; userId: string; kind: string; lineId: string | null; packagePrice: number | null; amount: number; ladder: unknown; createdAt?: Date }[],
  ) {
    const sales = rows.filter((row) => SALE_KINDS[row.kind] && row.lineId && row.amount < 0);
    const refunds = rows.filter((row) => REFUND_KINDS.has(row.kind) && row.lineId && row.amount > 0);
    const ladders = await this.laddersOf(sales);
    const oldRefunds = refunds.filter((row) => !row.ladder);
    for (const row of refunds) if (row.ladder) ladders.set(row.id, row.ladder as Ladder);
    if (oldRefunds.length) {
      const earlier = await this.repo.salesOfLines([...new Set(oldRefunds.map((row) => row.lineId as string))], Object.keys(SALE_KINDS));
      const bases = await this.laddersOf(earlier);
      for (const row of oldRefunds) {
        const sale = earlier.find((item) => item.lineId === row.lineId && (!row.createdAt || item.createdAt <= row.createdAt));
        const base = sale ? bases.get(sale.id) : undefined;
        const ladder = base ? refundLadder(base, row.amount, row.packagePrice || sale?.packagePrice || 0) : null;
        if (ladder) ladders.set(row.id, ladder);
      }
    }
    return ladders;
  }

  async marginsFor(
    actor: Actor,
    rows: { id: string; userId: string; kind: string; lineId: string | null; packagePrice: number | null; amount: number; ladder: unknown; createdAt?: Date }[],
  ) {
    const ladders = await this.laddersFor(rows);
    const margins = new Map<string, number | null>();
    for (const [id, ladder] of ladders) {
      const viewer = actor.layer === 'branch' ? ladder.chain[ladder.chain.length - 1] : actor.id;
      margins.set(id, marginOf(ladder, viewer));
    }
    return margins;
  }

  /**
   * The signed-in account's profit by package over a period (roadmap N4): sales, refunds and net profit for each
   * package sold in its chain, newest package first, with the totals. Same filters as the ledger (`from`, `to`, `q`).
   */
  async profitReport(actor: Actor, query: { from?: string; to?: string; q?: string } = {}) {
    const rows = await this.repo.profitEntries({
      AND: [
        await this.financeWhere(actor, query),
        { OR: [{ kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } }, { kind: { in: [...REFUND_KINDS] }, amount: { gt: 0 } }] },
      ],
    }, PROFIT_REPORT_LIMIT);
    const margins = await this.marginsFor(actor, rows);
    const groups = new Map<string, { packageName: string; companyName: string; sales: number; refunds: number; profit: number }>();
    for (const row of rows) {
      const margin = margins.get(row.id);
      if (margin == null) continue;
      const key = `${row.companyName ?? ''}\n${row.packageName ?? ''}`;
      const group = groups.get(key) ?? { packageName: row.packageName ?? '', companyName: row.companyName ?? '', sales: 0, refunds: 0, profit: 0 };
      if (row.amount < 0) group.sales += 1;
      else group.refunds += 1;
      group.profit += margin;
      groups.set(key, group);
    }
    const packages = [...groups.values()];
    const totals = packages.reduce((sum, row) => ({ sales: sum.sales + row.sales, refunds: sum.refunds + row.refunds, profit: sum.profit + row.profit }), { sales: 0, refunds: 0, profit: 0 });
    return { packages, totals, capped: rows.length === PROFIT_REPORT_LIMIT };
  }

  /** The profit report as a CSV (BOM, shekels). */
  async profitCsv(actor: Actor, query: { from?: string; to?: string; q?: string } = {}) {
    const { packages, totals } = await this.profitReport(actor, query);
    return profitCsv([...packages, { packageName: 'TOTAL', companyName: '', ...totals }]);
  }

  /** The signed-in account's own wallet over the last `days` (7, 30 or 90): the finance page's cards and chart. */
  async financeSummary(actor: Actor, now = new Date(), days = SUMMARY_DAYS) {
    const [wallet, entries] = await Promise.all([
      this.repo.walletOf(actor.id),
      this.repo.movementsSince(actor.id, windowStart(now, days)),
    ]);
    const balance = wallet?.balance ?? 0;
    // What this account earned on the sales under it (or its own) over the same window.
    const sold = await this.repo.soldEntries({
      ...(await this.financeWhere(actor, {})),
      OR: [{ kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } }, { kind: { in: [...REFUND_KINDS] }, amount: { gt: 0 } }],
      createdAt: { gte: windowStart(now, days) },
    });
    const margins = await this.marginsFor(actor, sold);
    const profit = [...margins.values()].reduce((sum: number, value) => sum + (value ?? 0), 0);
    const sales = sold.filter((row) => row.amount < 0).length;
    return { balance, ceiling: wallet?.ceiling ?? 0, held: wallet?.held ?? 0, unlimited: actor.layer === 'branch', profit, sales, ...walletSummary(entries, balance, now, days) };
  }

  /** The ledger with the page's filters as a CSV, newest first, at most 10,000 rows. */
  async financeCsv(actor: Actor, query: { kind?: string; layer?: string; q?: string; from?: string; to?: string; scope?: string } = {}) {
    const rows = await this.repo.entriesWithAccounts(await this.financeWhere(actor, query), FINANCE_CSV_LIMIT);
    return ledgerCsv(rows.map((row) => ({
      at: row.createdAt.toISOString(),
      loginName: row.user.loginName,
      layer: row.user.layer,
      actorLogin: row.actor.loginName,
      kind: row.kind,
      amount: row.amount,
      balanceBefore: row.balanceAfter - row.amount,
      balanceAfter: row.balanceAfter,
      msisdn: row.msisdn ?? '',
      companyName: row.companyName ?? '',
      packageName: row.packageName ?? '',
      note: row.note ?? '',
    })));
  }

  async finance(actor: Actor, query: { cursor?: string; kind?: string; layer?: string; q?: string; from?: string; to?: string; scope?: string } = {}) {
    const position = cursorPosition(query.cursor);
    const where = await this.financeWhere(actor, query);
    const [rows, total] = await Promise.all([
      // The page cursor joins the ledger filter instead of replacing its own conditions.
      this.repo.entriesWithAccounts(position ? { AND: [where, ...after(position)] } : where, FEED_PAGE + 1),
      this.repo.countEntries(where),
    ]);
    const { items, nextCursor } = page(rows, FEED_PAGE);
    const ladders = await this.laddersFor(items);
    const margins = await this.marginsFor(actor, items);
    const accounts = actor.layer === 'branch' ? await this.tree.accounts() : [];
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return {
      total,
      items: items.map((row) => ({
        /**
         * For the branch: what every account in the sale's chain earned on it, branch first. Null for other viewers
         * and for entries that are not a sale or a refund.
         */
        shares: actor.layer === 'branch' && ladders.has(row.id) ? sharesOf(ladders.get(row.id) as Ladder, byId) : null,
        /** What the signed-in account earned on this sale; null when it is not a sale in its chain. */
        margin: margins.get(row.id) ?? null,
        id: row.id,
        at: row.createdAt.toISOString(),
        loginName: row.user.loginName,
        layer: row.user.layer,
        actorLogin: row.actor.loginName,
        kind: row.kind,
        amount: row.amount,
        balanceBefore: row.balanceAfter - row.amount,
        balanceAfter: row.balanceAfter,
        /** Why a manual movement was made; and for a hold or release, the amount held or freed. */
        reason: row.reason ?? null,
        held: row.held ?? null,
        msisdn: row.msisdn ?? '',
        companyName: row.companyName ?? '',
        packageName: row.packageName ?? '',
        packagePrice: row.packagePrice,
        esimPrice: row.esimPrice ?? null,
        note: row.note ?? '',
      })),
      nextCursor,
    };
  }
}

/** Each account of a ladder, from the branch down, with its layer and what it earned on that entry. */
function sharesOf(ladder: Ladder, byId: Map<string, Account>) {
  return [...ladder.chain].reverse().map((id) => ({
    loginName: byId.get(id)?.loginName ?? id,
    layer: byId.get(id)?.layer ?? '',
    margin: marginOf(ladder, id) ?? 0,
  }));
}
