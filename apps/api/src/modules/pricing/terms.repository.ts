import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { UnitOfWork, type Db, LIST_CAP } from '../platform';
import { RENEWABLE_STATUSES } from './rules/line-prices';
import { companyMarkUrls } from '../catalog';

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
    return this.uow.prisma.postpaidPackage.findMany({ where: { enabled: true, forSale: true }, include: { company: true }, orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }] });
  }

  /** Every package term written for these accounts, whole rows. */
  termsOf(userIds: string[]) {
    return this.uow.prisma.postpaidUserPackage.findMany({ where: { userId: { in: userIds } } });
  }

  /** Every sell price these accounts set, whole rows. */
  sellPricesOf(ownerIds: string[]) {
    return this.uow.prisma.postpaidSellPrice.findMany({ where: { ownerId: { in: ownerIds } } });
  }

  packageByCode(code: string) {
    return this.uow.prisma.postpaidPackage.findUnique({ where: { code } });
  }

  packagesOnSale() {
    return this.uow.prisma.postpaidPackage.findMany({ where: { enabled: true, forSale: true } });
  }

  /** What these accounts were told about packages: hidden or not, and the prices set for them. */
  termRowsOf(userIds: string[]) {
    return this.uow.prisma.postpaidUserPackage.findMany({ where: { userId: { in: userIds } }, select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true } });
  }

  /** The sell prices these accounts set for the layer below them. */
  sellRowsOf(ownerIds: string[]) {
    return this.uow.prisma.postpaidSellPrice.findMany({ where: { ownerId: { in: ownerIds } }, select: { packageId: true, ownerId: true, price: true, renewalPrice: true } });
  }

  /** Writes the operations an account may not run. */
  saveDeniedOps(id: string, deniedOps: string) {
    return this.uow.prisma.user.update({ where: { id }, data: { deniedOps } });
  }

  packageWithCompany(code: string) {
    return this.uow.prisma.postpaidPackage.findUnique({ where: { code }, include: { company: true, provider: true } });
  }

  /** How many numbers each point of sale holds on a package, by status, counted by the database. */
  lineCountsByPos(packageId: string) {
    return this.uow.prisma.postpaidLine.groupBy({ by: ['posId', 'status'], where: { packageId }, _count: { _all: true } });
  }

  /** The terms carried by the numbers a price table lists. */
  lineTermsIn(where: Prisma.PostpaidLineWhereInput) {
    return this.uow.prisma.postpaidLine.findMany({ where, select: { terms: true } });
  }

  packageIdByCode(code: string) {
    return this.uow.prisma.postpaidPackage.findUnique({ where: { code }, select: { id: true } });
  }

  /** The numbers a save may reprice, each with its package, company and provider. */
  linesToReprice(db: Db, where: Prisma.PostpaidLineWhereInput) {
    return db.postpaidLine.findMany({
      where,
      include: { package: { include: { company: true, provider: true } } },
    });
  }

  /** Drops an account's row on a package, so the defaults apply again. */
  removeTerm(packageId: string, userId: string, db: Db = this.uow.prisma) {
    return db.postpaidUserPackage.delete({ where: { packageId_userId: { packageId, userId } } });
  }

  /** Writes an account's row on a package, replacing the one it had. */
  saveTerm(packageId: string, userId: string, data: { hidden: boolean; price: number | null; renewalPrice: number | null; setById: string }, db: Db = this.uow.prisma) {
    return db.postpaidUserPackage.upsert({ where: { packageId_userId: { packageId, userId } }, update: data, create: { packageId, userId, ...data } });
  }

  /** How many numbers that can still renew each package has on these points of sale. */
  renewableLineCounts(posIds: string[]) {
    return this.uow.prisma.postpaidLine.groupBy({
      by: ['packageId'],
      where: { status: { in: [...RENEWABLE_STATUSES] }, posId: { in: posIds } },
      _count: { _all: true },
    });
  }

  /** The renewal targets these packages list today, each with its company and provider. */
  renewalTargetsOf(db: Db, packageIds: string[]) {
    return db.postpaidPackageRenewal.findMany({
      where: { packageId: { in: packageIds } },
      include: { target: { include: { company: true, provider: true } } },
    });
  }

  saveLineTerms(db: Db, id: string, terms: Prisma.InputJsonValue) {
    return db.postpaidLine.update({ where: { id }, data: { terms } });
  }

  /**
   * The shelf (slice R.8: from `PackagesRepository`): every package on sale under a company, with its provider and
   * company, in catalog order. The company without its picture (speed plan PF.7): the marks come from `markUrls`.
   */
  shelfPackages() {
    return this.uow.prisma.postpaidPackage.findMany({
      where: { companyId: { not: null }, enabled: true, forSale: true },
      include: { provider: true, company: { select: { code: true, name: true, iccidLength: true, iccidPrefix: true, esim: true, esimPrice: true } } },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' }],
      take: LIST_CAP + 1,
    });
  }

  /** The URL of every company mark that is set, by company code, without reading a picture (catalog `companyMarkUrls`). */
  markUrls() {
    return companyMarkUrls(this.uow.prisma);
  }

  /** Sets an account's own sell price for a package, replacing the one it had. */
  saveSellPrice(packageId: string, ownerId: string, price: number, renewalPrice: number | null) {
    return this.uow.prisma.postpaidSellPrice.upsert({
      where: { packageId_ownerId: { packageId, ownerId } },
      update: { price, renewalPrice },
      create: { packageId, ownerId, price, renewalPrice },
    });
  }

  /** Drops an account's own sell price for a package; none to drop is not an error. */
  clearSellPrice(packageId: string, ownerId: string) {
    return this.uow.prisma.postpaidSellPrice.deleteMany({ where: { packageId, ownerId } });
  }
}
