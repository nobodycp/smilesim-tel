import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { UnitOfWork, NEWEST_FIRST } from '../platform';
import type { MarginView } from './stored-margins';

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

  /** What one provider's operation entries stored as cost, up to an instant (inclusive), or ever when there is none. */
  providerCostUpTo(providerId: string, to: Date | null) {
    return this.uow.prisma.walletEntry.aggregate({ where: { providerId, ...(to ? { createdAt: { lte: to } } : {}) }, _sum: { providerCost: true } });
  }

  /** The operation entries the filter keeps with the provider and the cost they stored, newest first, at most `take`. */
  operationsAtProviders(where: Prisma.WalletEntryWhereInput, take: number | undefined) {
    return this.uow.prisma.walletEntry.findMany({
      where,
      select: { id: true, createdAt: true, kind: true, msisdn: true, companyName: true, packageName: true, providerId: true, providerCost: true, esimPrice: true },
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
      this.uow.prisma.package.findFirst({ where: { OR: texts.map(named) }, select: { id: true } }),
      this.uow.prisma.company.findFirst({ where: { OR: texts.map(named) }, select: { id: true } }),
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
