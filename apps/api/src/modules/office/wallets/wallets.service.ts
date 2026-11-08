import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import { parseInput } from '../../shared/input';
import { feedPosition } from '../kernel/feed';
import type { Actor } from '../kernel/types';
import { FEED_PAGE, NEWEST_FIRST, afterFeed, encodeFeedCursor, mergeFeed } from '../office-paging';
import { visibleAccountIds } from '../office-rules';
import { CeilingBody, DeductBody, FundBody } from '../wallet.schemas';
import { PROVIDER_OPERATION_KINDS, pricedOp } from './provider-cost';
import { ledgerCsv, profitCsv, walletSummary, windowStart } from './finance-summary';
import { REFUND_KINDS, SALE_KINDS, ladderOf, marginOf, refundLadder, type Ladder } from '../profit-ladder';

const FINANCE_CSV_LIMIT = 10_000;
const PROFIT_REPORT_LIMIT = 50_000;

/** Wallets and money reads: the wallets an account sees, funding and ceilings, the ledger, the finance report and provider operations. Branch reports are in ReportsService. */
@Injectable()
export class WalletsService {
  constructor(private readonly kernel: OfficeKernel) {}

  async list(actor: Actor) {
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const rows = await this.kernel.prisma.wallet.findMany({ where: { userId: { in: [...visible] } } });
    const byUser = new Map(rows.map((row) => [row.userId, row]));
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return {
      wallets: accounts
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
    };
  }

  async fund(actor: Actor, loginName: string, body: unknown) {
    const { amount, note, reason } = parseInput(FundBody, body);
    const accounts = await this.kernel.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target) fail(404, 'NOT_FOUND');
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    if (!visible.has(target.id)) fail(403, 'FORBIDDEN');
    const self = target.id === actor.id;
    if (self) {
      if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
      if (!note) fail(400, 'NOTE_REQUIRED');
    } else if (actor.layer !== 'branch' && target.parentId !== actor.id) {
      fail(403, 'FORBIDDEN');
    }
    await this.kernel.runTx(async (tx) => {
      if (!self) await this.kernel.move(tx, actor.id, -amount, actor.operatorId, 'fund', note, undefined, reason);
      await this.kernel.move(tx, target.id, amount, actor.operatorId, self ? 'self_fund' : 'fund', note, undefined, reason);
      if (!self) {
        this.kernel.queueNotices(tx, await this.kernel.notice.write(tx, [target.id], actor, {
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
    const accounts = await this.kernel.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target) fail(404, 'NOT_FOUND');
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    if (!visible.has(target.id) || target.id === actor.id) fail(403, 'FORBIDDEN');
    if (actor.layer !== 'branch' && target.parentId !== actor.id) fail(403, 'FORBIDDEN');
    await this.kernel.runTx(async (tx) => {
      await this.kernel.move(tx, target.id, -amount, actor.operatorId, 'deduct', note, undefined, reason);
      await this.kernel.move(tx, actor.id, amount, actor.operatorId, 'deduct_in', note, undefined, reason);
      this.kernel.queueNotices(tx, await this.kernel.notice.write(tx, [target.id], actor, {
        kind: 'fund.deducted',
        payload: { amount, senderName: actor.nickname, note, reason },
      }));
    });
    return { ok: true };
  }

  async setCeiling(actor: Actor, loginName: string, body: unknown) {
    const { ceiling } = parseInput(CeilingBody, body);
    const accounts = await this.kernel.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target || target.parentId !== actor.id) fail(403, 'FORBIDDEN');
    await this.kernel.prisma.wallet.update({ where: { userId: target.id }, data: { ceiling } });
    return { ok: true };
  }

  async ledger(actor: Actor, scope: string, query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string }) {
    const operationKinds = PROVIDER_OPERATION_KINDS;
    const auditKinds = [...operationKinds, 'fund', 'self_fund', 'deduct', 'deduct_in'];
    if (scope !== 'operations' && scope !== 'audit') fail(404, 'NOT_FOUND');
    const allowed = scope === 'operations' ? operationKinds : auditKinds;
    const kind = query.kind && allowed.includes(query.kind) ? query.kind : '';
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59` : query.to) : null;
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    // Operations cover the viewer's whole tree: a sale debits only the point of sale's wallet, so the layers above
    // have no operation entries of their own (spec 2026-11-08-overview-and-reports-nav, B). The audit scope stays
    // the viewer's own wallet.
    let owners: Prisma.WalletEntryWhereInput = { userId: actor.id };
    if (scope === 'operations') {
      const accounts = await this.kernel.accounts();
      owners = actor.layer === 'branch' ? {} : { userId: { in: [...visibleAccountIds(actor.id, actor.layer, accounts)] } };
    }
    const where: Prisma.WalletEntryWhereInput = {
      ...owners,
      kind: { in: kind ? [kind] : allowed },
      ...(query.direction === 'in' ? { amount: { gt: 0 } } : {}),
      ...(query.direction === 'out' ? { amount: { lt: 0 } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };
    const [read, total] = await Promise.all([
      this.kernel.prisma.walletEntry.findMany({
        where: { ...where, AND: afterFeed(feedPosition(query.cursor)) },
        include: { actor: true, user: true },
        orderBy: [...NEWEST_FIRST],
        take: FEED_PAGE + 1,
      }),
      this.kernel.prisma.walletEntry.count({ where }),
    ]);
    const { page: rows, nextCursor } = mergeFeed([read], FEED_PAGE);
    const margins = scope === 'operations' ? await this.marginsFor(actor, rows) : new Map<string, number | null>();
    return {
      entries: rows.map((row) => ({
        /** The account whose wallet the operation moved, and what the viewer earned on it (null when nothing). */
        loginName: row.user?.loginName ?? actor.loginName,
        layer: row.user?.layer ?? actor.layer,
        margin: margins.get(row.id) ?? null,
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
    const rows = await this.kernel.prisma.walletEntry.findMany({
      where: {
        kind: { in: filter.kind ? [filter.kind] : PROVIDER_OPERATION_KINDS },
        ...(filter.msisdn ? { msisdn: { contains: filter.msisdn } } : {}),
      },
      orderBy: [...NEWEST_FIRST],
    });
    const lineIds = [...new Set(rows.flatMap((row) => (row.lineId ? [row.lineId] : [])))];
    const [lines, packages] = await Promise.all([
      lineIds.length
        ? this.kernel.prisma.line.findMany({
            where: { id: { in: lineIds } },
            include: { package: { include: { provider: true, company: true } } },
          })
        : [],
      this.kernel.prisma.package.findMany({ include: { provider: true, company: true } }),
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

  async providerOperations(actor: Actor, query: { cursor?: string; kind?: string; provider?: string; q?: string; from?: string; to?: string } = {}) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    if (!actor.isBranchOwner && !actor.grants.includes('reports')) fail(403, 'REPORTS_BRANCH_ONLY');
    const kind = query.kind && PROVIDER_OPERATION_KINDS.includes(query.kind) ? query.kind : '';
    const needle = (query.q ?? '').replace(/\s/g, '');
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999` : query.to) : null;
    const [resolved, providers] = await Promise.all([
      this.pricedOperations({ kind: kind || undefined, msisdn: needle || undefined }),
      this.kernel.prisma.provider.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const chosen = query.provider ? resolved.filter((row) => row.providerCode === query.provider) : resolved;
    const ranged = chosen.filter((row) => {
      if (from && !Number.isNaN(from.getTime()) && row.at < from) return false;
      if (to && !Number.isNaN(to.getTime()) && row.at > to) return false;
      return true;
    });
    const now = new Date();
    const monthCost = chosen
      .filter((row) => row.at.getFullYear() === now.getFullYear() && row.at.getMonth() === now.getMonth())
      .reduce((sum, row) => sum + row.cost, 0);
    const position = query.cursor ? feedPosition(query.cursor) : undefined;
    const window = position
      ? ranged.filter((row) => row.at < position.at || (row.at.getTime() === position.at.getTime() && row.id < position.id))
      : ranged;
    const page = window.slice(0, FEED_PAGE);
    const last = page[page.length - 1];
    return {
      entries: page.map((row) => ({
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
      })),
      nextCursor: window.length > FEED_PAGE && last ? encodeFeedCursor({ createdAt: last.at, id: last.id }) : null,
      total: ranged.length,
      stats: { count: ranged.length, cost: ranged.reduce((sum, row) => sum + row.cost, 0), monthCost },
      providers: providers.map((item) => ({ code: item.code, name: item.name })),
    };
  }

  /** The ledger's filter: the entries of the visible accounts (every entry for the branch), narrowed by the query. */
  /** Public for the reports, which read the same entries. */
  async financeWhere(actor: Actor, query: { kind?: string; layer?: string; q?: string; from?: string; to?: string }): Promise<Prisma.WalletEntryWhereInput> {
    const accounts = await this.kernel.accounts();
    const visible = [...visibleAccountIds(actor.id, actor.layer, accounts)];
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999` : query.to) : null;
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    const needle = (query.q ?? '').trim();
    const digits = needle.replace(/\s/g, '');
    return {
      ...(actor.layer === 'branch' ? {} : { userId: { in: visible } }),
      // Money movements, and the holds and releases of open tasks, which move no money but change what is spendable.
      AND: [{ OR: [{ amount: { not: 0 } }, { kind: { in: ['hold', 'release'] } }] }],
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
    const accounts = await this.kernel.accounts();
    const lines = await this.kernel.prisma.line.findMany({ where: { id: { in: [...new Set(missing.map((row) => row.lineId as string))] } }, select: { id: true, terms: true } });
    const codeOf = new Map(lines.map((line) => [line.id, (line.terms as { packageCode?: string } | null)?.packageCode ?? '']));
    const paths = new Map(missing.map((row) => [row.userId, this.kernel.pathOf(row.userId, accounts)]));
    const codes = [...new Set([...codeOf.values()].filter(Boolean))];
    const ids = [...new Set([...paths.values()].flat().map((node) => node.id))];
    const [ladderRows, subscribers] = await Promise.all([
      this.kernel.ladderRows(codes, ids, this.kernel.prisma),
      this.kernel.prisma.package.findMany({ where: { code: { in: codes } }, select: { code: true, subscriberPrice: true, renewalSubscriberPrice: true } }),
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
  async marginsFor(
    actor: Actor,
    rows: { id: string; userId: string; kind: string; lineId: string | null; packagePrice: number | null; amount: number; ladder: unknown; createdAt?: Date }[],
  ) {
    const sales = rows.filter((row) => SALE_KINDS[row.kind] && row.lineId && row.amount < 0);
    const refunds = rows.filter((row) => REFUND_KINDS.has(row.kind) && row.lineId && row.amount > 0);
    const ladders = await this.laddersOf(sales);
    const oldRefunds = refunds.filter((row) => !row.ladder);
    for (const row of refunds) if (row.ladder) ladders.set(row.id, row.ladder as Ladder);
    if (oldRefunds.length) {
      const earlier = await this.kernel.prisma.walletEntry.findMany({
        where: { lineId: { in: [...new Set(oldRefunds.map((row) => row.lineId as string))] }, kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } },
        select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, ladder: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const bases = await this.laddersOf(earlier);
      for (const row of oldRefunds) {
        const sale = earlier.find((item) => item.lineId === row.lineId && (!row.createdAt || item.createdAt <= row.createdAt));
        const base = sale ? bases.get(sale.id) : undefined;
        const ladder = base ? refundLadder(base, row.amount, row.packagePrice || sale?.packagePrice || 0) : null;
        if (ladder) ladders.set(row.id, ladder);
      }
    }
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
    const rows = await this.kernel.prisma.walletEntry.findMany({
      where: {
        AND: [
          await this.financeWhere(actor, query),
          { OR: [{ kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } }, { kind: { in: [...REFUND_KINDS] }, amount: { gt: 0 } }] },
        ],
      },
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true, packageName: true, companyName: true },
      orderBy: [...NEWEST_FIRST],
      take: PROFIT_REPORT_LIMIT,
    });
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

  /** The signed-in account's own wallet over the last 30 days: the finance page's cards and chart. */
  async financeSummary(actor: Actor, now = new Date()) {
    const [wallet, entries] = await Promise.all([
      this.kernel.prisma.wallet.findUnique({ where: { userId: actor.id } }),
      this.kernel.prisma.walletEntry.findMany({
        where: { userId: actor.id, amount: { not: 0 }, createdAt: { gte: windowStart(now) } },
        select: { createdAt: true, amount: true, balanceAfter: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const balance = wallet?.balance ?? 0;
    // What this account earned on the sales under it (or its own) over the same window.
    const sold = await this.kernel.prisma.walletEntry.findMany({
      where: {
        ...(await this.financeWhere(actor, {})),
        OR: [{ kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } }, { kind: { in: [...REFUND_KINDS] }, amount: { gt: 0 } }],
        createdAt: { gte: windowStart(now) },
      },
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true },
    });
    const margins = await this.marginsFor(actor, sold);
    const profit = [...margins.values()].reduce((sum: number, value) => sum + (value ?? 0), 0);
    const sales = sold.filter((row) => row.amount < 0).length;
    return { balance, ceiling: wallet?.ceiling ?? 0, held: wallet?.held ?? 0, unlimited: actor.layer === 'branch', profit, sales, ...walletSummary(entries, balance, now) };
  }

  /** The ledger with the page's filters as a CSV, newest first, at most 10,000 rows. */
  async financeCsv(actor: Actor, query: { kind?: string; layer?: string; q?: string; from?: string; to?: string } = {}) {
    const rows = await this.kernel.prisma.walletEntry.findMany({
      where: await this.financeWhere(actor, query),
      include: { user: true, actor: true },
      orderBy: [...NEWEST_FIRST],
      take: FINANCE_CSV_LIMIT,
    });
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

  async finance(actor: Actor, query: { cursor?: string; kind?: string; layer?: string; q?: string; from?: string; to?: string } = {}) {
    const position = feedPosition(query.cursor);
    const where = await this.financeWhere(actor, query);
    const [rows, total] = await Promise.all([
      this.kernel.prisma.walletEntry.findMany({
        // The page cursor joins the ledger filter instead of replacing its own conditions.
        where: position ? { AND: [where, { OR: [{ createdAt: { lt: position.at } }, { createdAt: position.at, id: { lt: position.id } }] }] } : where,
        include: { user: true, actor: true },
        orderBy: [...NEWEST_FIRST],
        take: FEED_PAGE + 1,
      }),
      this.kernel.prisma.walletEntry.count({ where }),
    ]);
    const page = rows.slice(0, FEED_PAGE);
    const last = page[page.length - 1];
    const margins = await this.marginsFor(actor, page);
    return {
      total,
      entries: page.map((row) => ({
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
      nextCursor: rows.length > FEED_PAGE && last ? encodeFeedCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }
}
