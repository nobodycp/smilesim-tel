import { UnitOfWork } from '../../platform';
import { Injectable } from '@nestjs/common';

/**
 * The database as the picture routes read it: one picture column of one row, with what its version is made of.
 * No rule and no permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class PicturesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** A company's stored mark (a data URL), or null when the company has none or does not exist. */
  async companyImage(code: string): Promise<string | null> {
    const row = await this.uow.prisma.company.findUnique({ where: { code }, select: { image: true } });
    return row?.image ?? null;
  }

  /** An offer's stored picture and its `updatedAt` (its version), or null when the offer does not exist. */
  offerImage(id: string) {
    return this.uow.prisma.offer.findUnique({ where: { id }, select: { image: true, updatedAt: true } });
  }
}
