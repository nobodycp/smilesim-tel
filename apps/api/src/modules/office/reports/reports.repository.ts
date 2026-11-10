import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork } from '../kernel/unit-of-work';
import { NEWEST_FIRST } from '../../shared/paging';

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

  entryCount(where: Prisma.WalletEntryWhereInput) {
    return this.uow.prisma.walletEntry.count({ where });
  }

  walletsOf(userIds: string[]) {
    return this.uow.prisma.wallet.findMany({ where: { userId: { in: userIds } } });
  }

  /** When each of these accounts last had a ledger entry. */
  lastMovementOf(userIds: string[]) {
    return this.uow.prisma.walletEntry.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { createdAt: true } });
  }

  /** The provider operations of these kinds over the dates, newest first, with what their cost and profit need. */
  providerOperations(kinds: string[], createdAt: Prisma.DateTimeFilter | undefined, take: number) {
    return this.uow.prisma.walletEntry.findMany({
      where: { kind: { in: kinds }, ...(createdAt ? { createdAt } : {}) },
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true, providerCost: true },
      orderBy: [...NEWEST_FIRST],
      take,
    });
  }

  /** The provider behind each of these lines. */
  providersOfLines(ids: string[]) {
    return this.uow.prisma.line.findMany({
      where: { id: { in: ids } },
      select: { id: true, package: { select: { provider: { select: { code: true, name: true } } } } },
    });
  }
}
