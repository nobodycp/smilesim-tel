import { UnitOfWork } from '../../platform';
import { Injectable } from '@nestjs/common';

/**
 * The database as the offer picture route reads it: one picture column of one row, with what its version is made
 * of. No rule and no permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class OfferPicturesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** An offer's stored picture and its `updatedAt` (its version), or null when the offer does not exist. */
  offerImage(id: string) {
    return this.uow.prisma.offer.findUnique({ where: { id }, select: { image: true, updatedAt: true } });
  }
}
