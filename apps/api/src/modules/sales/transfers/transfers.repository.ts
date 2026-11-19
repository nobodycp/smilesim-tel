import { Injectable } from '@nestjs/common';
import { UnitOfWork, type Db } from '../../platform';
import { RENEWABLE_STATUSES, PRICE_COLUMNS } from '../../pricing';

/**
 * The database as this domain reads and writes it: what a move of an account or a number changes, and what its preview counts. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class TransfersRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Stamps the agent a point of sale's numbers were first sold under, on those that carry none yet. */
  rememberOriginAgent(db: Db, posId: string, originAgentId: string | null) {
    return db.postpaidLine.updateMany({ where: { posId, originAgentId: null }, data: { originAgentId } });
  }

  /** Puts an account under another parent. */
  moveAccount(db: Db, id: string, parentId: string) {
    return db.user.update({ where: { id }, data: { parentId } });
  }

  /** Drops what was written about one account's packages: hidden ones and prices of its own. */
  clearTermsOf(db: Db, userId: string) {
    return db.postpaidUserPackage.deleteMany({ where: { userId } });
  }

  /** Lifts every stopped operation from one account. */
  clearStopsOf(db: Db, id: string) {
    return db.user.update({ where: { id }, data: { deniedOps: '' } });
  }

  /** Drops the package terms of the accounts below a moved agent. */
  clearTermsOfAll(db: Db, userIds: string[]) {
    return db.postpaidUserPackage.deleteMany({ where: { userId: { in: userIds } } });
  }

  /** Drops the sell prices an account set for the layer below it. */
  clearSellPricesOf(db: Db, ownerId: string) {
    return db.postpaidSellPrice.deleteMany({ where: { ownerId } });
  }

  /** Lifts every stopped operation from the accounts below a moved agent. */
  clearStopsOfAll(db: Db, ids: string[]) {
    return db.user.updateMany({ where: { id: { in: ids } }, data: { deniedOps: '' } });
  }

  /** The numbers on these points of sale that can still renew, each with its package, company and provider. */
  renewableLinesOn(db: Db, posIds: string[]) {
    return db.postpaidLine.findMany({
      where: { posId: { in: posIds }, status: { in: [...RENEWABLE_STATUSES] } },
      include: { package: { include: { company: true, provider: true } } },
    });
  }

  /** What these accounts were told about packages: hidden or not, and the prices set for them. */
  termRowsOf(userIds: string[]) {
    return this.uow.prisma.postpaidUserPackage.findMany({
      where: { userId: { in: userIds } },
      select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
    });
  }

  /** The sell prices these accounts set for the layer below them. */
  sellRowsOf(ownerIds: string[]) {
    return this.uow.prisma.postpaidSellPrice.findMany({
      where: { ownerId: { in: ownerIds } },
      select: { packageId: true, ownerId: true, price: true, renewalPrice: true },
    });
  }

  /** Every package's layer prices. */
  packagePrices() {
    return this.uow.prisma.postpaidPackage.findMany({ select: { id: true, ...PRICE_COLUMNS } });
  }

  balancesOf(userIds: string[]) {
    return this.uow.prisma.wallet.findMany({ where: { userId: { in: userIds } }, select: { userId: true, balance: true } });
  }

  /** How many numbers on these points of sale can still renew. */
  renewableLineCount(posIds: string[]) {
    return this.uow.prisma.postpaidLine.count({ where: { posId: { in: posIds }, status: { in: [...RENEWABLE_STATUSES] } } });
  }

  /** Puts a number on another point of sale, and states whether its operations are locked there. */
  moveLine(db: Db, id: string, posId: string, opsLocked: boolean) {
    return db.postpaidLine.update({
      where: { id },
      data: { posId, opsLocked },
    });
  }
}
