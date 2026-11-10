import { LIST_CAP } from '../../shared/paging';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork } from '../kernel/unit-of-work';

/**
 * The database as this domain reads and writes it: companies and the packages on their shelf. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class CompaniesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Every package that belongs to a company, with its provider, its company and the status of each of its numbers. */
  shelfPackages() {
    return this.uow.prisma.package.findMany({
      where: { companyId: { not: null } },
      include: {
        provider: true,
        company: true,
        lines: { select: { status: true } },
      },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' }],
      take: LIST_CAP + 1,
    });
  }

  /** Every company with its image, its SIM rules and its eSIM price. */
  storedCompanies() {
    return this.uow.prisma.company.findMany({
      select: { code: true, name: true, image: true, iccidLength: true, iccidPrefix: true, esim: true, esimPrice: true },
    });
  }

  companyByCode(code: string) {
    return this.uow.prisma.company.findUnique({ where: { code } });
  }

  /** Stores a company's SIM rules, and its eSIM price when one is sent. */
  saveSimRules(id: string, data: Prisma.CompanyUpdateArgs['data']) {
    return this.uow.prisma.company.update({ where: { id }, data });
  }

  /** How many companies carry this name. */
  companiesNamed(name: string) {
    return this.uow.prisma.company.count({ where: { name } });
  }

  setImageByName(name: string, image: string | null) {
    return this.uow.prisma.company.updateMany({ where: { name }, data: { image } });
  }
}
