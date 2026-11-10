import { requireGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { parseInput } from '../../shared/input';
import type { Prisma } from '../../../generated/prisma/client';
import { normalizeActionModes, packageModeData } from '../office-rules';
import { ProviderEsimPriceBody, ProviderModeBody } from './providers.schemas';

/** Providers, for the branch: the list with each provider's companies and packages, the per-provider action modes, and the provider eSIM price. */
@Injectable()
export class ProvidersService {
  constructor(private readonly kernel: OfficeKernel) {}

  async list(actor: Actor) {
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const rows = await this.kernel.prisma.provider.findMany({
      where: { packages: { some: { companyId: { not: null } } } },
      include: { packages: { include: { company: true }, orderBy: { code: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return {
      providers: rows.map((row) => {
        const byCompany = new Map<string, { name: string; image: string; packages: Array<{
          code: string;
          name: string;
          dataGb: number | null;
          months: number;
          price: number;
          enabled: boolean;
          autoActivate: boolean;
          autoCharge: boolean;
          autoDisconnect: boolean;
          autoFreeze: boolean;
          autoSwitch: boolean;
          autoExtend: boolean;
          autoRename: boolean;
          autoSim: boolean;
          allowDisconnect: boolean;
        }> }>();
        for (const item of row.packages) {
          if (!item.company) continue;
          const company = byCompany.get(item.company.id) ?? {
            name: item.company.name,
            image: item.company.image ?? '',
            packages: [],
          };
          company.packages.push({
            code: item.code,
            name: item.name,
            dataGb: item.dataGb,
            months: item.months,
            price: item.branchCost,
            enabled: item.enabled,
            autoActivate: item.autoActivate,
            autoCharge: item.autoCharge,
            autoDisconnect: item.autoDisconnect,
            autoFreeze: item.autoFreeze,
            autoSwitch: item.autoSwitch,
            autoExtend: item.autoExtend,
            autoRename: item.autoRename,
            autoSim: item.autoSim,
            allowDisconnect: item.allowDisconnect,
          });
          byCompany.set(item.company.id, company);
        }
        return {
          code: row.code,
          name: row.name,
          companies: [...byCompany.values()].sort((left, right) => left.name.localeCompare(right.name, 'ar')),
        };
      }),
    };
  }

  async settings(actor: Actor, code: string) {
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const row = await this.kernel.prisma.provider.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    return {
      code: row.code,
      name: row.name,
      modes: normalizeActionModes(row.actionModes),
      esimPrice: row.esimPrice,
    };
  }

  async setEsimPrice(actor: Actor, code: string, body: unknown) {
    requireGrant(actor, 'edit');
    const row = await this.kernel.prisma.provider.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    const { price } = parseInput(ProviderEsimPriceBody, body);
    await this.kernel.prisma.provider.update({ where: { code }, data: { esimPrice: price } });
    return { ok: true as const, esimPrice: price };
  }

  async setMode(actor: Actor, code: string, body: unknown) {
    requireGrant(actor, 'edit');
    const row = await this.kernel.prisma.provider.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    const { action, mode } = parseInput(ProviderModeBody, body);
    const modes = normalizeActionModes(row.actionModes);
    modes[action] = mode;
    // The packages that inherit this action follow at once (spec 2026-11-09-admin-review, 3); those with a mode of
    // their own keep it.
    const following = await this.kernel.prisma.package.findMany({ where: { providerId: row.id, inheritedModes: { has: action } } });
    await this.kernel.prisma.$transaction([
      this.kernel.prisma.provider.update({ where: { code }, data: { actionModes: modes } }),
      ...following.map((pkg) => this.kernel.prisma.package.update({
        where: { id: pkg.id },
        data: packageModeData(pkg.actionModes, pkg, action, mode) as Prisma.PackageUpdateInput,
      })),
    ]);
    return { ok: true as const };
  }
}
