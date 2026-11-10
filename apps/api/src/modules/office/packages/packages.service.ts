import { requireGrant, seesLayer } from '../policy';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import type { Prisma } from '../../../generated/prisma/client';
import { parseInput } from '../../shared/input';
import { ACTION_KEYS, chainHolds, editableField, esimPriceOf, normalizeActionModes, packageModeData, resolvePackageMode, simRulesOf, type ActionMode } from '../office-rules';
import { buyPriceFor, deniedOpsFor, layerPrice, visibleTo } from '../user-terms';
import { PackageAddonBody, PackageAddonUpdateBody, PackageChainBody, PackageDetailsBody, PackageModeBody, PackageTargetsBody, SellPriceBody } from './packages.schemas';
import type { Prices } from '../office-rules';

// Which package flags a provider mode sets.
function pricesOf(row: Prices): Prices {
  return {
    branchCost: row.branchCost,
    mainPrice: row.mainPrice,
    agentPrice: row.agentPrice,
    posPrice: row.posPrice,
    subscriberPrice: row.subscriberPrice,
  };
}

/** The package catalog: what an account may sell with its prices, its own sell prices, and for the branch the package sheet, the price chain, renewal and switch targets, and the operation modes. */
export { PACKAGE_DETAILS_LIMIT } from './packages.schemas';

@Injectable()
export class PackagesService {
  constructor(private readonly kernel: OfficeKernel) {}

  async list(actor: Actor) {
    const field = editableField(actor.layer);
    const [all, accounts] = await Promise.all([
      this.kernel.prisma.package.findMany({
        where: { companyId: { not: null }, enabled: true, forSale: true },
        include: { provider: true, company: true },
        orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' }],
      }),
      this.kernel.accounts(),
    ]);
    const path = this.kernel.pathOf(actor.id, accounts);
    // Only the rows on the actor's path matter: its own terms and sell prices plus its ancestors'.
    const pathIds = path.map((node) => node.id);
    const [termRows, sellRows] = await Promise.all([
      this.kernel.prisma.userPackage.findMany({
        where: { userId: { in: pathIds } },
        select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
      }),
      this.kernel.prisma.sellPrice.findMany({
        where: { ownerId: { in: pathIds } },
        select: { packageId: true, ownerId: true, price: true, renewalPrice: true },
      }),
    ]);
    const canActivate = !deniedOpsFor(path).has('activate');
    const termsOf = (packageId: string) => termRows.filter((row) => row.packageId === packageId);
    const sellsOf = (packageId: string) => sellRows.filter((row) => row.packageId === packageId);
    const rows = all.filter((row) => visibleTo(path, termsOf(row.id), row));
    // The layer the actor sells to; null for the branch (no sell price) and the point of sale.
    const sellsTo = actor.layer === 'main_agent' ? 'agent' : actor.layer === 'agent' ? 'pos' : null;
    const ownSell = (packageId: string) => sellRows.find((row) => row.packageId === packageId && row.ownerId === actor.id) ?? null;
    const branch = actor.layer === 'branch';
    const images = new Map<string, string>();
    for (const row of rows) {
      const name = row.company?.name ?? '';
      if (name && row.company?.image) images.set(name, row.company.image);
    }
    return {
      companies: [...images].map(([name, image]) => ({ name, image })),
      packages: rows.map((row) => ({
        price: buyPriceFor(path, termsOf(row.id), sellsOf(row.id), row, 'subscription'),
        renewalPrice: buyPriceFor(path, termsOf(row.id), sellsOf(row.id), row, 'renewal'),
        canActivate,
        sellPrice: ownSell(row.id)?.price ?? null,
        sellRenewalPrice: ownSell(row.id)?.renewalPrice ?? null,
        sellDefault: sellsTo ? layerPrice(sellsTo, row, 'subscription') : null,
        sellRenewalDefault: sellsTo ? layerPrice(sellsTo, row, 'renewal') : null,
        code: row.code,
        name: row.name,
        providerCode: row.provider.code,
        providerName: actor.layer === 'branch' ? row.provider.name : '',
        activateMode: resolvePackageMode(row.actionModes, row, 'activate'),
        companyName: row.company?.name ?? '',
        sim: simRulesOf(row.company, row),
        esimPrice: esimPriceOf({ pkg: row, provider: row.provider, company: row.company }).price,
        dataGb: row.dataGb,
        smsCount: row.smsCount,
        minutes: row.minutes,
        details: row.details ?? '',
        months: row.months,
        // A layer sees its own column and the ones below it, never what the layers above pay (rule 3.4).
        branchCost: seesLayer(actor.layer, 'branch') ? row.branchCost : null,
        mainPrice: seesLayer(actor.layer, 'main_agent') ? row.mainPrice : null,
        agentPrice: seesLayer(actor.layer, 'agent') ? row.agentPrice : null,
        posPrice: row.posPrice,
        subscriberPrice: row.subscriberPrice,
        editableField: field,
        // How the provider runs each operation is the branch's business.
        autoActivate: branch ? row.autoActivate : null,
        autoCharge: branch ? row.autoCharge : null,
        autoDisconnect: branch ? row.autoDisconnect : null,
        autoFreeze: branch ? row.autoFreeze : null,
        autoSwitch: branch ? row.autoSwitch : null,
      })),
    };
  }

  /** A main agent's or agent's own sell price for a package. The floor is what the actor itself pays. */
  async setSellPrice(actor: Actor, code: string, body: unknown) {
    if (actor.layer !== 'main_agent' && actor.layer !== 'agent') fail(403, 'FORBIDDEN');
    const { price, renewalPrice } = parseInput(SellPriceBody, body);
    const pkg = await this.kernel.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const [accounts, { terms, sells }] = await Promise.all([this.kernel.accounts(), this.kernel.termsFor(pkg.id)]);
    const path = this.kernel.pathOf(actor.id, accounts);
    if (path.length === 0) fail(404, 'NOT_FOUND');
    if (price < buyPriceFor(path, terms, sells, pkg, 'subscription')) fail(400, 'PRICE_BELOW_FLOOR');
    if (renewalPrice !== null && renewalPrice < buyPriceFor(path, terms, sells, pkg, 'renewal')) fail(400, 'PRICE_BELOW_FLOOR');
    await this.kernel.prisma.sellPrice.upsert({
      where: { packageId_ownerId: { packageId: pkg.id, ownerId: actor.id } },
      update: { price, renewalPrice },
      create: { packageId: pkg.id, ownerId: actor.id, price, renewalPrice },
    });
    return { price, renewalPrice };
  }

  /** Drops the caller's own sell price so the layer column applies again; a missing row is already clear. */
  async clearSellPrice(actor: Actor, code: string) {
    if (actor.layer !== 'main_agent' && actor.layer !== 'agent') fail(403, 'FORBIDDEN');
    const pkg = await this.kernel.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    await this.kernel.prisma.sellPrice.deleteMany({ where: { packageId: pkg.id, ownerId: actor.id } });
    return { ok: true };
  }

  async setMode(actor: Actor, code: string, body: unknown) {
    // Package modes apply to every account, so only the branch sets them, like the chain and the targets.
    requireGrant(actor, 'edit');
    const pkg = await this.kernel.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const { action, mode, ...flags } = parseInput(PackageModeBody, body);
    const data: Record<string, boolean | Prisma.InputJsonValue> = {};
    for (const [key, value] of Object.entries(flags)) if (value !== undefined) data[key] = value;
    if (action && mode) {
      // `inherit` follows the provider again (spec 2026-11-09-admin-review, 3): its mode now, and every change it
      // makes later; a mode of its own stops following.
      const inherited = new Set(pkg.inheritedModes);
      let next: ActionMode;
      if (mode === 'inherit') {
        const provider = await this.kernel.prisma.provider.findUnique({ where: { id: pkg.providerId } });
        next = normalizeActionModes(provider?.actionModes)[action];
        inherited.add(action);
      } else {
        next = mode;
        inherited.delete(action);
      }
      Object.assign(data, packageModeData(pkg.actionModes, pkg, action, next));
      data.inheritedModes = [...inherited];
    }
    if (Object.keys(data).length === 0) fail(400, 'INVALID');
    await this.kernel.prisma.package.update({ where: { code }, data });
    return { ok: true as const };
  }

  async sheet(actor: Actor, code: string) {
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.kernel.prisma.package.findUnique({
      where: { code },
      include: {
        provider: true,
        company: true,
        lines: { select: { status: true } },
        renewals: { include: { target: { select: { code: true } } } },
        switches: { include: { target: { select: { code: true } } } },
      },
    });
    if (!pkg) fail(404, 'NOT_FOUND');
    return {
      code: pkg.code,
      name: pkg.name,
      providerCode: pkg.provider.code,
      providerName: pkg.provider.name,
      companyCode: pkg.company?.code ?? '',
      companyName: pkg.company?.name ?? '',
      enabled: pkg.enabled,
      forSale: pkg.forSale,
      dataGb: pkg.dataGb,
      suspendAfterDays: pkg.suspendAfterDays,
      esimAvailable: pkg.esimAvailable,
      smsCount: pkg.smsCount,
      minutes: pkg.minutes,
      details: pkg.details ?? '',
      months: pkg.months,
      branchCost: pkg.branchCost,
      mainPrice: pkg.mainPrice,
      agentPrice: pkg.agentPrice,
      posPrice: pkg.posPrice,
      subscriberPrice: pkg.subscriberPrice,
      renewalBranchCost: pkg.renewalBranchCost,
      renewalMainPrice: pkg.renewalMainPrice,
      renewalAgentPrice: pkg.renewalAgentPrice,
      renewalPosPrice: pkg.renewalPosPrice,
      renewalSubscriberPrice: pkg.renewalSubscriberPrice,
      esimPrice: pkg.esimPrice,
      esimPriceEffective: esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).price,
      esimPriceSource: esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).source,
      lines: pkg.lines.length,
      activeLines: pkg.lines.filter((line) => line.status === 'active').length,
      renewals: pkg.renewals.map((renewal) => renewal.target.code),
      switches: pkg.switches.map((item) => item.target.code),
      modes: Object.fromEntries(ACTION_KEYS.map((key) => [key, resolvePackageMode(pkg.actionModes, pkg, key)])),
      // Which of them follow the provider, and the provider's own (spec 2026-11-09-admin-review, 3).
      inheritedModes: (pkg.inheritedModes ?? []).filter((key) => (ACTION_KEYS as readonly string[]).includes(key)),
      providerModes: normalizeActionModes(pkg.provider.actionModes),
    };
  }

  /** GB, minutes, messages (null = not stated, -1 = unlimited) and up to 300 characters of extra details. */
  async setDetails(actor: Actor, code: string, body: unknown) {
    requireGrant(actor, 'edit');
    const input = parseInput(PackageDetailsBody, body);
    const pkg = await this.kernel.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    await this.kernel.prisma.package.update({
      where: { id: pkg.id },
      data: {
        dataGb: input.dataGb,
        smsCount: input.smsCount,
        minutes: input.minutes,
        details: input.details || null,
        ...(input.suspendAfterDays === undefined ? {} : { suspendAfterDays: input.suspendAfterDays }),
        ...(input.esimAvailable === undefined ? {} : { esimAvailable: input.esimAvailable }),
      },
    });
    return { ok: true as const };
  }

  /** A package's extra operations (spec 2026-11-09, 3), in their order. */
  async addons(actor: Actor, code: string) {
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.kernel.prisma.package.findUnique({ where: { code }, include: { addons: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } });
    if (!pkg) fail(404, 'NOT_FOUND');
    return { addons: pkg.addons.map((row) => ({ id: row.id, name: row.name, price: row.price, active: row.active, position: row.position })) };
  }

  /** Adds an extra operation, or changes one when `id` is given: name, price (agorot) and on/off. */
  async saveAddon(actor: Actor, code: string, body: unknown, id?: string) {
    requireGrant(actor, 'edit');
    const pkg = await this.kernel.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    if (id) {
      const input = parseInput(PackageAddonUpdateBody, body);
      // Only what was sent changes.
      const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const row = await this.kernel.prisma.packageAddon.findUnique({ where: { id } });
      if (!row || row.packageId !== pkg.id) fail(404, 'NOT_FOUND');
      await this.kernel.prisma.packageAddon.update({ where: { id }, data });
    } else {
      // A new operation goes last; a position sent with it is checked and not used, as before.
      const { name, price, active } = parseInput(PackageAddonBody, body);
      const count = await this.kernel.prisma.packageAddon.count({ where: { packageId: pkg.id } });
      await this.kernel.prisma.packageAddon.create({ data: { packageId: pkg.id, name, price: price ?? 0, active: active !== false, position: count } });
    }
    return this.addons(actor, code);
  }

  async removeAddon(actor: Actor, code: string, id: string) {
    requireGrant(actor, 'edit');
    const pkg = await this.kernel.prisma.package.findUnique({ where: { code } });
    const row = await this.kernel.prisma.packageAddon.findUnique({ where: { id } });
    if (!pkg || !row || row.packageId !== pkg.id) fail(404, 'NOT_FOUND');
    await this.kernel.prisma.packageAddon.delete({ where: { id } });
    return this.addons(actor, code);
  }

  async setChain(actor: Actor, code: string, body: unknown) {
    requireGrant(actor, 'edit');
    const pkg = await this.kernel.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const input = parseInput(PackageChainBody, body);
    const next = { ...pricesOf(pkg) };
    const renewal = {
      branchCost: pkg.renewalBranchCost,
      mainPrice: pkg.renewalMainPrice,
      agentPrice: pkg.renewalAgentPrice,
      posPrice: pkg.renewalPosPrice,
      subscriberPrice: pkg.renewalSubscriberPrice,
    };
    for (const key of ['branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice'] as const) {
      const price = input[key];
      if (price !== undefined) next[key] = price;
    }
    for (const [key, renewalKey] of [
      ['branchCost', 'renewalBranchCost'],
      ['mainPrice', 'renewalMainPrice'],
      ['agentPrice', 'renewalAgentPrice'],
      ['posPrice', 'renewalPosPrice'],
      ['subscriberPrice', 'renewalSubscriberPrice'],
    ] as const) {
      const price = input[renewalKey];
      if (price !== undefined) renewal[key] = price;
    }
    if (!chainHolds(next) || !chainHolds(renewal)) fail(400, 'PRICE_BELOW_FLOOR');
    const esimPrice = input.esimPrice;
    await this.kernel.prisma.package.update({
      where: { id: pkg.id },
      data: {
        ...next,
        ...(esimPrice === undefined ? {} : { esimPrice }),
        renewalBranchCost: renewal.branchCost,
        renewalMainPrice: renewal.mainPrice,
        renewalAgentPrice: renewal.agentPrice,
        renewalPosPrice: renewal.posPrice,
        renewalSubscriberPrice: renewal.subscriberPrice,
      },
    });
    return { ok: true as const };
  }

  async setTargets(actor: Actor, code: string, kind: 'renewals' | 'switches', body: unknown) {
    requireGrant(actor, 'edit');
    const { targets: targetCodes } = parseInput(PackageTargetsBody, body);
    if (new Set(targetCodes).size !== targetCodes.length || targetCodes.includes(code)) fail(400, 'INVALID');
    const [pkg, targets] = await Promise.all([
      this.kernel.prisma.package.findUnique({ where: { code }, include: { company: true, provider: true } }),
      targetCodes.length
        ? this.kernel.prisma.package.findMany({
            where: { code: { in: targetCodes } },
            include: { company: true, provider: true },
          })
        : [],
    ]);
    if (!pkg) fail(404, 'NOT_FOUND');
    if (
      !pkg.company ||
      !pkg.provider ||
      targets.length !== targetCodes.length ||
      targets.some(
        (target) =>
          !target.company ||
          !target.provider ||
          target.company.code !== pkg.company?.code ||
          target.provider.code !== pkg.provider.code,
      )
    ) fail(400, 'INVALID');
    await this.kernel.runTx(async (tx) => {
      if (kind === 'renewals') {
        await tx.packageRenewal.deleteMany({ where: { packageId: pkg.id } });
        if (targets.length) {
          await tx.packageRenewal.createMany({
            data: targets.map((target) => ({ packageId: pkg.id, targetPackageId: target.id })),
          });
        }
      } else {
        await tx.packageSwitch.deleteMany({ where: { packageId: pkg.id } });
        if (targets.length) {
          await tx.packageSwitch.createMany({
            data: targets.map((target) => ({ packageId: pkg.id, targetPackageId: target.id })),
          });
        }
      }
    });
    return { ok: true as const };
  }
}
