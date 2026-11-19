import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork } from '../../platform';

/**
 * The database as adding to the catalog from a provider reads and writes it: the provider asked, and the companies
 * and packages made from what it answers. One method per query, named for what it returns or changes. No rule and
 * no permission lives here (backend-engineering.mdc 5.1). Slice F.7e: from `providers.repository.ts`, the same
 * queries.
 */
@Injectable()
export class ProviderCatalogRepository {
  constructor(private readonly uow: UnitOfWork) {}

  providerByCode(code: string) {
    return this.uow.prisma.provider.findUnique({ where: { code } });
  }

  /** Which of these company codes the office already has. */
  storedCompanyCodes(codes: string[]) {
    return this.uow.prisma.postpaidCompany.findMany({ where: { code: { in: codes } }, select: { code: true } });
  }

  /** The packages already made from these product codes of this provider. */
  packagesOfProducts(providerId: string, codes: string[]) {
    return this.uow.prisma.postpaidPackage.findMany({
      where: { providerId, providerProductCode: { in: codes } },
      select: { providerProductCode: true },
    });
  }

  companyByCode(code: string) {
    return this.uow.prisma.postpaidCompany.findUnique({ where: { code } });
  }

  addCompany(data: Prisma.PostpaidCompanyCreateInput) {
    return this.uow.prisma.postpaidCompany.create({
      data,
    });
  }

  /** A package already made from this product of this provider. */
  packageOfProduct(providerId: string, productCode: string) {
    return this.uow.prisma.postpaidPackage.findFirst({
      where: { providerId, providerProductCode: productCode },
      select: { id: true },
    });
  }

  addPackage(data: Prisma.PostpaidPackageUncheckedCreateInput) {
    return this.uow.prisma.postpaidPackage.create({
      data,
    });
  }
}
