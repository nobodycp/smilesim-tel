import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { UnitOfWork, NEWEST_FIRST } from '../platform';
import type { MarginView } from './stored-margins';
import { OPEN_LOSSES } from './provider-cost';

/**
 * The database as this domain reads and writes it: wallets and wallet entries as the finance pages read them. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class WalletsRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** One account's wallet, or null. */
  walletOf(userId: string) {
    return this.uow.prisma.wallet.findUnique({ where: { userId } });
  }

  /** The credit ceiling is a setting, not money: the one wallet column written outside the ledger. */
  setCeiling(userId: string, ceiling: number) {
    return this.uow.prisma.wallet.update({ where: { userId }, data: { ceiling } });
  }

  /** Entries with their account and who acted, newest first, at most `take`. */
  entriesWithAccounts(where: Prisma.WalletEntryWhereInput, take: number) {
    return this.uow.prisma.walletEntry.findMany({ where, include: { user: true, actor: true }, orderBy: [...NEWEST_FIRST], take });
  }

  /** How many entries `where` holds, `take` at most, counted in the page's order (`countUpTo`, plan DB.8). */
  countEntries(where: Prisma.WalletEntryWhereInput, take: number) {
    return this.uow.prisma.walletEntry.count({ where, orderBy: [...NEWEST_FIRST], take });
  }

  /**
   * Each provider's purchases: the sum of the cost its operation entries stored, by provider (ADR 0025 rule 5).
   * Only operation entries carry a provider (`operationColumns`), so the filter is the partial index's predicate and
   * the sum is read from `WalletEntry_provider_createdAt_id` alone.
   */
  providerPurchases() {
    return this.uow.prisma.walletEntry.groupBy({ by: ['providerId'], where: { providerId: { not: null } }, _sum: { providerCost: true } });
  }

  /**
   * How many operations each provider was paid for and the point of sale was not charged for (spec DB.5 P.7): the
   * entries still open (a given-back one charged later is not, P.9), by provider, read from the partial index
   * `WalletEntry_provider_loss`.
   */
  providerLosses() {
    return this.uow.prisma.walletEntry.groupBy({ by: ['providerId'], where: { providerLoss: { not: null, in: [...OPEN_LOSSES] } }, _count: { _all: true } });
  }

  /** What one provider's operation entries stored as cost, up to an instant (inclusive), or ever when there is none. */
  providerCostUpTo(providerId: string, to: Date | null) {
    return this.uow.prisma.walletEntry.aggregate({ where: { providerId, ...(to ? { createdAt: { lte: to } } : {}) }, _sum: { providerCost: true } });
  }

  /** The operation entries the filter keeps with the provider and the cost they stored, newest first, at most `take`. */
  operationsAtProviders(where: Prisma.WalletEntryWhereInput, take: number | undefined) {
    return this.uow.prisma.walletEntry.findMany({
      where,
      select: { id: true, userId: true, createdAt: true, kind: true, msisdn: true, companyName: true, packageName: true, packagePrice: true, providerId: true, providerCost: true, esimPrice: true, providerLoss: true },
      orderBy: [...NEWEST_FIRST],
      ...(take === undefined ? {} : { take }),
    });
  }

  /**
   * Whether a package, and whether a company, in the catalog has a name containing one of these texts, case aside:
   * the finance search reads the entries' stored names only when one does (search, plan DB.6).
   */
  async catalogNamed(texts: string[]): Promise<{ packageNamed: boolean; companyNamed: boolean }> {
    const named = (text: string) => ({ name: { contains: text, mode: 'insensitive' as const } });
    const [pkg, company] = await Promise.all([
      this.uow.prisma.postpaidPackage.findFirst({ where: { OR: texts.map(named) }, select: { id: true } }),
      this.uow.prisma.postpaidCompany.findFirst({ where: { OR: texts.map(named) }, select: { id: true } }),
    ]);
    return { packageNamed: pkg !== null, companyNamed: company !== null };
  }

  /**
   * The sales and refunds the filter keeps, grouped by company, package and kind: how many, the viewer's stored margin
   * (`margin`, its layer's column, ADR 0026) and the newest. The profit report adds them up.
   */
  profitGroups(where: Prisma.WalletEntryWhereInput, margin: MarginView['margin']) {
    return this.uow.prisma.walletEntry.groupBy({
      by: ['companyName', 'packageName', 'kind'],
      where,
      _count: { _all: true },
      _sum: { [margin]: true } as Prisma.WalletEntrySumAggregateInputType,
      _max: { createdAt: true },
    });
  }

  /**
   * The operations marked as the branch's loss the filter keeps (spec DB.5 P.8), by company and package: how many,
   * the `branchMargin` they store (− their cost) and the newest, by mark too: a given-back one charged later (P.9)
   * keeps its margin in the profit and is no longer a loss to count. Served by `WalletEntry_loss_createdAt`.
   */
  lossGroups(where: Prisma.WalletEntryWhereInput) {
    return this.uow.prisma.walletEntry.groupBy({
      by: ['companyName', 'packageName', 'providerLoss'],
      where: { AND: [{ providerLoss: { not: null } }, where] },
      _count: { _all: true },
      _sum: { branchMargin: true },
      _max: { createdAt: true },
    });
  }

  /**
   * The operations marked as the branch's loss since a moment, by mark: how many and the `branchMargin` they store
   * (spec DB.5 P.8; P.9 tells the open marks from the ones charged later).
   */
  lossTotal(since: Date) {
    return this.uow.prisma.walletEntry.groupBy({ by: ['providerLoss'], where: { providerLoss: { not: null }, createdAt: { gte: since } }, _count: { _all: true }, _sum: { branchMargin: true } });
  }

  /** A marked operation's entry as its charge reads it (spec DB.5 P.9), or null. */
  markedEntry(id: string) {
    return this.uow.prisma.walletEntry.findUnique({
      where: { id },
      select: { id: true, userId: true, kind: true, providerLoss: true, msisdn: true, companyName: true, packageName: true, packagePrice: true, esimPrice: true, providerId: true, user: { select: { loginName: true } } },
    });
  }

  /**
   * The packages a marked operation's entry names (no line was made): its provider's, by the package's and the
   * company's name the entry stores. At most two, so the caller can tell one from several.
   */
  packagesNamed(providerId: string, packageName: string, companyName: string) {
    return this.uow.prisma.postpaidPackage.findMany({
      where: { providerId, name: packageName, ...(companyName ? { company: { name: companyName } } : { companyId: null }) },
      select: { code: true },
      take: 2,
    });
  }

  /** The sales and refunds the filter keeps, by kind: how many and the viewer's stored margin (`margin`). */
  marginsByKind(where: Prisma.WalletEntryWhereInput, margin: MarginView['margin']) {
    return this.uow.prisma.walletEntry.groupBy({ by: ['kind'], where, _count: { _all: true }, _sum: { [margin]: true } as Prisma.WalletEntrySumAggregateInputType });
  }

  /** One account's money movements since a moment, oldest first: the finance page's chart. */
  movementsSince(userId: string, since: Date) {
    return this.uow.prisma.walletEntry.findMany({
      where: { userId, amount: { not: 0 }, createdAt: { gte: since } },
      select: { createdAt: true, amount: true, balanceAfter: true, kind: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
