import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPrismaClient } from '../../../db';
import { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { AUTH_STORE, AuthStore } from '../../auth/auth.store';
import { fail } from '../../shared/office-failure';
import { PrismaService } from '../../shared/prisma.service';
import { NoticeService, type WrittenNotice } from '../notice.service';
import { GRANT_CODES, effectiveGrantCodes } from '../office-grants';
import { visibleAccountIds, withinCeiling } from '../office-rules';
import type { Account, Actor, Gate, Sale } from './types';
import type { PathNode, SellRow, TermRow } from '../user-terms';
import { stampRenewal } from '../line-prices';
import type { LineTerms } from '../office-rules';
import { buyPriceFor } from '../user-terms';
import type { LayerPrices } from '../user-terms';
import { LAYER_GRANTS, flagsFor } from '../office-grants';
import { LAYER_ORDER } from './values';
import { deniedOpsFor } from '../user-terms';
import { SALE_KINDS, ladderOf, type Ladder } from '../profit-ladder';

/**
 * What every office domain shares: the PostgreSQL client, the signed-in actor and their grants, the account
 * list, transactions that publish their notices after commit, and the wallet moves. One instance per process;
 * The domain services under `modules/office/<domain>/` all read through it.
 */
/** The price columns a renewal stamp reads from a package. */
export const PRICE_COLUMNS = {
  branchCost: true,
  mainPrice: true,
  agentPrice: true,
  posPrice: true,
  renewalBranchCost: true,
  renewalMainPrice: true,
  renewalAgentPrice: true,
  renewalPosPrice: true,
} as const;

/** Every package with the term and sell rows on it, for stamping renewal prices. */
export type LadderRows = {
  packages: (LayerPrices & { id: string; code: string })[];
  termRows: (TermRow & { packageId: string })[];
  sellRows: (SellRow & { packageId: string })[];
};

/** An account as one step of a path. */
export function nodeOf(account: Account): PathNode {
  return { id: account.id, loginName: account.loginName, layer: account.layer, deniedOps: account.deniedOps ?? '' };
}

/** A branch-only action: anyone else is 403 FORBIDDEN. */
export function assertBranch(actor: Actor): void {
  if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
}

@Injectable()
export class OfficeKernel {
  /** The client; specs replace it to run on in-memory tables. */
  prismaClient: PrismaClient | null = null;

  readonly notice: NoticeService;

  constructor(
    @Inject(AUTH_STORE) readonly auth: AuthStore,
    @Optional() notice?: NoticeService,
    @Optional() private readonly db?: PrismaService,
  ) {
    this.notice = notice ?? new NoticeService();
  }

  get prisma(): PrismaClient {
    this.prismaClient ??= this.db?.client ?? createPrismaClient();
    return this.prismaClient;
  }

  /** Notices written inside a transaction wait here until that transaction commits. */
  private readonly queued = new WeakMap<object, WrittenNotice[]>();

  async actor(gate: Gate): Promise<Actor> {
    const sessionId = gate.sessionId;
    if (!sessionId) fail(401, 'LOGIN_REQUIRED');
    const live = await this.auth.liveSession(sessionId);
    if (!live || live.session.scope !== 'full' || live.user.disabledAt) fail(401, 'LOGIN_REQUIRED');
    await this.auth.touchSession(sessionId);
    const impersonating = live.session.kind === 'impersonation';
    let operatorId = live.user.id;
    if (impersonating && gate.homeId) {
      const home = await this.auth.liveSession(gate.homeId);
      if (home && home.session.scope === 'full' && home.user.layer === 'branch' && !home.user.disabledAt) operatorId = home.user.id;
    }
    const stored = await this.prisma.user.findUnique({
      where: { id: live.user.id },
      include: { role: true, extraRoles: { include: { role: true } } },
    });
    const grants = await this.grantsFor(stored);
    return {
      id: live.user.id,
      loginName: live.user.loginName,
      nickname: live.user.nickname || live.user.loginName,
      layer: live.user.layer,
      isBranchOwner: live.user.isBranchOwner,
      grants,
      operatorId,
      impersonating,
    };
  }

  async grantsFor(stored: {
    isBranchOwner?: boolean;
    liveGrants?: string | null;
    layer?: string;
    roleId?: string | null;
    extraGrants?: string | null;
    deniedGrants?: string | null;
    role?: { grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean } | null;
    extraRoles?: { role: { grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean } }[];
  } | null): Promise<string[]> {
    if (stored?.isBranchOwner) return [...GRANT_CODES];
    if (!stored?.layer || !this.prisma.role) return (stored?.liveGrants ?? '').split(',').filter(Boolean);
    const staff = stored.layer === 'branch' && Boolean(stored.roleId);
    const layerRole = staff ? null : await this.prisma.role.findUnique({ where: { layer: stored.layer } });
    return effectiveGrantCodes({
      owner: false,
      staff,
      layer: stored.layer,
      layerRole,
      roles: [stored.role, ...(stored.extraRoles ?? []).map((link) => link.role)],
      extra: stored.extraGrants,
      denied: stored.deniedGrants,
    });
  }

  async branchActor(gate: Gate): Promise<Actor> {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    return actor;
  }

  async accounts(): Promise<Account[]> {
    return this.prisma.user.findMany({
      select: { id: true, loginName: true, nickname: true, layer: true, parentId: true, deniedOps: true, disabledAt: true },
      orderBy: { loginName: 'asc' },
    });
  }

  async visibleAccount(actor: Actor, loginName: string) {
    const target = await this.prisma.user.findUnique({ where: { loginName }, include: { role: true } });
    if (!target) fail(404, 'NOT_FOUND');
    const accounts = await this.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(403, 'FORBIDDEN');
    return target;
  }

  chainIds(actorId: string, accounts: Account[]): string[] {
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const ids: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(actorId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      ids.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return ids;
  }

  queueNotices(tx: Prisma.TransactionClient, rows: WrittenNotice[]) {
    if (rows.length === 0) return;
    const list = this.queued.get(tx) ?? [];
    list.push(...rows);
    this.queued.set(tx, list);
  }

  /** Runs a transaction and publishes the notices it queued once it has committed. */
  async runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let inner: Prisma.TransactionClient | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      inner = tx;
      return fn(tx);
    });
    const rows = inner ? this.queued.get(inner) ?? [] : [];
    if (inner) this.queued.delete(inner);
    if (rows.length > 0) await this.publishQuietly(rows);
    return result;
  }

  // The row is committed; the live push is a courtesy. The 60s poll in the browser picks up what Redis missed.
  async publishQuietly(rows: WrittenNotice[]) {
    try {
      await this.notice.publish(rows);
    } catch (error) {
      console.warn('notice publish failed', error instanceof Error ? error.message : error);
    }
  }

  async actorName(id: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { nickname: true, loginName: true } });
    return user?.nickname || user?.loginName || '';
  }

  async move(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, kind: string, note: string, sale?: Sale) {
    // Hold the wallet row until this transaction ends, so a concurrent move waits here and then reads the balance
    // this one wrote. Without it two moves read the same balance and one write is lost (ADR 0004).
    await tx.$queryRaw`SELECT "userId" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!wallet || !user) fail(404, 'NOT_FOUND');
    const debit = amount < 0 ? -amount : 0;
    if (!withinCeiling(user.layer, wallet.balance, wallet.ceiling, debit)) {
      // The transaction rolls back, so this notice is written on its own and published at once.
      const actor = { id: actorId, nickname: await this.actorName(actorId) };
      const audience = [userId, ...(user.parentId ? [user.parentId] : [])];
      const rows = await this.notice.write(this.prisma, audience, actor, {
        kind: 'wallet.ceiling',
        payload: { balance: wallet.balance, ceiling: wallet.ceiling, attempted: debit, loginName: user.loginName },
      });
      await this.publishQuietly(rows);
      fail(400, 'BALANCE_CEILING');
    }
    const balanceAfter = wallet.balance + amount;
    if (wallet.balance >= 0 && balanceAfter < 0) {
      const actor = { id: actorId, nickname: await this.actorName(actorId) };
      const audience = [userId, ...(user.parentId ? [user.parentId] : [])];
      this.queueNotices(tx, await this.notice.write(tx, audience, actor, {
        kind: 'wallet.negative',
        payload: { balance: balanceAfter, ceiling: wallet.ceiling, loginName: user.loginName },
      }));
    }
    await tx.wallet.update({ where: { userId }, data: { balance: balanceAfter } });
    // A sale keeps its price chain; failing to read it never stops the sale (the report falls back to today's prices).
    const ladder = sale && amount < 0 ? await this.saleLadder(tx, userId, kind, sale).catch(() => null) : null;
    await tx.walletEntry.create({
      data: {
        userId,
        actorId,
        amount,
        balanceAfter,
        kind,
        note: note || null,
        msisdn: sale?.msisdn,
        lineId: sale?.lineId,
        companyName: sale?.companyName,
        packageName: sale?.packageName,
        packagePrice: sale?.packagePrice,
        providerCost: sale?.providerCost ?? null,
        esimPrice: sale?.esimPrice ?? null,
        periodDays: sale?.period?.days ?? null,
        periodEndsAt: sale?.period?.endsAt ?? null,
        ...(ladder ? { ladder: ladder as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  /**
   * The price chain of a sale as it stands now, kept on its wallet entry so each layer's margin stays what it was
   * (profit-ladder.ts). Null for an entry that is not a sale, or a line or package that cannot be read.
   */
  async saleLadder(db: Prisma.TransactionClient | PrismaClient, posId: string, kind: string, sale: Pick<Sale, 'lineId' | 'packagePrice'>): Promise<Ladder | null> {
    const priceKind = SALE_KINDS[kind];
    if (!priceKind || !sale.lineId) return null;
    const line = await db.line.findUnique({ where: { id: sale.lineId }, select: { terms: true } });
    const code = (line?.terms as { packageCode?: string } | null)?.packageCode;
    if (!code) return null;
    const path = this.pathOf(posId, await this.accounts());
    const [rows, subscriber] = await Promise.all([
      this.ladderRows([code], path.map((node) => node.id), db),
      db.package.findUnique({ where: { code }, select: { subscriberPrice: true, renewalSubscriberPrice: true } }),
    ]);
    const pkg = rows.packages[0];
    if (!pkg || !subscriber || path.length === 0) return null;
    return ladderOf(
      path,
      rows.termRows.filter((row) => row.packageId === pkg.id),
      rows.sellRows.filter((row) => row.packageId === pkg.id),
      { ...pkg, ...subscriber },
      priceKind,
      sale.packagePrice,
    );
  }

  async recordOp(tx: Prisma.TransactionClient, userId: string, actorId: string, kind: string, sale: Sale) {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) fail(404, 'NOT_FOUND');
    await tx.walletEntry.create({
      data: {
        userId,
        actorId,
        amount: 0,
        balanceAfter: wallet.balance,
        kind,
        msisdn: sale.msisdn,
        lineId: sale.lineId,
        companyName: sale.companyName,
        packageName: sale.packageName,
        packagePrice: sale.packagePrice,
        providerCost: sale.providerCost ?? 0,
        periodDays: sale.period?.days ?? null,
        periodEndsAt: sale.period?.endsAt ?? null,
      },
    });
  }

  /** The accounts from `userId` up to the root. Empty when the user is unknown. */
  pathOf(userId: string, accounts: Account[]): PathNode[] {
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const path: PathNode[] = [];
    let current = byId.get(userId);
    while (current && path.length <= accounts.length) {
      path.push(nodeOf(current));
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  }

  async termsFor(packageId: string): Promise<{ terms: TermRow[]; sells: SellRow[] }> {
    const [terms, sells] = await Promise.all([
      this.prisma.userPackage.findMany({ where: { packageId }, select: { userId: true, hidden: true, price: true, renewalPrice: true } }),
      this.prisma.sellPrice.findMany({ where: { packageId }, select: { ownerId: true, price: true, renewalPrice: true } }),
    ]);
    return { terms, sells };
  }

  /**
   * The rows behind what points of sale pay: the price columns of the packages named by `codes`, and
   * the custom rows and sell prices written on them for the accounts in `pathIds`. One read per table,
   * however many packages and paths are asked for, so a batch loads once and stamps every number from it.
   */
  async ladderRows(codes: string[], pathIds: string[], db: Prisma.TransactionClient | PrismaClient): Promise<LadderRows> {
    const packages = await db.package.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, ...PRICE_COLUMNS },
    });
    const ids = packages.map((row) => row.id);
    const [termRows, sellRows] = await Promise.all([
      db.userPackage.findMany({
        where: { packageId: { in: ids }, userId: { in: pathIds } },
        select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
      }),
      db.sellPrice.findMany({
        where: { packageId: { in: ids }, ownerId: { in: pathIds } },
        select: { packageId: true, ownerId: true, price: true, renewalPrice: true },
      }),
    ]);
    return { packages, termRows, sellRows };
  }

  /**
   * `stampFor` once the rows are loaded: no database. `rows` may hold the rows of many paths. Each
   * price is resolved through `path` alone, so the rows of other accounts are never read for it.
   */
  stampWith(terms: LineTerms, path: PathNode[], rows: LadderRows): LineTerms {
    if (path.length === 0) return terms;
    return stampRenewal(terms, (code) => {
      const pkg = rows.packages.find((row) => row.code === code);
      if (!pkg) return null;
      const termsOf = rows.termRows.filter((row) => row.packageId === pkg.id);
      const sellsOf = rows.sellRows.filter((row) => row.packageId === pkg.id);
      return buyPriceFor(path, termsOf, sellsOf, pkg, 'renewal');
    });
  }

  /** The four layer roles exist: made on first need (role screens, account access, boot). */
  async ensureLayerRoles() {
    for (const layer of LAYER_ORDER) {
      const existing = await this.prisma.role.findUnique({ where: { layer } });
      if (existing) continue;
      const grants = LAYER_GRANTS[layer] ?? [];
      await this.prisma.role.create({
        data: { name: layer, kind: 'layer', layer, grants: grants.join(','), ...flagsFor(grants) },
      });
    }
  }

  async visibleLine(actor: Actor, lineId: string) {
    const line = await this.prisma.line.findUnique({
      where: { id: lineId },
      include: { package: { include: { company: true, provider: true } } },
    });
    if (!line) fail(404, 'NOT_FOUND');
    if (!line.package.company || !line.package.provider) fail(400, 'INVALID');
    const accounts = await this.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(line.posId)) fail(403, 'FORBIDDEN');
    // The stop belongs to the selling account that owns the line, not to whoever clicks. The path
    // travels with the line so later price and visibility checks do not load the accounts again.
    const posPath = this.pathOf(line.posId, accounts);
    return Object.assign(line, { denied: deniedOpsFor(posPath), posPath });
  }
}
