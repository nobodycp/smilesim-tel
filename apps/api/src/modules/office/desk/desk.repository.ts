import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork } from '../kernel/unit-of-work';
import { NEWEST_FIRST } from '../../shared/paging';

/**
 * The database as this domain reads and writes it: the counters and sums the home page shows. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class DeskRepository {
  constructor(private readonly uow: UnitOfWork) {}

  walletOf(userId: string) {
    return this.uow.prisma.wallet.findUnique({ where: { userId } });
  }

  taskCount(where: Prisma.OfficeTaskWhereInput) {
    return this.uow.prisma.officeTask.count({ where });
  }

  /** How many lines of these points of sale are stored with this status. */
  lineCountInStatus(posIds: string[], status: string) {
    return this.uow.prisma.line.count({ where: { posId: { in: posIds }, status } });
  }

  lineCount(where: Prisma.LineWhereInput) {
    return this.uow.prisma.line.count({ where });
  }

  /** The last eight line operations of these points of sale, with the account that paid. */
  latestOperations(posIds: string[]) {
    return this.uow.prisma.walletEntry.findMany({
      where: { userId: { in: posIds }, kind: { in: ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch'] } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: true },
    });
  }

  /** Writes the viewer's line counts for the day, over the ones already stored for it. */
  saveLineSnapshot(userId: string, day: string, lines: { active: number; expiring: number; frozen: number; disconnected: number; suspended: number }) {
    return this.uow.prisma.lineCountSnapshot.upsert({ where: { userId_day: { userId, day } }, update: lines, create: { userId, day, ...lines } });
  }

  /** The viewer's last snapshot before the day. */
  lineSnapshotBefore(userId: string, before: string) {
    return this.uow.prisma.lineCountSnapshot.findFirst({ where: { userId, day: { lt: before } }, orderBy: { day: 'desc' } });
  }

  /** Every distinct number of days after which a package's line is suspended. */
  suspendPeriods() {
    return this.uow.prisma.package.findMany({ distinct: ['suspendAfterDays'], select: { suspendAfterDays: true } });
  }

  /** Ledger entries with what the overview's cards and rankings read, newest first. */
  periodEntries(where: Prisma.WalletEntryWhereInput, take: number) {
    return this.uow.prisma.walletEntry.findMany({
      where,
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true, packageName: true, companyName: true, providerCost: true },
      orderBy: [...NEWEST_FIRST],
      take,
    });
  }

  /** Ledger entries with only what a period's totals need, in no set order. */
  entriesForTotals(where: Prisma.WalletEntryWhereInput, take: number) {
    return this.uow.prisma.walletEntry.findMany({
      where,
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true },
      take,
    });
  }

  /** The provider behind each of these lines. */
  providersOfLines(ids: string[]) {
    return this.uow.prisma.line.findMany({ where: { id: { in: ids } }, select: { id: true, package: { select: { provider: { select: { code: true, name: true } } } } } });
  }

  /** The balance and ceiling of each of these accounts. */
  walletsOf(userIds: string[]) {
    return this.uow.prisma.wallet.findMany({ where: { userId: { in: userIds } }, select: { userId: true, balance: true, ceiling: true } });
  }

  /** How many of the tasks under `where` are in this status. */
  taskCountInStatus(where: Prisma.OfficeTaskWhereInput, status: string) {
    return this.uow.prisma.officeTask.count({ where: { AND: [where, { status }] } });
  }

  /** When the oldest pending or working task under `where` was created. */
  oldestOpenTask(where: Prisma.OfficeTaskWhereInput) {
    return this.uow.prisma.officeTask.findFirst({ where: { AND: [where, { status: { in: ['pending', 'working'] } }] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  }
}
