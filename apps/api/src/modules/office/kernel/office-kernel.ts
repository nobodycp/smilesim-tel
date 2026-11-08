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

/**
 * What every office domain shares: the PostgreSQL client, the signed-in actor and their grants, the account
 * list, transactions that publish their notices after commit, and the wallet moves. One instance per process;
 * OfficeService and the domain services under `modules/office/<domain>/` all read through it.
 */
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
      },
    });
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
}
