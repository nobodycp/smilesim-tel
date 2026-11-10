import { TransfersRepository } from './transfers.repository';
import { LineAccess } from '../lines/line-access';
import { WalletLedger } from '../wallets/wallet-ledger';
import { AccountTree } from '../kernel/account-tree';
import { UnitOfWork } from '../kernel/unit-of-work';
import { granted } from '../policy';
import { Injectable } from '@nestjs/common';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { TermsService } from '../terms/terms.service';
import type { Prisma } from '../../../generated/prisma/client';
import { nodeOf } from '../kernel/account-tree';
import { PRICE_COLUMNS } from '../terms/price-ladder';
import type { Account } from '../kernel/types';
import { RENEWABLE_STATUSES } from '../rules/line-prices';
import { visibleAccountIds } from '../rules/office-rules';
import { TRANSFER_GRANT, canTransfer, previewOf, transferKind, type TransferKind } from './transfer-rules';
import { deniedOpsFor } from '../rules/user-terms';
import { saleOf } from '../kernel/sale';
import type { z } from 'zod';
import { TransferAccountBody as AccountMove, TransferLineBody } from './transfers.schemas';

/** What a move is asked to do. Every field is checked before it is used, so each arrives as `unknown`. */
export type TransferAccountBody = {
  parentLogin?: unknown;
  ownPrices?: unknown;
  ownStops?: unknown;
  childPrices?: unknown;
  childStops?: unknown;
  linePrices?: unknown;
};

/**
 * The choices of a move once its kind is known. Only an agent has anything below it to choose for, so a
 * point of sale that states a choice about what is below it is as wrong as an agent that leaves one out.
 */
function transferChoices(kind: 'pos' | 'agent', stated: z.output<typeof AccountMove>) {
  const { childPrices, childStops, ownPrices, ownStops, linePrices } = stated;
  const own = { ownPrices, ownStops, linePrices };
  if (kind === 'pos') return childPrices === undefined && childStops === undefined ? { ...own, child: null } : null;
  return childPrices && childStops ? { ...own, child: { prices: childPrices, stops: childStops } } : null;
}

/** Moving an account (a point of sale under another agent, an agent under another main agent) or a number to another point of sale, with the preview that asks the same questions first. */
@Injectable()
export class TransfersService {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree, private readonly ledger: WalletLedger, private readonly lineAccess: LineAccess, private readonly terms: TermsService, readonly repo: TransfersRepository) {}

  /**
   * Moves a point of sale under another agent, or an agent under another main agent. The caller states
   * every choice: what the account's own terms do, what the terms below it do (an agent), and whether the
   * numbers under it keep the renewal prices they carry or take what the new parent would charge. All of it
   * is asked before anything is written, in this order: the words of the choices, which need no account;
   * then the rules, which are the preview's, so a refusal is the same in both; then what is below the
   * account, which depends on its kind. Wallets and numbers go with the account as they are. Everything
   * happens in one transaction, so a move either carries all its choices and both notices, or nothing.
   */
  async transferAccount(actor: Actor, loginName: string, body: unknown) {
    // The words of the choices need no account, so a body that cannot be a move is refused before any is read.
    const stated = parseInput(AccountMove, body);
    const accounts = await this.tree.accounts();
    const { moved, next, from, kind } = this.resolveTransfer(actor, accounts, loginName, stated.parentLogin);
    const choices = transferChoices(kind, stated);
    if (!choices) fail(400, 'INVALID');
    const posIds = accounts.filter((account) => account.parentId === moved.id).map((account) => account.id);
    const lines = await this.uow.runTx(async (tx) => {
      // A point of sale's numbers remember the agent they were first sold under.
      if (kind === 'pos') {
        await tx.line.updateMany({ where: { posId: moved.id, originAgentId: null }, data: { originAgentId: moved.parentId } });
      }
      await tx.user.update({ where: { id: moved.id }, data: { parentId: next.id } });
      // What the old parent wrote about the moved account goes only if the caller said so.
      if (choices.ownPrices === 'reset') await tx.userPackage.deleteMany({ where: { userId: moved.id } });
      if (choices.ownStops === 'reset') await tx.user.update({ where: { id: moved.id }, data: { deniedOps: '' } });
      if (choices.child?.prices === 'reset') {
        await tx.userPackage.deleteMany({ where: { userId: { in: posIds } } });
        await tx.sellPrice.deleteMany({ where: { ownerId: moved.id } });
      }
      if (choices.child?.stops === 'reset') await tx.user.updateMany({ where: { id: { in: posIds } }, data: { deniedOps: '' } });
      let repriced = 0;
      if (choices.linePrices === 'recapture') {
        // After the resets, so the numbers are priced by the rows that are left, and through the new parent.
        const renewable = await tx.line.findMany({
          where: { posId: { in: [moved.id, ...posIds] }, status: { in: [...RENEWABLE_STATUSES] } },
          include: { package: { include: { company: true, provider: true } } },
        });
        const accountsAfter = accounts.map((account) => (account.id === moved.id ? { ...account, parentId: next.id } : account));
        repriced = await this.terms.repriceLines(tx, renewable, () => ({ to: 'current' }), accountsAfter);
      }
      await this.writeTransferNotices(tx, actor, { kind, subject: moved.loginName, from, to: next });
      return repriced;
    });
    return { ok: true as const, lines };
  }

  /**
   * What moving `loginName` under `query.parentLogin` would carry, without writing anything. It asks the
   * same rules as the move, so a refusal reaches the dialog from here, and it reads each table once however
   * many accounts sit below.
   */
  async transferPreview(actor: Actor, loginName: string, query: { parentLogin?: unknown }) {
    const accounts = await this.tree.accounts();
    const { moved, next, kind } = this.resolveTransfer(actor, accounts, loginName, query.parentLogin);
    const nextPath = [nodeOf(moved), ...this.tree.pathOf(next.id, accounts)];
    // What is under the moved account: an agent's points of sale, nothing for a point of sale. They go with
    // it, so their paths after the move run through its own.
    const below = accounts.filter((account) => account.parentId === moved.id);
    const belowIds = below.map((account) => account.id);
    const subtree = [moved.id, ...belowIds];
    // The moved account heads the new chain, so one list serves its own rows and the rows that set its floor.
    const chainIds = nextPath.map((node) => node.id);
    const [terms, sells, packages, wallets, lines] = await Promise.all([
      this.uow.prisma.userPackage.findMany({
        where: { userId: { in: [...chainIds, ...belowIds] } },
        select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
      }),
      this.uow.prisma.sellPrice.findMany({
        where: { ownerId: { in: chainIds } },
        select: { packageId: true, ownerId: true, price: true, renewalPrice: true },
      }),
      this.uow.prisma.package.findMany({ select: { id: true, ...PRICE_COLUMNS } }),
      this.uow.prisma.wallet.findMany({ where: { userId: { in: subtree } }, select: { userId: true, balance: true } }),
      this.uow.prisma.line.count({ where: { posId: { in: subtree }, status: { in: [...RENEWABLE_STATUSES] } } }),
    ]);
    const balances = new Map(wallets.map((wallet) => [wallet.userId, wallet.balance]));
    return {
      balance: balances.get(moved.id) ?? 0,
      subtreeBalance: belowIds.reduce((sum, id) => sum + (balances.get(id) ?? 0), 0),
      ...previewOf({
        moved: this.tree.pathOf(moved.id, accounts),
        nextPath,
        // Only a point of sale has no child section. An agent with none still has its sell prices to count.
        children: kind === 'pos' ? null : below.map((account) => [nodeOf(account), ...nextPath]),
        terms,
        sells,
        packages,
      }),
      lines,
    };
  }

  /**
   * Moves a number to another point of sale. The caller states what happens to the renewal price the number
   * carries: it stays, or it is worked out again under the new point of sale (`recapture`). Only a number that
   * can still renew (active or frozen) is priced again, as in the move of an account; any other moves with its
   * terms as they are. There is no default, and the word is checked before anything is read. Then the rules
   * decide, the ones that decide a move of an account: the grant, a stop on the caller's own path, the point
   * of sale named, and what the caller can see. The move, its operation record, the recapture, and both
   * notices are one transaction.
   */
  async transferLine(actor: Actor, lineId: string, body: unknown) {
    const { posLogin, linePrices } = parseInput(TransferLineBody, body);
    const line = await this.lineAccess.visibleLine(actor, lineId);
    const accounts = await this.tree.accounts();
    const next = posLogin === undefined ? undefined : accounts.find((account) => account.loginName === posLogin);
    const from = accounts.find((account) => account.id === line.posId);
    const refusal = this.transferRefusal(actor, accounts, { kind: 'line', currentParentId: line.posId, next });
    if (refusal === 'FORBIDDEN') fail(403, 'FORBIDDEN');
    if (refusal || !next || !from) fail(400, 'INVALID');
    const locked = !line.package.companyId;
    await this.uow.runTx(async (tx) => {
      await tx.line.update({
        where: { id: line.id },
        data: { posId: next.id, opsLocked: locked },
      });
      await this.ledger.recordOp(tx, line.posId, actor.operatorId, 'transfer', saleOf(line));
      // After the move, so the number is priced through the point of sale it is on now and the chain above it.
      // Only a number that can still renew is priced again, as in the move of an account; any other moves with its terms.
      if (linePrices === 'recapture' && (RENEWABLE_STATUSES as readonly string[]).includes(line.status)) {
        await this.terms.repriceLines(tx, [{ ...line, posId: next.id }], () => ({ to: 'current' }), accounts);
      }
      await this.writeTransferNotices(tx, actor, { kind: 'line', subject: line.msisdn, from, to: next });
    });
    return { ok: true as const };
  }

  /**
   * The account a move names and the parent it names, once the rules allow the move, with the parent it
   * leaves and the kind of move. All of them come from the accounts the caller already loaded. A login that
   * is not there, or an account with no parent to change, answers like a destination of the wrong layer, but
   * not to a caller with no say over any move: that one is refused first, as `canTransfer` refuses before it
   * reads anything, so a refusal never tells what exists.
   */
  private resolveTransfer(actor: Actor, accounts: Account[], loginName: string, parentLogin: unknown) {
    const moved = accounts.find((account) => account.loginName === loginName);
    const kind = moved ? transferKind(moved.layer) : null;
    if (!moved || !kind) {
      const mayMove = !actor.impersonating && (granted(actor, TRANSFER_GRANT.pos) || granted(actor, TRANSFER_GRANT.agent));
      if (!mayMove) fail(403, 'FORBIDDEN');
      fail(400, 'INVALID');
    }
    const next = typeof parentLogin === 'string' ? accounts.find((account) => account.loginName === parentLogin) : undefined;
    const from = accounts.find((account) => account.id === moved.parentId);
    const refusal = this.transferRefusal(actor, accounts, { kind, currentParentId: moved.parentId ?? '', next });
    if (refusal === 'FORBIDDEN') fail(403, 'FORBIDDEN');
    if (refusal || !next || !from) fail(400, 'INVALID');
    return { moved, next, from, kind };
  }

  /**
   * What the transfer rules say about one move for this actor, on the accounts the caller already loaded.
   * The preview, the move of an account, and the move of a number all ask here, so each reads the
   * destination the same way: its layer, and whether it is frozen.
   */
  private transferRefusal(actor: Actor, accounts: Account[], move: { kind: TransferKind; currentParentId: string; next: Account | undefined }) {
    return canTransfer({
      kind: move.kind,
      actor: { grants: actor.grants, impersonating: actor.impersonating },
      actorStops: deniedOpsFor(this.tree.pathOf(actor.id, accounts)),
      currentParentId: move.currentParentId,
      destination: move.next ? { id: move.next.id, layer: move.next.layer, frozen: Boolean(move.next.disabledAt) } : null,
      visible: visibleAccountIds(actor.id, actor.layer, accounts),
    });
  }

  /**
   * Tells the account that lost something and the account that received it, in the caller's transaction.
   * Both notices are published together once it commits. `subject` is the msisdn or the login that moved.
   */
  private async writeTransferNotices(tx: Prisma.TransactionClient, actor: Actor, move: { kind: TransferKind; subject: string; from: Account; to: Account }) {
    const payload = { kind: move.kind, subject: move.subject, actorName: actor.nickname };
    const lost = await this.uow.notice.write(tx, [move.from.id], actor, { kind: 'transfer.out', payload: { ...payload, toLogin: move.to.loginName } });
    const gained = await this.uow.notice.write(tx, [move.to.id], actor, { kind: 'transfer.in', payload: { ...payload, fromLogin: move.from.loginName } });
    this.uow.queueNotices(tx, [...lost, ...gained]);
  }
}
