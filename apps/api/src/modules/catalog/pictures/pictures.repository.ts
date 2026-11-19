import { UnitOfWork } from '../../platform';
import { Injectable } from '@nestjs/common';

/**
 * The database as the company mark route reads it: one picture column of one row. No rule and no permission lives
 * here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class PicturesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** A company's stored mark (a data URL), or null when the company has none or does not exist. */
  async companyImage(code: string): Promise<string | null> {
    const row = await this.uow.prisma.postpaidCompany.findUnique({ where: { code }, select: { image: true } });
    return row?.image ?? null;
  }
}
