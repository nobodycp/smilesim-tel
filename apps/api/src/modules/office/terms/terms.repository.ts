import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork, type Db } from '../kernel/unit-of-work';
import { RENEWABLE_STATUSES } from '../rules/line-prices';

/**
 * The database as this domain reads and writes it: the terms an account sets for the accounts below it, and the renewal prices its lines carry. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class TermsRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Every package on sale with its company, ordered by company then name. */
  packagesOnSaleByCompany() {
    return this.uow.prisma.package.findMany({ where: { enabled: true, forSale: true }, include: { company: true }, orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }] });
  }

  /** Every package term written for these accounts, whole rows. */
  termsOf(userIds: string[]) {
    return this.uow.prisma.userPackage.findMany({ where: { userId: { in: userIds } } });
  }

  /** Every sell price these accounts set, whole rows. */
  sellPricesOf(ownerIds: string[]) {
    return this.uow.prisma.sellPrice.findMany({ where: { ownerId: { in: ownerIds } } });
  }

  packageByCode(code: string) {
    return this.uow.prisma.package.findUnique({ where: { code } });
  }

  packagesOnSale() {
    return this.uow.prisma.package.findMany({ where: { enabled: true, forSale: true } });
  }

  /** What these accounts were told about packages: hidden or not, and the prices set for them. */
  termRowsOf(userIds: string[]) {
    return this.uow.prisma.userPackage.findMany({ where: { userId: { in: userIds } }, select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true } });
  }

  /** The sell prices these accounts set for the layer below them. */
  sellRowsOf(ownerIds: string[]) {
    return this.uow.prisma.sellPrice.findMany({ where: { ownerId: { in: ownerIds } }, select: { packageId: true, ownerId: true, price: true, renewalPrice: true } });
  }

  /** Writes the operations an account may not run. */
  saveDeniedOps(id: string, deniedOps: string) {
    return this.uow.prisma.user.update({ where: { id }, data: { deniedOps } });
  }

  packageWithCompany(code: string) {
    return this.uow.prisma.package.findUnique({ where: { code }, include: { company: true, provider: true } });
  }

  /** The terms carried by the numbers a price table lists. */
  lineTermsIn(where: Prisma.LineWhereInput) {
    return this.uow.prisma.line.findMany({ where, select: { terms: true } });
  }

  packageIdByCode(code: string) {
    return this.uow.prisma.package.findUnique({ where: { code }, select: { id: true } });
  }

  /** The numbers a save may reprice, each with its package, company and provider. */
  linesToReprice(db: Db, where: Prisma.LineWhereInput) {
    return db.line.findMany({
      where,
      include: { package: { include: { company: true, provider: true } } },
    });
  }

  /** Drops an account's row on a package, so the defaults apply again. */
  removeTerm(packageId: string, userId: string, db: Db = this.uow.prisma) {
    return db.userPackage.delete({ where: { packageId_userId: { packageId, userId } } });
  }

  /** Writes an account's row on a package, replacing the one it had. */
  saveTerm(packageId: string, userId: string, data: { hidden: boolean; price: number | null; renewalPrice: number | null; setById: string }, db: Db = this.uow.prisma) {
    return db.userPackage.upsert({ where: { packageId_userId: { packageId, userId } }, update: data, create: { packageId, userId, ...data } });
  }

  /** How many numbers that can still renew each package has on these points of sale. */
  renewableLineCounts(posIds: string[]) {
    return this.uow.prisma.line.groupBy({
      by: ['packageId'],
      where: { status: { in: [...RENEWABLE_STATUSES] }, posId: { in: posIds } },
      _count: { _all: true },
    });
  }

  /** The renewal targets these packages list today, each with its company and provider. */
  renewalTargetsOf(db: Db, packageIds: string[]) {
    return db.packageRenewal.findMany({
      where: { packageId: { in: packageIds } },
      include: { target: { include: { company: true, provider: true } } },
    });
  }

  saveLineTerms(db: Db, id: string, terms: Prisma.InputJsonValue) {
    return db.line.update({ where: { id }, data: { terms } });
  }
}
