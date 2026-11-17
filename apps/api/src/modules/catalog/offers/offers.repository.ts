import { LIST_CAP, UnitOfWork, type Db } from '../../platform';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

/**
 * The database as this domain reads and writes it: offers. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
/** What a list of offers reads: every column but the picture (speed plan PF.7: a list carries the picture's URL). */
export const OFFER_LIST_COLUMNS = {
  id: true, title: true, body: true, actionLabel: true, actionHref: true, seconds: true, active: true, position: true,
  layers: true, startsAt: true, endsAt: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.OfferSelect;

@Injectable()
export class OffersRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** The offers switched on, in their order, without their pictures. */
  activeOffers() {
    return this.uow.prisma.offer.findMany({ where: { active: true }, select: OFFER_LIST_COLUMNS, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  /** Every offer, in its order, without its picture. */
  allOffers() {
    return this.uow.prisma.offer.findMany({ select: OFFER_LIST_COLUMNS, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], take: LIST_CAP + 1 });
  }

  /** The ids of the offers whose picture is set. The test reads no picture: a null or empty test, never its value. */
  async idsWithPicture(): Promise<Set<string>> {
    const rows = await this.uow.prisma.offer.findMany({ where: { AND: [{ image: { not: null } }, { image: { not: '' } }] }, select: { id: true } });
    return new Set(rows.map((row) => row.id));
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
