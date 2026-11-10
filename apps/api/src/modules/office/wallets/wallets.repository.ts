import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork } from '../kernel/unit-of-work';
import { NEWEST_FIRST } from '../../shared/paging';

/**
 * The database as this domain reads and writes it: wallets and wallet entries as the finance pages read them. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class WalletsRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** The wallets of these accounts. */
  walletsOf(userIds: string[]) {
    return this.uow.prisma.wallet.findMany({ where: { userId: { in: userIds } } });
  }

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

  countEntries(where: Prisma.WalletEntryWhereInput) {
    return this.uow.prisma.walletEntry.count({ where });
  }

  /** Every entry the filter keeps, newest first, as the provider-operations report prices them. */
  operationEntries(where: Prisma.WalletEntryWhereInput) {
    return this.uow.prisma.walletEntry.findMany({ where, orderBy: [...NEWEST_FIRST] });
  }

  /** These numbers with their package, its provider and its company. */
  linesWithPackage(ids: string[]) {
    return this.uow.prisma.line.findMany({
      where: { id: { in: ids } },
      include: { package: { include: { provider: true, company: true } } },
    });
  }

  /** Every package with its provider and its company. */
  packagesWithProvider() {
    return this.uow.prisma.package.findMany({ include: { provider: true, company: true } });
  }

  providersByName() {
    return this.uow.prisma.provider.findMany({ orderBy: { name: 'asc' } });
  }

  /** The terms these numbers carry (the package code a sale without a kept ladder is priced from). */
  lineTerms(ids: string[]) {
    return this.uow.prisma.line.findMany({ where: { id: { in: ids } }, select: { id: true, terms: true } });
  }

  /** What the subscriber pays for the packages with these codes. */
  subscriberPrices(codes: string[]) {
    return this.uow.prisma.package.findMany({ where: { code: { in: codes } }, select: { code: true, subscriberPrice: true, renewalSubscriberPrice: true } });
  }

  /** The sales made on these numbers, newest first: the sale a refund without a kept ladder takes its share from. */
  salesOfLines(lineIds: string[], kinds: string[]) {
    return this.uow.prisma.walletEntry.findMany({
      where: { lineId: { in: lineIds }, kind: { in: kinds }, amount: { lt: 0 } },
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, ladder: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** The sales and refunds the profit report groups by package, newest first, at most `take`. */
  profitEntries(where: Prisma.WalletEntryWhereInput, take: number) {
    return this.uow.prisma.walletEntry.findMany({
      where,
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true, packageName: true, companyName: true },
      orderBy: [...NEWEST_FIRST],
      take,
    });
  }

  /** One account's money movements since a moment, oldest first: the finance page's chart. */
  movementsSince(userId: string, since: Date) {
    return this.uow.prisma.walletEntry.findMany({
      where: { userId, amount: { not: 0 }, createdAt: { gte: since } },
      select: { createdAt: true, amount: true, balanceAfter: true, kind: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** The sales and refunds the filter keeps, with what a margin is computed from. */
  soldEntries(where: Prisma.WalletEntryWhereInput) {
    return this.uow.prisma.walletEntry.findMany({
      where,
      select: { id: true, userId: true, kind: true, lineId: true, packagePrice: true, amount: true, ladder: true, createdAt: true },
    });
  }
}
