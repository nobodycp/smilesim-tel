import { LIST_CAP, UnitOfWork } from '../../../platform';
import { companyMarkUrls } from './company-marks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';

/**
 * The database as this domain reads and writes it: companies and the packages on their shelf. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class CompaniesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Every package that belongs to a company, with its provider, its company's code and the status of each of its numbers. */
  shelfPackages() {
    return this.uow.prisma.postpaidPackage.findMany({
      where: { companyId: { not: null } },
      include: {
        provider: true,
        company: { select: { code: true } },
        lines: { select: { status: true } },
      },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' }],
      take: LIST_CAP + 1,
    });
  }

  /** Every company with its SIM rules and its eSIM price; not its picture (speed plan PF.7: `markUrls`). */
  storedCompanies() {
    return this.uow.prisma.postpaidCompany.findMany({
      select: { code: true, name: true, iccidLength: true, iccidPrefix: true, esim: true, esimPrice: true },
    });
  }

  /** The URL of every company mark that is set, by code, without reading a picture (`company-marks.ts`). */
  markUrls() {
    return companyMarkUrls(this.uow.prisma);
  }

  companyByCode(code: string) {
    return this.uow.prisma.postpaidCompany.findUnique({ where: { code } });
  }

  /** Stores a company's SIM rules, and its eSIM price when one is sent. */
  saveSimRules(id: string, data: Prisma.PostpaidCompanyUpdateArgs['data']) {
    return this.uow.prisma.postpaidCompany.update({ where: { id }, data });
  }

  /** Stores or clears a company's mark. */
  setImage(id: string, image: string | null) {
    return this.uow.prisma.postpaidCompany.update({ where: { id }, data: { image } });
  }
}
