import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork, LIST_CAP, NEWEST_FIRST } from '../../platform';

/**
 * The database as this domain reads and writes it: the rows the branch reports list. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class ReportsRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Every package under a company, with its provider, its company and how many lines it has. */
  packagesByProvider() {
    return this.uow.prisma.package.findMany({
      where: { companyId: { not: null } },
      include: { provider: true, company: true, _count: { select: { lines: true } } },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' } ],
      take: LIST_CAP + 1,
    });
  }

  /** One page of ledger entries, newest first, with the account and the one who acted. */
  entriesPage(where: Prisma.WalletEntryWhereInput, take: number) {
    return this.uow.prisma.walletEntry.findMany({
      where,
      include: { user: true, actor: true },
      orderBy: [...NEWEST_FIRST],
      take,
    });
  }

  /** How many entries `where` holds, `take` at most, counted in the page's order (`countUpTo`, plan DB.8). */
  entryCount(where: Prisma.WalletEntryWhereInput, take: number) {
    return this.uow.prisma.walletEntry.count({ where, orderBy: [...NEWEST_FIRST], take });
  }

  walletsOf(userIds: string[]) {
    return this.uow.prisma.wallet.findMany({ where: { userId: { in: userIds } } });
  }

  /** When each of these accounts last had a ledger entry. */
  lastMovementOf(userIds: string[]) {
    return this.uow.prisma.walletEntry.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { createdAt: true } });
  }

  /**
   * The provider operations of these kinds over the dates, by the provider each stored: how many, the cost they
   * stored (ADR 0025), the branch's margin the sales and refunds among them stored (ADR 0026), and the newest.
   */
  providerFigures(kinds: string[], createdAt: Prisma.DateTimeFilter | undefined) {
    return this.uow.prisma.walletEntry.groupBy({
      by: ['providerId'],
      where: { kind: { in: kinds }, providerId: { not: null }, ...(createdAt ? { createdAt } : {}) },
      _count: { _all: true },
      _sum: { providerCost: true, branchMargin: true },
      _max: { createdAt: true },
    });
  }

  /** Every provider's id, code and name: the providers report names the provider each operation stored. */
  providerNames() {
    return this.uow.prisma.provider.findMany({ select: { id: true, code: true, name: true } });
  }
}
