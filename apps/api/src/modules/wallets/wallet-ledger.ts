import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { logger, fail, UnitOfWork, type Db } from '../platform';
import { AccountTree } from '../access';
import type { Sale } from './sale';
import { operationColumns, type ProviderLoss } from './provider-cost';
import { uncoveredDebit, withinCeiling } from './ceiling';
import { REFUND_KINDS, SALE_KINDS, ladderOf, refundLadder, type Ladder, PriceLadder } from '../postpaid/pricing';
import { NO_MARGINS, chainIdsOf, lossMargins, marginColumns, storedChainIds, type ChainIds, type MarginColumns } from './stored-margins';

const log = logger('WalletLedger');

/** An operation entry and the provider and cost the provider ledger's backfill stores on it. */
export type RepricedEntry = { id: string; providerId: string; cost: number };

/**
 * The provider ledger's backfill (`cli/provider-ledger-backfill.ts`; ADR 0025, amendment): the one write to an
 * operation entry after it was written. It sets the provider and the cost of the given entries, in the caller's
 * transaction, and only where either differs, so a second run writes nothing. No money moves: `amount`,
 * `balanceAfter` and every wallet stay as they are. Allowed only before launch, on trial data (the owner's standing
 * rule); after launch an entry's provider and cost are never updated. Answers how many rows it wrote.
 */
export async function rewriteOperationColumns(tx: Prisma.TransactionClient, rows: RepricedEntry[]): Promise<number> {
  let written = 0;
  for (let at = 0; at < rows.length; at += 1000) {
    const batch = rows.slice(at, at + 1000);
    written += await tx.$executeRaw`
      UPDATE "WalletEntry" AS entry SET "providerId" = given.provider, "providerCost" = given.cost
      FROM unnest(${batch.map((row) => row.id)}::text[], ${batch.map((row) => row.providerId)}::text[], ${batch.map((row) => row.cost)}::int[]) AS given(id, provider, cost)
      WHERE entry."id" = given.id
        AND (entry."providerId" IS DISTINCT FROM given.provider OR entry."providerCost" IS DISTINCT FROM given.cost)`;
  }
  return written;
}

/** An operation entry the provider ledger's backfill marks as the branch's loss (spec DB.5 P.7), with its cost. */
export type MarkedEntry = { id: string; cost: number; loss: ProviderLoss };

/**
 * The provider ledger's backfill, P.7 pass: marks old operations the provider was paid for and the point of sale was
 * not charged for, with their cost and the branch's loss as their margin (`lossMargins`), only where one differs, so
 * a second run writes nothing. No money moves. Trial data only, as `rewriteOperationColumns`. Answers the rows written.
 */
export async function markProviderLosses(tx: Prisma.TransactionClient, rows: MarkedEntry[]): Promise<number> {
  let written = 0;
  for (let at = 0; at < rows.length; at += 1000) {
    const batch = rows.slice(at, at + 1000);
    written += await tx.$executeRaw`
      UPDATE "WalletEntry" AS entry SET "providerCost" = given.cost, "providerLoss" = given.loss, "branchMargin" = -given.cost
      FROM unnest(${batch.map((row) => row.id)}::text[], ${batch.map((row) => row.cost)}::int[], ${batch.map((row) => row.loss)}::text[]) AS given(id, cost, loss)
      WHERE entry."id" = given.id AND entry."amount" = 0
        AND (entry."providerCost" IS DISTINCT FROM given.cost OR entry."providerLoss" IS DISTINCT FROM given.loss OR entry."branchMargin" IS DISTINCT FROM -given.cost)`;
  }
  return written;
}

/** An activation given back after the provider's success that wrote no entry (before P.7), as the backfill writes it. */
export type GivenBackEntry = { userId: string; actorId: string; at: Date; balanceAfter: number; note: string; sale: Sale };

/**
 * The provider ledger's backfill, P.7 pass: writes the entry an old `release-after-success` approval did not write,
 * dated at the approval, as `recordOp` writes one today (`operationColumns`, `lossMargins`). `balanceAfter` is the
 * point of sale's balance after its last entry before that time, read by the caller: the entry moves no money and no
 * wallet is written. Trial data only.
 */
export async function writeGivenBack(tx: Prisma.TransactionClient, row: GivenBackEntry): Promise<string> {
  const operation = operationColumns('activate', row.sale, true, 0);
  const created = await tx.walletEntry.create({
    data: {
      userId: row.userId, actorId: row.actorId, amount: 0, balanceAfter: row.balanceAfter, kind: 'activate', note: row.note || null,
      msisdn: row.sale.msisdn, lineId: null, companyName: row.sale.companyName, packageName: row.sale.packageName, packagePrice: row.sale.packagePrice,
      esimPrice: row.sale.esimPrice ?? null, ...operation, ...lossMargins(operation.providerCost ?? 0), createdAt: row.at,
    },
    select: { id: true },
  });
  return created.id;
}

/** A sale or refund entry and the ladder and margins the stored margins' backfill stores on it. */
export type MarginedEntry = { id: string; ladder: Ladder; columns: MarginColumns };

/**
 * The stored margins' backfill (`cli/stored-margins-backfill.ts`; ADR 0026, amendment): the one write of an entry's
 * ladder and margins after it was written. It sets them on the given entries, in the caller's transaction, and only
 * where one differs, so a second run writes nothing. No money moves: `amount`, `balanceAfter` and every wallet stay
 * as they are. Allowed only before launch, on trial data (the owner's standing rule); after launch an entry's margins
 * are never updated. Answers how many rows it wrote.
 */
export async function rewriteMarginColumns(tx: Prisma.TransactionClient, rows: MarginedEntry[]): Promise<number> {
  let written = 0;
  for (let at = 0; at < rows.length; at += 1000) {
    const batch = rows.slice(at, at + 1000);
    const column = <K extends keyof MarginColumns>(key: K) => batch.map((row) => row.columns[key]);
    written += await tx.$executeRaw`
      UPDATE "WalletEntry" AS entry
      SET "ladder" = given.ladder, "chainPosId" = given.pos, "chainAgentId" = given.agent, "chainMainAgentId" = given.main,
          "posMargin" = given.pos_margin, "agentMargin" = given.agent_margin, "mainAgentMargin" = given.main_margin, "branchMargin" = given.branch_margin
      FROM unnest(
        ${batch.map((row) => row.id)}::text[], ${batch.map((row) => JSON.stringify(row.ladder))}::jsonb[],
        ${column('chainPosId')}::text[], ${column('chainAgentId')}::text[], ${column('chainMainAgentId')}::text[],
        ${column('posMargin')}::int[], ${column('agentMargin')}::int[], ${column('mainAgentMargin')}::int[], ${column('branchMargin')}::int[]
      ) AS given(id, ladder, pos, agent, main, pos_margin, agent_margin, main_margin, branch_margin)
      WHERE entry."id" = given.id
        AND (entry."ladder" IS DISTINCT FROM given.ladder OR entry."chainPosId" IS DISTINCT FROM given.pos
          OR entry."chainAgentId" IS DISTINCT FROM given.agent OR entry."chainMainAgentId" IS DISTINCT FROM given.main
          OR entry."posMargin" IS DISTINCT FROM given.pos_margin OR entry."agentMargin" IS DISTINCT FROM given.agent_margin
          OR entry."mainAgentMargin" IS DISTINCT FROM given.main_margin OR entry."branchMargin" IS DISTINCT FROM given.branch_margin)`;
  }
  return written;
}

/** A wallet as `post` needs it: the row, and of its owner what a notice names. */
type PostedWallet = { userId: string; balance: number; ceiling: number; layer: string; parentId: string | null; loginName: string };

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
  async hold(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, note: string, sale?: Pick<Sale, 'msisdn' | 'lineId' | 'companyName' | 'packageName' | 'packagePrice'>) {
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

  /**
   * Turns a task's hold into its charge (ADR 0019, D10): under the wallet's lock, the hold is given back and the
   * debit is posted, in the caller's transaction. The rows it writes are the ones a release followed by a debit
   * writes (a `release` entry, then the sale entry with its price ladder), so reports read the same ledger.
   *
   * The debit need not be the amount held: a task whose price is worked out when it is completed (a package
   * switch, whose difference moves with every day that passes) brings the amount of that day.
   * - **Up to the hold**, the debit is covered: the ceiling is not checked again. It was checked when the hold was
   *   taken, and held money could not be spent by anything else since. What the hold has beyond the debit goes
   *   back to the wallet in the same write.
   * - **Beyond the hold**, only the excess is new money: it is checked like any debit, against what the wallet
   *   can spend now with this hold still counted as held. If it does not fit, the whole capture is refused
   *   (`BALANCE_CEILING`) and nothing changes.
   *
   * It refuses, and changes nothing, when the wallet holds less than `held`: that hold was already given back,
   * and charging again would be a second charge. The caller runs it only inside the transaction that claimed the
   * task, so it runs once. `held` may be 0 (a task that held nothing): the debit is then all excess.
   */
  async capture(tx: Prisma.TransactionClient, userId: string, held: number, amount: number, actorId: string, kind: string, note: string, sale?: Sale) {
    const debit = -amount;
    if (!Number.isInteger(held) || !Number.isInteger(amount) || held < 0 || debit <= 0) fail(400, 'INVALID');
    await tx.$queryRaw`SELECT "userId" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!wallet || !user) fail(404, 'NOT_FOUND');
    const walletHeld = wallet.held ?? 0;
    if (walletHeld < held) {
      log.error(`capture refused for wallet ${userId}: it holds less than the ${kind} task's hold; nothing was changed`);
      fail(409, 'DUPLICATE_REQUEST');
    }
    const excess = uncoveredDebit(held, debit);
    // The excess is judged with this task's hold still held: the covered part is not spendable twice.
    if (!withinCeiling(user.layer, wallet.balance - walletHeld, wallet.ceiling, excess)) await this.refuseCeiling(wallet, user, actorId, excess);
    if (held > 0) {
      await tx.wallet.update({ where: { userId }, data: { held: { decrement: held } } });
      await tx.walletEntry.create({ data: { userId, actorId, amount: 0, balanceAfter: wallet.balance, kind: 'release', held: -held, note: note || null } });
    }
    await this.post(tx, { ...wallet, layer: user.layer, parentId: user.parentId, loginName: user.loginName }, amount, actorId, kind, note, sale);
  }

  /** Tells the account and its parent that a debit did not fit, and refuses it. The notice is written outside the transaction, which rolls back. */
  private async refuseCeiling(wallet: { userId: string; balance: number; ceiling: number }, user: { parentId: string | null; loginName: string }, actorId: string, attempted: number): Promise<never> {
    const actor = { id: actorId, nickname: await this.actorName(actorId) };
    const audience = [wallet.userId, ...(user.parentId ? [user.parentId] : [])];
    const rows = await this.uow.notice.write(this.uow.prisma, audience, actor, {
      kind: 'wallet.ceiling',
      payload: { balance: wallet.balance, ceiling: wallet.ceiling, attempted, loginName: user.loginName },
    });
    await this.uow.publishQuietly(rows);
    fail(400, 'BALANCE_CEILING');
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
    if (!withinCeiling(user.layer, wallet.balance - (wallet.held ?? 0), wallet.ceiling, debit)) await this.refuseCeiling(wallet, user, actorId, debit);
    await this.post(tx, { ...wallet, layer: user.layer, parentId: user.parentId, loginName: user.loginName }, amount, actorId, kind, note, sale, reason);
  }

  /**
   * Writes a movement on a wallet the caller has locked and judged: the new balance, the notice when it goes
   * below zero, and the entry with the sale and its price ladder. `move` and `capture` both end here, so a charge
   * is recorded the same way whichever of them made it.
   */
  private async post(tx: Prisma.TransactionClient, wallet: PostedWallet, amount: number, actorId: string, kind: string, note: string, sale?: Sale, reason?: string) {
    const { userId } = wallet;
    const balanceAfter = wallet.balance + amount;
    if (wallet.balance >= 0 && balanceAfter < 0) {
      const actor = { id: actorId, nickname: await this.actorName(actorId, tx) };
      const audience = [userId, ...(wallet.parentId ? [wallet.parentId] : [])];
      this.uow.queueNotices(tx, await this.uow.notice.write(tx, audience, actor, {
        kind: 'wallet.negative',
        payload: { balance: balanceAfter, ceiling: wallet.ceiling, loginName: wallet.loginName },
      }));
    }
    await tx.wallet.update({ where: { userId }, data: { balance: balanceAfter } });
    // A sale keeps its price chain, and a refund its sale's scaled by the part given back. Each layer's margin on it
    // is stored beside it in the same INSERT (ADR 0026): computed here from the ladder and the path's layers already
    // read, so no statement, read or lock is added under the wallet lock.
    const priced = !sale
      ? null
      : amount < 0
        ? await this.saleLadder(tx, userId, kind, sale)
        : REFUND_KINDS.has(kind)
          ? await this.refundOf(tx, amount, sale)
          : null;
    // A sale is never written without its margins (ADR 0028, decision 4; spec F.3): a sale kind that moves money out
    // with no ladder is refused before the INSERT, and the caller's transaction rolls back (the balance above too).
    // The CHECK `WalletEntry_sale_has_ladder` says the same in the database.
    if (amount < 0 && SALE_KINDS[kind] && !priced) {
      log.error(`a ${kind} entry of ${amount} on wallet ${userId} has no ladder: refused, nothing was written`);
      throw new Error(`a ${kind} sale is written without its ladder (ADR 0028, decision 4)`);
    }
    // An operation's provider, cost and loss mark, fixed now (ADR 0025; P.7): part of this INSERT, no statement of their own.
    const operation = operationColumns(kind, sale, false, amount);
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
        ...operation,
        esimPrice: sale?.esimPrice ?? null,
        periodDays: sale?.period?.days ?? null,
        periodEndsAt: sale?.period?.endsAt ?? null,
        periodCost: sale?.periodCost ?? null,
        chargesEntryId: sale?.charges?.entryId ?? null,
        ...(priced
          ? { ladder: priced.ladder as unknown as Prisma.InputJsonValue, ...marginColumns(priced.ladder, priced.ids) }
          : operation.providerLoss ? lossMargins(operation.providerCost ?? 0) : NO_MARGINS),
      },
    });
  }

  /**
   * A refund's ladder: the line's last sale, scaled by the refunded part of what was paid (profit-ladder.ts), with
   * that sale's chain ids, which the refund stores as its own (ADR 0026: its margins go to the accounts of the sale).
   */
  private async refundOf(db: Db, refunded: number, sale: Pick<Sale, 'lineId' | 'packagePrice'>): Promise<{ ladder: Ladder; ids: ChainIds } | null> {
    if (!sale.lineId) return null;
    const last = await db.walletEntry.findFirst({
      where: { lineId: sale.lineId, kind: { in: Object.keys(SALE_KINDS) }, amount: { lt: 0 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!last) return null;
    const kept = last.ladder as Ladder | null;
    const base = kept
      ? { ladder: kept, ids: storedChainIds(last) ?? (await this.chainIdsOfKept(db, kept)) }
      : await this.saleLadder(db, last.userId, last.kind, { lineId: last.lineId ?? '', packagePrice: last.packagePrice ?? 0 });
    const ladder = base ? refundLadder(base.ladder, refunded, sale.packagePrice || last.packagePrice || 0) : null;
    return base && ladder ? { ladder, ids: base.ids } : null;
  }

  /**
   * The layers of a kept ladder's chain, for a sale entry that kept its ladder but not its chain ids: only one written
   * before the stored margins and not yet backfilled (`stored-margins-backfill` gives every such entry its ids). Read
   * by the chain's own ids, the accounts' layers never change.
   */
  private async chainIdsOfKept(db: Db, ladder: Ladder): Promise<ChainIds> {
    const rows = await db.user.findMany({ where: { id: { in: ladder.chain } }, select: { id: true, layer: true } });
    const layerOf = new Map(rows.map((row) => [row.id, row.layer]));
    return chainIdsOf(ladder.chain.map((id) => ({ id, layer: layerOf.get(id) ?? '' })));
  }

  /**
   * The price chain of a sale as it stands now, kept on its wallet entry so each layer's margin stays what it was
   * (profit-ladder.ts). Null for an entry that is not a sale, or a line or package that cannot be read: `post` then
   * refuses the sale (spec F.3).
   *
   * The seller's path is the one the caller read before its transaction and priced the sale on (`sale.path`); it
   * is confirmed here, under the wallet lock, by its accounts' rows alone (`AccountTree.confirmedPath`), and a path
   * that is no longer the seller's refuses the sale (409). The whole tree is never read under the lock (database
   * plan DB.9, ADR 0023). The price rows are read here, under the lock, by the path's ids, as before. The path's
   * layers name the chain's accounts the entry stores its margins for (ADR 0026, `chainIdsOf`).
   */
  private async saleLadder(db: Db, posId: string, kind: string, sale: Pick<Sale, 'lineId' | 'packagePrice' | 'path' | 'charges' | 'packageCode'>): Promise<{ ladder: Ladder; ids: ChainIds } | null> {
    const priceKind = SALE_KINDS[kind];
    if (!priceKind) return null;
    // A given-back operation charged later (P.9) names its package: no line was made. So does an immediate renewal
    // onto another package: the line still names the package it leaves.
    const code = sale.charges?.packageCode ?? sale.packageCode ?? (await this.packageCodeOf(db, sale.lineId));
    if (!code) return null;
    const path = await this.tree.confirmedPath(db, posId, sale.path);
    const [rows, subscriber] = await Promise.all([
      this.ladder.ladderRows([code], path.map((node) => node.id), db),
      db.postpaidPackage.findUnique({ where: { code }, select: { subscriberPrice: true, renewalSubscriberPrice: true } }),
    ]);
    const pkg = rows.packages[0];
    if (!pkg || !subscriber || path.length === 0) return null;
    // The charge of a given-back operation (P.9, ADR 0027): the provider's cost at the branch is 0 on its ladder, so
    // the branch earns its sell price on it; the purchase is the marked row's, at its own date.
    const prices = sale.charges ? { ...pkg, branchCost: 0, renewalBranchCost: 0 } : pkg;
    const ladder = ladderOf(
      path,
      rows.termRows.filter((row) => row.packageId === pkg.id),
      rows.sellRows.filter((row) => row.packageId === pkg.id),
      { ...prices, ...subscriber },
      priceKind,
      sale.packagePrice,
    );
    return { ladder, ids: chainIdsOf(path) };
  }

  /** The package a line's terms name, or null when there is no line. */
  private async packageCodeOf(db: Db, lineId: string): Promise<string | null> {
    if (!lineId) return null;
    const line = await db.postpaidLine.findUnique({ where: { id: lineId }, select: { terms: true } });
    return (line?.terms as { packageCode?: string } | null)?.packageCode ?? null;
  }

  /**
   * Charges the point of sale for an activation given back after the provider's success (spec DB.5 P.9, ADR 0027),
   * in the caller's transaction: the point of sale's wallet locked first, then the marked row's mark turned
   * `given_back` → `charged_later` by a guarded UPDATE (one row, or 409 `DUPLICATE_REQUEST`: charged already, or a
   * concurrent charge got there first), no money column of it touched; then the debit through `move`, as any sale
   * (held money, the ceiling, the notice below zero), its entry naming the row (`sale.charges`, unique).
   */
  async chargeLater(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, note: string, sale: Sale & { charges: NonNullable<Sale['charges']> }) {
    await this.lockWallets(tx, [userId]);
    const turned = await tx.$executeRaw`UPDATE "WalletEntry" SET "providerLoss" = 'charged_later' WHERE "id" = ${sale.charges.entryId} AND "providerLoss" = 'given_back'`;
    if (turned !== 1) fail(409, 'DUPLICATE_REQUEST');
    await this.move(tx, userId, -amount, actorId, 'activate', note, sale);
  }

  /**
   * Records an operation that moves no money: an entry of amount 0 with the operation's provider and cost, and its loss
   * mark when the provider was paid and the point of sale charged nothing (P.7: a sale priced 0, or one given back
   * after the provider's success), with the branch's loss as its margin. `note`: why, when the caller has a reason.
   */
  async recordOp(tx: Prisma.TransactionClient, userId: string, actorId: string, kind: string, sale: Sale, note = '') {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) fail(404, 'NOT_FOUND');
    const operation = operationColumns(kind, sale, true, 0);
    await tx.walletEntry.create({
      data: {
        userId,
        actorId,
        amount: 0,
        balanceAfter: wallet.balance,
        kind,
        note: note || null,
        msisdn: sale.msisdn,
        lineId: sale.lineId || null,
        companyName: sale.companyName,
        packageName: sale.packageName,
        packagePrice: sale.packagePrice,
        ...operation,
        ...(operation.providerLoss ? lossMargins(operation.providerCost ?? 0) : {}),
        // The eSIM fee the sale names: on a given-back activation, the part of what was held beyond the package price,
        // so the charge of it later (P.9) knows the whole amount.
        esimPrice: sale.esimPrice ?? null,
        periodDays: sale.period?.days ?? null,
        periodEndsAt: sale.period?.endsAt ?? null,
        periodCost: sale.periodCost ?? null,
      },
    });
  }
}
