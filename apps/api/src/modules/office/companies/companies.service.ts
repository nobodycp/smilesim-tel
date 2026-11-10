import { requireGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { parseInput } from '../../shared/input';
import { companies } from '../office-catalog';
import { ESIM_PRICE_DEFAULT, readSimRules, simRulesOf } from '../office-rules';
import { COMPANY_IMAGE_BYTES, CompanyImageBody, CompanySimBody } from './companies.schemas';

/** Companies: the shelf of companies, providers and packages an account sees, the company SIM rules and eSIM price, and the company image. */
@Injectable()
export class CompaniesService {
  constructor(private readonly kernel: OfficeKernel) {}

  async shelf(actor: Actor) {
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const rows = await this.kernel.prisma.package.findMany({
      where: { companyId: { not: null } },
      include: {
        provider: true,
        company: true,
        lines: { select: { status: true } },
      },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' }],
    });
    const byCompany = new Map<string, Map<string, {
      code: string;
      name: string;
      packages: Array<{
        code: string;
        name: string;
        months: number;
        dataGb: number | null;
        smsCount: number | null;
        minutes: number | null;
        branchCost: number;
        mainPrice: number;
        renewalBranchCost: number;
        renewalMainPrice: number;
        forSale: boolean;
        enabled: boolean;
        lines: number;
        activeLines: number;
        stoppedLines: number;
      }>;
    }>>();
    for (const row of rows) {
      if (!row.company) continue;
      const providers = byCompany.get(row.company.code) ?? new Map();
      const provider = providers.get(row.provider.code) ?? {
        code: row.provider.code,
        name: row.provider.name,
        packages: [],
      };
      const activeLines = row.lines.filter((line) => line.status === 'active').length;
      provider.packages.push({
        code: row.code,
        name: row.name,
        months: row.months,
        dataGb: row.dataGb,
        smsCount: row.smsCount,
        minutes: row.minutes,
        branchCost: row.branchCost,
        mainPrice: row.mainPrice,
        renewalBranchCost: row.renewalBranchCost,
        renewalMainPrice: row.renewalMainPrice,
        forSale: row.forSale,
        enabled: row.enabled,
        lines: row.lines.length,
        activeLines,
        stoppedLines: row.lines.length - activeLines,
      });
      providers.set(row.provider.code, provider);
      byCompany.set(row.company.code, providers);
    }
    const stored = await this.kernel.prisma.company.findMany({
      select: { code: true, name: true, image: true, iccidLength: true, iccidPrefix: true, esim: true, esimPrice: true },
    });
    const byCode = new Map(stored.map((row) => [row.code, row]));
    // The seeded companies in their order, then the ones added since (spec 2026-11-09-admin-review, 3), by name.
    const seeded = new Set<string>(companies.map((company) => company.code));
    const added = stored
      .filter((row) => !seeded.has(row.code))
      .map((row) => ({ code: row.code, name: row.name ?? row.code }))
      .sort((left, right) => left.name.localeCompare(right.name, 'ar'));
    return {
      companies: [...companies, ...added].map((company) => ({
        code: company.code,
        name: company.name,
        image: byCode.get(company.code)?.image ?? '',
        sim: simRulesOf(byCode.get(company.code) ?? null),
        esimPrice: byCode.get(company.code)?.esimPrice ?? ESIM_PRICE_DEFAULT,
        providers: [...(byCompany.get(company.code)?.values() ?? [])],
      })),
    };
  }

  async setSim(actor: Actor, code: string, body: unknown) {
    requireGrant(actor, 'edit');
    const { esimPrice, ...sim } = parseInput(CompanySimBody, body);
    // The prefix must be shorter than the length: a rule across two fields, kept where the other readers use it.
    const rules = readSimRules(sim);
    if (!rules) fail(400, 'INVALID');
    const row = await this.kernel.prisma.company.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    const saved = await this.kernel.prisma.company.update({
      where: { id: row.id },
      data: { iccidLength: rules.length, iccidPrefix: rules.prefix || null, esim: rules.esim, ...(esimPrice === undefined ? {} : { esimPrice }) },
    });
    return { ok: true, sim: rules, esimPrice: saved.esimPrice };
  }

  async setImage(actor: Actor, body: unknown) {
    if (actor.impersonating) fail(403, 'FORBIDDEN');
    requireGrant(actor, 'edit');
    const { name, image: sent } = parseInput(CompanyImageBody, body);
    const found = await this.kernel.prisma.company.count({ where: { name } });
    if (!found) fail(404, 'NOT_FOUND');
    let image: string | null = null;
    if (sent) {
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(sent);
      if (!match) fail(400, 'INVALID');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length < 32 || bytes.length > COMPANY_IMAGE_BYTES) fail(400, 'INVALID');
      image = `data:image/${match[1]};base64,${match[2]}`;
    }
    await this.kernel.prisma.company.updateMany({ where: { name }, data: { image } });
    return { ok: true };
  }
}
