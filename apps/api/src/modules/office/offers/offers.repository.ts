import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork, type Db } from '../kernel/unit-of-work';

/**
 * The database as this domain reads and writes it: offers. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class OffersRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** The offers switched on, in their order. */
  activeOffers() {
    return this.uow.prisma.offer.findMany({ where: { active: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  /** Every offer, in its order. */
  allOffers() {
    return this.uow.prisma.offer.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  offerById(id: string) {
    return this.uow.prisma.offer.findUnique({ where: { id } });
  }

  offerCount() {
    return this.uow.prisma.offer.count();
  }

  addOffer(data: Prisma.OfferCreateArgs['data']) {
    return this.uow.prisma.offer.create({ data });
  }

  updateOffer(id: string, data: Prisma.OfferUpdateArgs['data']) {
    return this.uow.prisma.offer.update({ where: { id }, data });
  }

  removeOffer(id: string) {
    return this.uow.prisma.offer.delete({ where: { id } });
  }

  setPosition(db: Db, id: string, position: number) {
    return db.offer.update({ where: { id }, data: { position } });
  }
}
