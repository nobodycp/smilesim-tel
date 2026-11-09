import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { lineTermsOf } from '../kernel/line-terms';
import { OfficeKernel } from '../kernel/office-kernel';
import { lastWindow, openPeriods, revalue, settleDisconnect, switchOver, windowMonthsOf, type LineTerms } from '../office-rules';
import { packageTermsOf, type PackagePriceRow } from '../office-terms';
import { buyPriceFor, visibleTo, type LayerPrices, type PathNode, type PriceKind } from '../user-terms';

type Db = Prisma.TransactionClient | PrismaClient;
type PricedLine = { id: string; endsAt: Date; terms: Prisma.JsonValue; package: PackagePriceRow };

/** Wallet entries that put paid time on a line; a refund reads them back. */
export const PREPAID_KINDS = ['activate', 'charge', 'extend', 'reactivate', 'switch'];

/**
 * What a number costs: the price its point of sale pays, the refund a disconnect gives, the difference a switch
 * moves. Every method takes the client to read with, so a transaction prices from what it has locked (rule 1.3).
 */
@Injectable()
export class LinePricing {
  constructor(private readonly kernel: OfficeKernel) {}

  async visibleFor(userId: string, pkg: { id: string; enabled: boolean; forSale: boolean }, path?: PathNode[]): Promise<boolean> {
    const [known, { terms }] = await Promise.all([path ? Promise.resolve(path) : this.kernel.pathOf(userId, await this.kernel.accounts()), this.kernel.termsFor(pkg.id)]);
    return visibleTo(known, terms, pkg);
  }

  /**
   * What `userId` pays for this package today: its custom price, else its parent's sell price, else
   * the layer column. It is only ever asked what a new capture would carry or charge (an activation,
   * a restart, the target of a switch). A renewal never asks: it debits the price on the line.
   */
  async resolveBuyPrice(userId: string, pkg: { id: string } & LayerPrices, kind: PriceKind, known?: PathNode[], db: Db = this.kernel.prisma): Promise<number> {
    const [path, { terms, sells }] = await Promise.all([
      known ? Promise.resolve(known) : this.kernel.pathOf(userId, await this.kernel.accounts(db)),
      this.kernel.termsFor(pkg.id, db),
    ]);
    if (path.length === 0) return buyPriceFor([{ id: userId, loginName: '', layer: 'pos', deniedOps: '' }], [], [], pkg, kind);
    return buyPriceFor(path, terms, sells, pkg, kind);
  }

  /**
   * Writes into terms about to be saved the renewal price the point of sale would pay today, for the
   * package and for each of its renewal targets: custom price, else the parent's sell price, else the
   * layer column. One read per table serves every package named in the terms. A point of sale that is
   * not in the tree leaves the terms as captured.
   */
  async stampFor(terms: LineTerms, posId: string, known?: PathNode[], db: Db = this.kernel.prisma): Promise<LineTerms> {
    const path = known ?? this.kernel.pathOf(posId, await this.kernel.accounts(db));
    if (path.length === 0) return terms;
    const codes = [...new Set([terms.packageCode, ...terms.renewalTargets.map((target) => target.code)])];
    return this.kernel.stampWith(terms, path, await this.kernel.ladderRows(codes, path.map((node) => node.id), db));
  }

  /** What a disconnect credits now, or null when no paid period is open. */
  async disconnectSettlementFor(db: Db, line: PricedLine, now: Date) {
    const { terms, periods, lastPrice } = await this.openPeriodsOf(db, line, now);
    const settled = settleDisconnect(periods, (renewal) => (renewal ? terms.renewal.branchCost : terms.subscription.branchCost));
    return settled ? { ...settled, posPrice: lastPrice } : null;
  }

  /** The line's paid periods still open. Rows written before periods were stored fall back to the last window. */
  private async openPeriodsOf(db: Db, line: PricedLine, now: Date) {
    const terms = lineTermsOf(line.terms, line.package);
    const rows = await db.walletEntry.findMany({
      where: { lineId: line.id, kind: { in: PREPAID_KINDS } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { kind: true, packagePrice: true, periodDays: true, periodEndsAt: true },
    });
    const last = rows[0];
    const renewal = Boolean(last && (last.kind === 'charge' || last.kind === 'extend' || last.kind === 'reactivate'));
    const lastPrice = last?.packagePrice ?? (renewal ? terms.renewal.posPrice : terms.subscription.posPrice);
    const periods = openPeriods(now, rows) ?? lastWindow(now, line.endsAt, windowMonthsOf(terms), lastPrice, renewal);
    return { terms, periods, lastPrice };
  }

  async switchQuote(db: Db, line: PricedLine & { posId: string }, target: PackagePriceRow & { id: string }, now: Date) {
    const { terms, periods } = await this.openPeriodsOf(db, line, now);
    const nextTerms = packageTermsOf(target);
    // The whole ladder, as `stampFor` resolves it: the quote and the price the switched line carries are one number.
    const newPrice = await this.resolveBuyPrice(line.posId, target, 'renewal', undefined, db);
    const money = switchOver(periods, newPrice, target.months);
    // The branch side: each open period's cost, chosen like a disconnect, against the target's subscription cost.
    const costs = revalue(periods, (period) => (period.renewal ? terms.renewal.branchCost : terms.subscription.branchCost));
    const cost = switchOver(costs, nextTerms.subscription.branchCost, target.months);
    return { ...money, newPrice, providerCost: cost.difference };
  }

  /** A number nobody holds, for an activation that names none. */
  async freshMsisdn(db: Db = this.kernel.prisma): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const msisdn = `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
      const existing = await db.line.findUnique({ where: { msisdn } });
      if (!existing) return msisdn;
    }
    fail(400, 'INVALID');
  }
}
