import { Injectable, OnModuleInit } from '@nestjs/common';
import { OfficeKernel } from '../kernel/office-kernel';
import { catalog, companies, packageCode, packageName } from '../office-catalog';
import { AGOROT, normalizeActionModes, packageFlagsFromModes } from '../office-rules';

/**
 * At boot, makes sure the shipped catalog (providers, companies, packages) and the four layer roles exist. Skipped
 * under tests and without a database. It used to run from OfficeService.onModuleInit.
 */
@Injectable()
export class CatalogSeed implements OnModuleInit {
  constructor(private readonly kernel: OfficeKernel) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) return;
    await this.ensureCatalog();
    await this.kernel.ensureLayerRoles();
  }

  async ensureCatalog(): Promise<void> {
    const users = await this.kernel.prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      await this.kernel.prisma.wallet.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, balance: 0, ceiling: 0 },
      });
    }
    // Migrations insert companies on their own, so only providers say the catalog was seeded.
    const seeded = await this.kernel.prisma.provider.count();
    if (seeded > 0) return;
    for (const company of companies) {
      await this.kernel.prisma.company.upsert({
        where: { code: company.code },
        update: { name: company.name },
        create: { code: company.code, name: company.name },
      });
    }
    for (const provider of catalog) {
      const savedProvider = await this.kernel.prisma.provider.upsert({
        where: { code: provider.code },
        update: { name: provider.name },
        create: { code: provider.code, name: provider.name },
      });
      // New packages copy provider defaults once; package rows stay independent after create.
      const flags = packageFlagsFromModes(normalizeActionModes(savedProvider.actionModes));
      for (const company of provider.companies) {
        const savedCompany = await this.kernel.prisma.company.findUnique({ where: { code: company.code } });
        if (!savedCompany) continue;
        for (const item of company.packages) {
          await this.kernel.prisma.package.upsert({
            where: { code: packageCode(provider.code, company.code, item) },
            update: {},
            create: {
              code: packageCode(provider.code, company.code, item),
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
