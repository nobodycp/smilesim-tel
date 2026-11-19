import { WalletsRepository } from './wallets.repository';
import { SALE_KINDS, type Ladder } from '../postpaid/pricing';
import { WalletLedger } from './wallet-ledger';
import { AccountTree, visibleAccountIds } from '../access';
import { PROVIDER_CHARGED_LATER_NOTE, UnitOfWork, dayRange, fail, parseInput, after, countUpTo, cursorPosition, page, searchTerms, FEED_PAGE } from '../platform';
import { financeSearch, loginIdsContaining } from './finance-search';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Actor, Account } from '../access';
import { CeilingBody, DeductBody, FinanceQuery, FinanceSummaryQuery, FundBody, LedgerQuery, ProfitsQuery, type FinanceFilter } from './wallets.schemas';
import { isOpenLoss, lossWhere, type LossFilter, type ProviderLoss } from './provider-cost';
import { OFF_THE_STATEMENT } from './entry-kinds';
import { SUMMARY_DAYS, ledgerCsv, profitCsv, walletSummary, windowStart } from './finance-summary';
import { marginViewOf, marginWhere, saleOrRefundWhere, storedMarginOf, storedPricesOf, type MarginView } from './stored-margins';
import type { Sale } from './sale';

/** What a given-back operation's charge takes (spec DB.5 P.9): the package price and the eSIM fee its row stores. */
const chargeAmountOf = (row: { packagePrice: number | null; esimPrice: number | null }) => (row.packagePrice ?? 0) + (row.esimPrice ?? 0);

const FINANCE_CSV_LIMIT = 10_000;

/** Wallets and money reads: the wallets an account sees, funding and ceilings, the ledger, the finance report and provider operations. Branch reports are in ReportsService. */
@Injectable()
export class WalletsService {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree, private readonly money: WalletLedger, private readonly repo: WalletsRepository) {}

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

  /**
   * The signed-in account's own wallet («المحفظة»). The tree's entries are «المالية» (`finance`). A statement: every
   * entry of the account but the ones that move no balance (`OFF_THE_STATEMENT`, spec F.2), so the rows explain every
   * change of `balanceAfter`. The kind filter takes any kind on the page; one off it is ignored, as before. Served by
   * `WalletEntry_userId_createdAt_id_idx` (the kind is a filter on the account's rows).
   */
  async ledger(actor: Actor, input: LedgerQuery = {}) {
    const query = parseInput(LedgerQuery, input);
    const kind = query.kind && !OFF_THE_STATEMENT.includes(query.kind) ? query.kind : '';
    const { from, to } = dayRange(query.from, query.to);
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    const where: Prisma.WalletEntryWhereInput = {
      userId: actor.id,
      kind: kind || { notIn: [...OFF_THE_STATEMENT] },
      ...(query.direction === 'in' ? { amount: { gt: 0 } } : {}),
      ...(query.direction === 'out' ? { amount: { lt: 0 } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };
    const [read, counted] = await Promise.all([
      this.repo.entriesWithAccounts({ ...where, AND: after(cursorPosition(query.cursor)) }, FEED_PAGE + 1),
      countUpTo((take) => this.repo.countEntries(where, take)),
    ]);
    const { items: rows, nextCursor } = page(read, FEED_PAGE);
    const view = marginViewOf(actor);
    return {
      items: rows.map((row) => ({
        /** The wallet's account; `margin` stays in the shape and is null (the viewer's own wallet carries none). */
        loginName: row.user?.loginName ?? actor.loginName,
        layer: row.user?.layer ?? actor.layer,
        margin: null as number | null,
        /** The account's own cost and sell price on a sale or refund of its chain (FL.1); null on any other entry. */
        ...pricesOf(view, row),
        id: row.id,
        at: row.createdAt.toISOString(),
        kind: row.kind,
        amount: row.amount,
        balanceBefore: row.balanceAfter - row.amount,
        balanceAfter: row.balanceAfter,
        note: row.note,
        packageName: row.packageName,
        msisdn: row.msisdn,
        actorLoginName: row.actor.loginName,
      })),
      nextCursor,
      ...counted,
    };
  }

  /** Each provider's purchases by provider id: what its operation entries stored as cost (ADR 0025 rule 5). */
  async providerPurchases(): Promise<Map<string, number>> {
    const sums = await this.repo.providerPurchases();
    return new Map(sums.flatMap((row) => (row.providerId ? [[row.providerId, row._sum.providerCost ?? 0] as const] : [])));
  }

  /** How many marked operations (spec DB.5 P.7) each provider has, by provider id. */
  async providerLosses(): Promise<Map<string, number>> {
    const counts = await this.repo.providerLosses();
    return new Map(counts.flatMap((row) => (row.providerId ? [[row.providerId, row._count._all] as const] : [])));
  }

  /** What one provider's operation entries stored as cost up to `to` (inclusive), or ever without it. */
  async providerCostUpTo(providerId: string, to: Date | null): Promise<number> {
    return (await this.repo.providerCostUpTo(providerId, to))._sum.providerCost ?? 0;
  }

  /**
   * The line operations with the provider and the cost each stored when it was written (ADR 0025), newest first.
   * Every filter runs in the database: the provider, the kind, a part of the number, the entry's time (`from` and
   * `to` inclusive), `priced` (a cost other than 0: what a provider's ledger and a statement list), `loss` (the
   * operations marked as the branch's loss, spec DB.5 P.7), and `take`; `named` adds each row's account's login.
   * An operation entry always carries both columns (the CHECK `WalletEntry_operation_priced`). A provider's operation
   * is an entry that stored a provider (`providerId IS NOT NULL`, spec F.5): the predicate of the partial index
   * `WalletEntry_provider_createdAt_id`, the same the provider's books sum; the kind is only the screen's filter.
   */
  async providerOperations(filter: { providerId?: string; kind?: string; msisdn?: string; from?: Date | null; to?: Date | null; priced?: boolean; loss?: LossFilter; take?: number; named?: boolean } = {}) {
    const rows = await this.repo.operationsAtProviders(
      {
        providerId: filter.providerId || { not: null },
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.priced ? { providerCost: { not: 0 } } : {}),
        ...lossWhere(filter.loss),
        ...(filter.msisdn ? { msisdn: { contains: filter.msisdn } } : {}),
        ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
      },
      filter.take,
    );
    // The accounts' names only for the screen that shows them («عمليات المزودين»): the books and statements need none.
    const accounts = filter.named && rows.length ? await this.tree.accounts() : [];
    const loginOf = new Map(accounts.map((account) => [account.id, account.loginName]));
    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt,
      kind: row.kind,
      /** The account whose wallet the operation is on: the point of sale it was for. */
      loginName: loginOf.get(row.userId) ?? '',
      msisdn: row.msisdn ?? '',
      companyName: row.companyName ?? '',
      packageName: row.packageName ?? '',
      providerId: row.providerId ?? '',
      cost: row.providerCost ?? 0,
      esimPrice: row.esimPrice ?? null,
      loss: (row.providerLoss ?? null) as ProviderLoss | null,
      /** What charging a given-back operation takes (P.9): what the task held and gave back; null on any other row. */
      chargeAmount: row.providerLoss === 'given_back' ? chargeAmountOf(row) : null,
    }));
  }

  /**
   * Charges the point of sale for an activation the provider carried out and whose money was given back (spec DB.5
   * P.9, ADR 0027), from the marked operation itself: the branch only, as the manual deduction. One transaction: the
   * point of sale's wallet locked, the mark turned `given_back` → `charged_later` (one row, or 409: charged already),
   * then the sale debited through `move` (the held money and the ceiling as any sale: `BALANCE_CEILING` refuses it and
   * nothing is written). The sale entry names the marked row (`chargesEntryId`, unique), its provider with cost 0 (the
   * purchase is the marked row's), and the ladder on the point of sale's path now at the package's prices now with
   * the provider's cost at the branch 0. The amount is never typed: the package price and the eSIM fee the row stores.
   */
  async chargeGivenBack(actor: Actor, entryId: string) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'FORBIDDEN');
    const entry = await this.repo.markedEntry(entryId);
    if (!entry) fail(404, 'NOT_FOUND');
    // Sold at 0 by the price list: there is nothing to charge; the fix is the price.
    if (entry.providerLoss === 'priced_zero') fail(400, 'INVALID');
    if (entry.providerLoss !== 'given_back' || entry.kind !== 'activate' || !entry.providerId) fail(409, 'DUPLICATE_REQUEST');
    const amount = chargeAmountOf(entry);
    // A task priced 0 held nothing and gave nothing back.
    if (amount <= 0) fail(400, 'INVALID');
    // No line was made: the package is the one the row names, by its provider, name and company.
    const named = await this.repo.packagesNamed(entry.providerId, entry.packageName ?? '', entry.companyName ?? '');
    if (named.length === 0) fail(404, 'NOT_FOUND');
    if (named.length > 1) fail(400, 'INVALID');
    // The point of sale's path, read before the transaction; the ledger confirms it under the wallet lock (DB.9).
    const path = this.tree.pathOf(entry.userId, await this.tree.accounts());
    const sale = {
      msisdn: entry.msisdn ?? '',
      lineId: '',
      companyName: entry.companyName ?? '',
      packageName: entry.packageName ?? '',
      packagePrice: entry.packagePrice ?? 0,
      providerId: entry.providerId,
      providerCost: 0,
      ...(entry.esimPrice ? { esimPrice: entry.esimPrice } : {}),
      path,
      charges: { entryId: entry.id, packageCode: named[0].code },
    } satisfies Sale;
    await this.uow.runTx((tx) => this.money.chargeLater(tx, entry.userId, amount, actor.operatorId, PROVIDER_CHARGED_LATER_NOTE, sale));
    return { ok: true, amount };
  }

  /** The ledger's filter: the entries of the visible accounts (every entry for the branch), narrowed by the query. */
  /** Public for the reports, which read the same entries. */
  async financeWhere(actor: Actor, query: FinanceFilter): Promise<Prisma.WalletEntryWhereInput> {
    // The loss mark tells what the provider was paid (spec DB.5 P.7): the branch's alone, so no other layer may find
    // the marked rows by filtering on it.
    if (query.loss && actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const accounts = await this.tree.accounts();
    const visible = [...visibleAccountIds(actor.id, actor.layer, accounts)];
    const scope = scopeWhere(query.scope, actor.layer === 'branch');
    return {
      ...(actor.layer === 'branch' ? {} : { userId: { in: visible } }),
      ...(await this.entryFilter(query, accounts)),
      ...(scope ? { AND: [scope] } : {}),
    };
  }

  /** The query's own narrowing of the entries (scope, kind, layer, dates, search), whoever's they are. */
  private async entryFilter(query: FinanceFilter, accounts: Account[]): Promise<Prisma.WalletEntryWhereInput> {
    const { from, to } = dayRange(query.from, query.to);
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    // The search (plan DB.6, `financeSearch`): the logins from the accounts already read, the catalog's names first.
    const terms = searchTerms(query.q);
    const named = terms?.digits ? await this.repo.catalogNamed(terms.names) : { packageNamed: true, companyNamed: true };
    const search = financeSearch(terms, { loginIds: terms ? loginIdsContaining(accounts, terms.names) : [], ...named });
    return {
      // The list's `scope` is the finance list's own (`scopeWhere`, read by `financeWhere`): the profits read the same
      // narrowing without it.
      ...(query.kind ? { kind: query.kind } : {}),
      ...lossWhere(query.loss),
      ...(query.layer ? { user: { layer: query.layer } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...search,
    };
  }

  /**
   * The sales and refunds a viewer's profit is read from (ADR 0026, the owner's answer 1): those whose chain held it
   * at the time of the sale, each with its margin stored on the entry; every one for the branch. Narrowed by the
   * query's dates and search.
   */
  private async marginEntries(view: MarginView, query: FinanceFilter): Promise<Prisma.WalletEntryWhereInput> {
    return { AND: [marginWhere(view), saleOrRefundWhere(), await this.entryFilter(query, await this.tree.accounts())] };
  }

  /**
   * The signed-in account's profit by package over a period (roadmap N4): sales, refunds and net profit for each
   * package sold in its chain, newest package first, with the totals. Same filters as the ledger (`from`, `to`, `q`).
   * For the branch each package's profit is net of the operations marked as its loss (spec DB.5 P.8), which each row
   * and the totals count (`losses`) and price (`lossAmount`, positive); a package with losses and no sale is a row.
   * For another layer both are 0 and nothing more is read.
   */
  async profitReport(actor: Actor, input: ProfitsQuery = {}) {
    const query = parseInput(ProfitsQuery, input);
    const view = marginViewOf(actor);
    // Exact over any period (ADR 0026, the owner's answer 3): one grouped sum of the stored margins, no rows loaded.
    // The branch's losses are a second read with the same filter, so the sales read keeps its partial index.
    const [groups, losses] = await Promise.all([
      this.repo.profitGroups({ AND: [await this.marginEntries(view, query), { [view.margin]: { not: null } }] }, view.margin),
      view.layer === 'branch' ? this.tree.accounts().then((accounts) => this.entryFilter(query, accounts)).then((where) => this.repo.lossGroups(where)) : [],
    ]);
    type Row = { packageName: string; companyName: string; sales: number; refunds: number; profit: number; losses: number; lossAmount: number; newest: number };
    const packages = new Map<string, Row>();
    const groupOf = (row: { companyName: string | null; packageName: string | null }) => {
      const key = `${row.companyName ?? ''}\n${row.packageName ?? ''}`;
      const group = packages.get(key) ?? { packageName: row.packageName ?? '', companyName: row.companyName ?? '', sales: 0, refunds: 0, profit: 0, losses: 0, lossAmount: 0, newest: 0 };
      packages.set(key, group);
      return group;
    };
    for (const row of groups) {
      const group = groupOf(row);
      if (SALE_KINDS[row.kind]) group.sales += row._count._all;
      else group.refunds += row._count._all;
      group.profit += (row._sum as Record<string, number | null>)[view.margin] ?? 0;
      group.newest = Math.max(group.newest, row._max.createdAt?.getTime() ?? 0);
    }
    for (const row of losses) {
      const group = groupOf(row);
      const margin = row._sum.branchMargin ?? 0;
      // Every marked row's margin stays in the profit; only the open marks are losses to count (P.9).
      if (isOpenLoss(row.providerLoss)) {
        group.losses += row._count._all;
        group.lossAmount -= margin;
      }
      group.profit += margin;
      group.newest = Math.max(group.newest, row._max.createdAt?.getTime() ?? 0);
    }
    // The package sold, given back or lost most recently first.
    const list = [...packages.values()].sort((a, b) => b.newest - a.newest).map(({ packageName, companyName, sales, refunds, profit, losses, lossAmount }) => ({ packageName, companyName, sales, refunds, profit, losses, lossAmount }));
    const totals = list.reduce(
      (sum, row) => ({ sales: sum.sales + row.sales, refunds: sum.refunds + row.refunds, profit: sum.profit + row.profit, losses: sum.losses + row.losses, lossAmount: sum.lossAmount + row.lossAmount }),
      { sales: 0, refunds: 0, profit: 0, losses: 0, lossAmount: 0 },
    );
    return { packages: list, totals };
  }

  /** The profit report as a CSV (BOM, shekels); the losses' two columns for the branch only (spec DB.5 P.8). */
  async profitCsv(actor: Actor, input: ProfitsQuery = {}) {
    const query = parseInput(ProfitsQuery, input);
    const { packages, totals } = await this.profitReport(actor, query);
    return profitCsv([...packages, { packageName: 'TOTAL', companyName: '', ...totals }], actor.layer === 'branch');
  }

  /** The signed-in account's own wallet over the last `days` (7, 30 or 90): the finance page's cards and chart. */
  async financeSummary(actor: Actor, input: FinanceSummaryQuery = {}, now = new Date()) {
    const days = Number(parseInput(FinanceSummaryQuery, input).days ?? SUMMARY_DAYS);
    const [wallet, entries] = await Promise.all([
      this.repo.walletOf(actor.id),
      this.repo.movementsSince(actor.id, windowStart(now, days)),
    ]);
    const balance = wallet?.balance ?? 0;
    // What this account earned over the same window on the sales of the chains it was in (ADR 0026), and how many.
    // The branch's profit is net of the operations marked as its loss in the window (spec DB.5 P.8), read beside it.
    const view = marginViewOf(actor);
    const [byKind, lost] = await Promise.all([
      this.repo.marginsByKind({ AND: [marginWhere(view), saleOrRefundWhere(), { createdAt: { gte: windowStart(now, days) } }] }, view.margin),
      view.layer === 'branch' ? this.repo.lossTotal(windowStart(now, days)) : null,
    ]);
    // Every marked row's margin (− its cost) is in the profit; the losses told are the open marks only (P.9).
    const marked = (lost ?? []).reduce((sum, row) => sum + (row._sum.branchMargin ?? 0), 0);
    const open = (lost ?? []).filter((row) => isOpenLoss(row.providerLoss));
    const losses = lost ? { count: open.reduce((sum, row) => sum + row._count._all, 0), amount: open.reduce((sum, row) => sum - (row._sum.branchMargin ?? 0), 0) } : null;
    const profit = byKind.reduce((sum, row) => sum + ((row._sum as Record<string, number | null>)[view.margin] ?? 0), 0) + marked;
    const sales = byKind.filter((row) => SALE_KINDS[row.kind]).reduce((sum, row) => sum + row._count._all, 0);
    return { balance, ceiling: wallet?.ceiling ?? 0, held: wallet?.held ?? 0, unlimited: actor.layer === 'branch', profit, sales, losses, ...walletSummary(entries, balance, now, days) };
  }

  /** The ledger with the page's filters as a CSV, newest first, at most 10,000 rows. */
  async financeCsv(actor: Actor, input: FinanceQuery = {}) {
    const query = parseInput(FinanceQuery, input);
    const rows = await this.repo.entriesWithAccounts(await this.financeWhere(actor, query), FINANCE_CSV_LIMIT);
    const view = marginViewOf(actor);
    return ledgerCsv(rows.map((row) => ({
      ...pricesOf(view, row),
      at: row.createdAt.toISOString(),
      loginName: row.user.loginName,
      layer: row.user.layer,
      actorLoginName: row.actor.loginName,
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

  async finance(actor: Actor, input: FinanceQuery = {}) {
    const query = parseInput(FinanceQuery, input);
    const position = cursorPosition(query.cursor);
    const where = await this.financeWhere(actor, query);
    const [rows, counted] = await Promise.all([
      // The page cursor joins the ledger filter instead of replacing its own conditions.
      this.repo.entriesWithAccounts(position ? { AND: [where, ...after(position)] } : where, FEED_PAGE + 1),
      countUpTo((take) => this.repo.countEntries(where, take)),
    ]);
    const { items, nextCursor } = page(rows, FEED_PAGE);
    const view = marginViewOf(actor);
    const accounts = actor.layer === 'branch' ? await this.tree.accounts() : [];
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return {
      ...counted,
      items: items.map((row) => ({
        /**
         * For the branch: what every account in the sale's chain earned on it, branch first. Null for other viewers
         * and for entries that are not a sale or a refund.
         */
        shares: actor.layer === 'branch' && row.ladder && typeof row.branchMargin === 'number' ? sharesOf(row, byId) : null,
        /** What the signed-in account earned on this sale, as stored on it (ADR 0026); null when it is not a sale in its chain. */
        margin: storedMarginOf(view, row),
        /**
         * The signed-in account's own cost and sell price on that sale (FL.1), from its stored ladder: `sell − cost` is
         * `margin`. Null when `margin` is; never another account's figure.
         */
        ...pricesOf(view, row),
        id: row.id,
        at: row.createdAt.toISOString(),
        loginName: row.user.loginName,
        layer: row.user.layer,
        actorLoginName: row.actor.loginName,
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
        /** Why the provider was paid and the point of sale charged nothing (spec DB.5 P.7); the branch's alone, null for any other viewer. */
        loss: actor.layer === 'branch' ? ((row.providerLoss ?? null) as ProviderLoss | null) : null,
        note: row.note ?? '',
      })),
      nextCursor,
    };
  }
}

/**
 * What the finance list's `scope` keeps (spec 2026-11-19-finance-ledger-columns, the owner's point 7: «المالية» is the
 * movements on the wallets). None or `money`, the default: an entry that moved money (`amount` not 0); a hold and a
 * release, which move no balance but hold and free money of an open task; and for the branch the operations marked as
 * its loss (P.7), which move 0 and are the branch's money (so the loss filter still finds them). `all`: every entry,
 * the operations that moved nothing included (owner 2026-11-09: «شامله كل العمليات للاب والابناء»). `operations`: the
 * line operations, the entries that stored a provider (spec F.5), as «العمليات» listed them (spec 2026-11-09-admin-review,
 * 1). A row filter on the page's ordered read: `WalletEntry_createdAt_id_idx` for the branch, the
 * `WalletEntry_userId_createdAt_id_idx` ranges of the visible accounts for another layer, as before.
 */
function scopeWhere(scope: string | undefined, branch: boolean): Prisma.WalletEntryWhereInput | null {
  if (scope === 'all') return null;
  if (scope === 'operations') return { providerId: { not: null } };
  return { OR: [{ amount: { not: 0 } }, { kind: { in: ['hold', 'release'] } }, ...(branch ? [{ providerLoss: { not: null } }] : [])] };
}

/** The viewer's `cost` and `sell` on an entry (`storedPricesOf`), both null when it has none. */
function pricesOf(view: MarginView, row: Parameters<typeof storedPricesOf>[1]): { cost: number | null; sell: number | null } {
  const prices = storedPricesOf(view, row);
  return { cost: prices?.cost ?? null, sell: prices?.sell ?? null };
}

type SharedEntry = {
  ladder: unknown;
  chainPosId: string | null;
  chainAgentId: string | null;
  chainMainAgentId: string | null;
  posMargin: number | null;
  agentMargin: number | null;
  mainAgentMargin: number | null;
  branchMargin: number | null;
};

/** Each account of a sale's chain, from the branch down, with its layer and what it earned on that entry, as stored. */
function sharesOf(row: SharedEntry, byId: Map<string, Account>) {
  const chain = (row.ladder as Ladder).chain;
  const share = (id: string | null, margin: number | null) => (id === null ? [] : [{ loginName: byId.get(id)?.loginName ?? id, layer: byId.get(id)?.layer ?? '', margin: margin ?? 0 }]);
  return [
    ...share(chain[chain.length - 1], row.branchMargin),
    ...share(row.chainMainAgentId, row.mainAgentMargin),
    ...share(row.chainAgentId, row.agentMargin),
    ...share(row.chainPosId, row.posMargin),
  ];
}
