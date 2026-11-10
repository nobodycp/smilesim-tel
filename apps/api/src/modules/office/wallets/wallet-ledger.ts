import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { AccountTree } from '../kernel/account-tree';
import type { Sale } from '../kernel/types';
import { UnitOfWork, type Db } from '../kernel/unit-of-work';
import { withinCeiling } from '../rules/office-rules';
import { REFUND_KINDS, SALE_KINDS, ladderOf, refundLadder, type Ladder } from '../rules/profit-ladder';
import { PriceLadder } from '../terms/price-ladder';

/**
 * The only writer of wallets (backend-engineering.mdc 1.2). Every method runs inside the caller's transaction and
 * locks the wallet row before it reads it, so the ceiling check and the balance it writes are serialised per
 * wallet (ADR 0004).
 */
@Injectable()
export class WalletLedger {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tree: AccountTree,
    private readonly ladder: PriceLadder,
  ) {}

  private async actorName(id: string, db: Db = this.uow.prisma): Promise<string> {
    const user = await db.user.findUnique({ where: { id }, select: { nickname: true, loginName: true } });
    return user?.nickname || user?.loginName || '';
  }

  /**
   * Locks several wallets in one fixed order (by user id), so two transactions that touch the same pair never wait
   * on each other in a circle (rule 1.4). Call it before the first `move` of a transfer between accounts.
   */
  async lockWallets(tx: Prisma.TransactionClient, userIds: string[]): Promise<void> {
    for (const userId of [...new Set(userIds)].sort()) {
      await tx.$queryRaw`SELECT "userId" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    }
  }

  /**
   * Holds `amount` on a wallet for an open task (roadmap N6): refused like a debit when the money the account may
   * spend (balance − held + ceiling) does not cover it. Writes a `hold` entry that moves no money.
   */
  async hold(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, note: string, sale?: Sale) {
    if (amount <= 0) return 0;
    await tx.$queryRaw`SELECT "userId" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!wallet || !user) fail(404, 'NOT_FOUND');
    if (!withinCeiling(user.layer, wallet.balance - (wallet.held ?? 0), wallet.ceiling, amount)) fail(400, 'BALANCE_CEILING');
    await tx.wallet.update({ where: { userId }, data: { held: { increment: amount } } });
    await tx.walletEntry.create({
      data: { userId, actorId, amount: 0, balanceAfter: wallet.balance, kind: 'hold', held: amount, note: note || null, msisdn: sale?.msisdn, lineId: sale?.lineId || null, packageName: sale?.packageName, companyName: sale?.companyName },
    });
    return amount;
  }

  /** Gives back a task's hold when it closes (done, cancelled, rejected). Writes a `release` entry. */
  async release(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, note: string) {
    if (amount <= 0) return;
    await tx.$queryRaw`SELECT "userId" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) return;
    const freed = Math.min(amount, wallet.held ?? 0);
    await tx.wallet.update({ where: { userId }, data: { held: { decrement: freed } } });
    await tx.walletEntry.create({ data: { userId, actorId, amount: 0, balanceAfter: wallet.balance, kind: 'release', held: -freed, note: note || null } });
  }

  async move(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, kind: string, note: string, sale?: Sale, reason?: string) {
    // Hold the wallet row until this transaction ends, so a concurrent move waits here and then reads the balance
    // this one wrote. Without it two moves read the same balance and one write is lost (ADR 0004).
    await tx.$queryRaw`SELECT "userId" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!wallet || !user) fail(404, 'NOT_FOUND');
    const debit = amount < 0 ? -amount : 0;
    // Money held for open tasks is not spendable (roadmap N6): the check runs on the balance less what is held.
    if (!withinCeiling(user.layer, wallet.balance - (wallet.held ?? 0), wallet.ceiling, debit)) {
      // The transaction rolls back, so this notice is written on its own and published at once.
      const actor = { id: actorId, nickname: await this.actorName(actorId) };
      const audience = [userId, ...(user.parentId ? [user.parentId] : [])];
      const rows = await this.uow.notice.write(this.uow.prisma, audience, actor, {
        kind: 'wallet.ceiling',
        payload: { balance: wallet.balance, ceiling: wallet.ceiling, attempted: debit, loginName: user.loginName },
      });
      await this.uow.publishQuietly(rows);
      fail(400, 'BALANCE_CEILING');
    }
    const balanceAfter = wallet.balance + amount;
    if (wallet.balance >= 0 && balanceAfter < 0) {
      const actor = { id: actorId, nickname: await this.actorName(actorId, tx) };
      const audience = [userId, ...(user.parentId ? [user.parentId] : [])];
      this.uow.queueNotices(tx, await this.uow.notice.write(tx, audience, actor, {
        kind: 'wallet.negative',
        payload: { balance: balanceAfter, ceiling: wallet.ceiling, loginName: user.loginName },
      }));
    }
    await tx.wallet.update({ where: { userId }, data: { balance: balanceAfter } });
    // A sale keeps its price chain; failing to read it never stops the sale (the report falls back to today's prices).
    const ladder = !sale
      ? null
      : amount < 0
        ? await this.saleLadder(tx, userId, kind, sale).catch(() => null)
        : REFUND_KINDS.has(kind)
          ? await this.refundOf(tx, amount, sale).catch(() => null)
          : null;
    await tx.walletEntry.create({
      data: {
        userId,
        actorId,
        amount,
        balanceAfter,
        kind,
        note: note || null,
        reason: reason ?? null,
        msisdn: sale?.msisdn,
        lineId: sale?.lineId || null,
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

  /** A refund's ladder: the line's last sale, scaled by the refunded part of what was paid (profit-ladder.ts). */
  private async refundOf(db: Db, refunded: number, sale: Pick<Sale, 'lineId' | 'packagePrice'>): Promise<Ladder | null> {
    if (!sale.lineId) return null;
    const last = await db.walletEntry.findFirst({
      where: { lineId: sale.lineId, kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!last) return null;
    const base = (last.ladder as Ladder | null) ?? (await this.saleLadder(db, last.userId, last.kind, { lineId: last.lineId ?? '', packagePrice: last.packagePrice ?? 0 }));
    return base ? refundLadder(base, refunded, sale.packagePrice || last.packagePrice || 0) : null;
  }

  /**
   * The price chain of a sale as it stands now, kept on its wallet entry so each layer's margin stays what it was
   * (profit-ladder.ts). Null for an entry that is not a sale, or a line or package that cannot be read.
   */
  private async saleLadder(db: Db, posId: string, kind: string, sale: Pick<Sale, 'lineId' | 'packagePrice'>): Promise<Ladder | null> {
    const priceKind = SALE_KINDS[kind];
    if (!priceKind || !sale.lineId) return null;
    const line = await db.line.findUnique({ where: { id: sale.lineId }, select: { terms: true } });
    const code = (line?.terms as { packageCode?: string } | null)?.packageCode;
    if (!code) return null;
    const path = this.tree.pathOf(posId, await this.tree.accounts(db));
    const [rows, subscriber] = await Promise.all([
      this.ladder.ladderRows([code], path.map((node) => node.id), db),
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
        lineId: sale.lineId || null,
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
