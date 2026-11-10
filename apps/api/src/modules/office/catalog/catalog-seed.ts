import { randomUUID } from 'node:crypto';
import { publicPackageCode } from '../rules/package-code';
import { LayerRoles } from '../roles/layer-roles';
import { UnitOfWork } from '../kernel/unit-of-work';
import { env, isTest } from '../../../config';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { catalog, companies, packageCode, packageName } from './office-catalog';
import { AGOROT } from '../rules/prices';
import { normalizeActionModes, packageFlagsFromModes } from '../rules/run-modes';

/**
 * At boot, makes sure the shipped catalog (providers, companies, packages) and the four layer roles exist. Skipped
 * under tests and without a database.
 */
@Injectable()
export class CatalogSeed implements OnModuleInit {
  constructor(private readonly uow: UnitOfWork, private readonly layerRoles: LayerRoles) {}

  async onModuleInit(): Promise<void> {
    if (isTest() || !env('DATABASE_URL')) return;
    await this.ensureCatalog();
    await this.layerRoles.ensureLayerRoles();
  }

  async ensureCatalog(): Promise<void> {
    const users = await this.uow.prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      await this.uow.prisma.wallet.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, balance: 0, ceiling: 0 },
      });
    }
    // Migrations insert companies on their own, so only providers say the catalog was seeded.
    const seeded = await this.uow.prisma.provider.count();
    if (seeded > 0) return;
    for (const company of companies) {
      await this.uow.prisma.company.upsert({
        where: { code: company.code },
        update: { name: company.name },
        create: { code: company.code, name: company.name },
      });
    }
    for (const provider of catalog) {
      const savedProvider = await this.uow.prisma.provider.upsert({
        where: { code: provider.code },
        update: { name: provider.name },
        create: { code: provider.code, name: provider.name },
      });
      // New packages copy provider defaults once; package rows stay independent after create.
      const flags = packageFlagsFromModes(normalizeActionModes(savedProvider.actionModes));
      for (const company of provider.companies) {
        const savedCompany = await this.uow.prisma.company.findUnique({ where: { code: company.code } });
        if (!savedCompany) continue;
        for (const item of company.packages) {
          // The catalog names a package by the provider's product code; its public code never names the provider.
          const productCode = packageCode(provider.code, company.code, item);
          const id = randomUUID();
          await this.uow.prisma.package.upsert({
            where: { providerId_providerProductCode: { providerId: savedProvider.id, providerProductCode: productCode } },
            update: {},
            create: {
              id,
              code: publicPackageCode({ companyCode: company.code, dataGb: item.gb, months: item.months, id }),
              providerProductCode: productCode,
              name: packageName(item),
              providerId: savedProvider.id,
              companyId: savedCompany.id,
              dataGb: item.gb,
              months: item.months,
              forSale: item.forSale,
              branchCost: item.subscription.branchCost * AGOROT,
              mainPrice: item.subscription.mainPrice * AGOROT,
              agentPrice: item.subscription.agentPrice * AGOROT,
              posPrice: item.subscription.posPrice * AGOROT,
              subscriberPrice: item.subscription.subscriberPrice * AGOROT,
              renewalBranchCost: item.renewal.branchCost * AGOROT,
              renewalMainPrice: item.renewal.mainPrice * AGOROT,
              renewalAgentPrice: item.renewal.agentPrice * AGOROT,
              renewalPosPrice: item.renewal.posPrice * AGOROT,
              renewalSubscriberPrice: item.renewal.subscriberPrice * AGOROT,
              ...flags,
              actionModes: normalizeActionModes(savedProvider.actionModes),
            },
          });
        }
      }
    }
  }
}
