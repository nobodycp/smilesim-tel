import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import { parseInput } from '../../shared/input';
import { feedPosition } from '../kernel/feed';
import type { Actor } from '../kernel/types';
import { FEED_PAGE, NEWEST_FIRST, afterFeed, encodeFeedCursor, mergeFeed } from '../office-paging';
import { visibleAccountIds } from '../office-rules';
import { CeilingBody, FundBody } from '../wallet.schemas';
import { PROVIDER_OPERATION_KINDS, pricedOp } from './provider-cost';
import { ledgerCsv, walletSummary, windowStart } from './finance-summary';

const FINANCE_CSV_LIMIT = 10_000;

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
    const { amount, note } = parseInput(FundBody, body);
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
      if (!self) await this.kernel.move(tx, actor.id, -amount, actor.operatorId, 'fund', note);
      await this.kernel.move(tx, target.id, amount, actor.operatorId, self ? 'self_fund' : 'fund', note);
      if (!self) {
        this.kernel.queueNotices(tx, await this.kernel.notice.write(tx, [target.id], actor, {
          kind: 'fund.received',
          payload: { amount, senderName: actor.nickname, note },
        }));
      }
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
    const auditKinds = [...operationKinds, 'fund', 'self_fund'];
    if (scope !== 'operations' && scope !== 'audit') fail(404, 'NOT_FOUND');
    const allowed = scope === 'operations' ? operationKinds : auditKinds;
    const kind = query.kind && allowed.includes(query.kind) ? query.kind : '';
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59` : query.to) : null;
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    const where = {
      userId: actor.id,
      kind: { in: kind ? [kind] : allowed },
      ...(query.direction === 'in' ? { amount: { gt: 0 } } : {}),
      ...(query.direction === 'out' ? { amount: { lt: 0 } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };
    const [read, total] = await Promise.all([
      this.kernel.prisma.walletEntry.findMany({
        where: { ...where, AND: afterFeed(feedPosition(query.cursor)) },
        include: { actor: true },
        orderBy: [...NEWEST_FIRST],
        take: FEED_PAGE + 1,
      }),
      this.kernel.prisma.walletEntry.count({ where }),
    ]);
    const { page: rows, nextCursor } = mergeFeed([read], FEED_PAGE);
    return {
      entries: rows.map((row) => ({
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

  async providerOperations(actor: Actor, query: { cursor?: string; kind?: string; provider?: string; q?: string; from?: string; to?: string } = {}) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    if (!actor.isBranchOwner && !actor.grants.includes('reports')) fail(403, 'REPORTS_BRANCH_ONLY');
    const kind = query.kind && PROVIDER_OPERATION_KINDS.includes(query.kind) ? query.kind : '';
    const needle = (query.q ?? '').replace(/\s/g, '');
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999` : query.to) : null;
    const rows = await this.kernel.prisma.walletEntry.findMany({
      where: {
        kind: { in: kind ? [kind] : PROVIDER_OPERATION_KINDS },
        ...(needle ? { msisdn: { contains: needle } } : {}),
      },
      orderBy: [...NEWEST_FIRST],
    });
    const lineIds = [...new Set(rows.flatMap((row) => (row.lineId ? [row.lineId] : [])))];
    const [lines, packages, providers] = await Promise.all([
      lineIds.length
        ? this.kernel.prisma.line.findMany({
            where: { id: { in: lineIds } },
            include: { package: { include: { provider: true, company: true } } },
          })
        : [],
      this.kernel.prisma.package.findMany({ include: { provider: true, company: true } }),
      this.kernel.prisma.provider.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const lineById = new Map(lines.map((line) => [line.id, line]));
    const resolved = rows.map((row) => {
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
  private async financeWhere(actor: Actor, query: { kind?: string; layer?: string; q?: string; from?: string; to?: string }): Promise<Prisma.WalletEntryWhereInput> {
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
      amount: { not: 0 },
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
    return { balance, ceiling: wallet?.ceiling ?? 0, unlimited: actor.layer === 'branch', ...walletSummary(entries, balance, now) };
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
        where: {
          ...where,
          ...(position ? { AND: [{ OR: [{ createdAt: { lt: position.at } }, { createdAt: position.at, id: { lt: position.id } }] }] } : {}),
        },
        include: { user: true, actor: true },
        orderBy: [...NEWEST_FIRST],
        take: FEED_PAGE + 1,
      }),
      this.kernel.prisma.walletEntry.count({ where }),
    ]);
    const page = rows.slice(0, FEED_PAGE);
    const last = page[page.length - 1];
    return {
      total,
      entries: page.map((row) => ({
        id: row.id,
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
        packagePrice: row.packagePrice,
        esimPrice: row.esimPrice ?? null,
        note: row.note ?? '',
      })),
      nextCursor: rows.length > FEED_PAGE && last ? encodeFeedCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
  }
}
