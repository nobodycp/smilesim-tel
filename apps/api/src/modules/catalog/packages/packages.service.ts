import { PackagesRepository } from './packages.repository';
import { UnitOfWork, fail, parseInput } from '../../platform';
import { requireGrant } from '../../access';
import { Injectable } from '@nestjs/common';
import type { Actor } from '../../access';
import type { Prisma } from '../../../generated/prisma/client';
import { chainHolds, durationDays, esimPriceOf } from '../rules/package-prices';
import { ACTION_KEYS, normalizeActionModes, packageModeData, resolvePackageMode, type ActionMode } from '../rules/run-modes';
import { PackageAddonBody, PackageAddonUpdateBody, PackageChainBody, PackageDetailsBody, PackageModeBody, PackageTargetsBody } from './packages.schemas';
import type { Prices } from '../rules/package-prices';

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

/** The package catalog: for the branch the package sheet, the price chain, renewal and switch targets, and the operation modes. What an account may sell, at its prices, and its own sell prices are pricing's (`PackageShelfService`, slice R.8). */
export { PACKAGE_DETAILS_LIMIT } from './packages.schemas';

@Injectable()
export class PackagesService {
  constructor(private readonly uow: UnitOfWork, private readonly repo: PackagesRepository) {}

  async setMode(actor: Actor, code: string, body: unknown) {
    // Package modes apply to every account, so only the branch sets them, like the chain and the targets.
    requireGrant(actor, 'edit');
    const pkg = await this.repo.packageByCode(code);
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
        const provider = await this.repo.providerById(pkg.providerId);
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
    await this.repo.saveModes(code, data);
    return { ok: true as const };
  }

  async sheet(actor: Actor, code: string) {
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.repo.packageSheet(code);
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
      // The durations the package is sold and renewed for, each with its own prices (package plan D.2).
      durations: pkg.durations.map((row) => ({
        id: row.id,
        unit: row.unit,
        count: row.count,
        days: durationDays(row.unit, row.count),
        branchCost: row.branchCost,
        mainPrice: row.mainPrice,
        agentPrice: row.agentPrice,
        posPrice: row.posPrice,
        subscriberPrice: row.subscriberPrice,
        noDisconnect: row.noDisconnect,
        forSale: row.forSale,
        enabled: row.enabled,
      })),
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
    const pkg = await this.repo.packageByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    await this.repo.savePackage(pkg.id, {
      dataGb: input.dataGb,
      smsCount: input.smsCount,
      minutes: input.minutes,
      details: input.details || null,
      ...(input.suspendAfterDays === undefined ? {} : { suspendAfterDays: input.suspendAfterDays }),
      ...(input.esimAvailable === undefined ? {} : { esimAvailable: input.esimAvailable }),
    });
    return { ok: true as const };
  }

  /** A package's extra operations (spec 2026-11-09, 3), in their order. */
  async addons(actor: Actor, code: string) {
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.repo.packageWithAddons(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    return { addons: pkg.addons.map((row) => ({ id: row.id, name: row.name, price: row.price, active: row.active, position: row.position })) };
  }

  /** Adds an extra operation, or changes one when `id` is given: name, price (agorot) and on/off. */
  async saveAddon(actor: Actor, code: string, body: unknown, id?: string) {
    requireGrant(actor, 'edit');
    const pkg = await this.repo.packageByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    if (id) {
      const input = parseInput(PackageAddonUpdateBody, body);
      // Only what was sent changes.
      const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      const row = await this.repo.addonById(id);
      if (!row || row.packageId !== pkg.id) fail(404, 'NOT_FOUND');
      await this.repo.saveAddon(id, data);
    } else {
      // A new operation goes last; a position sent with it is checked and not used, as before.
      const { name, price, active } = parseInput(PackageAddonBody, body);
      const count = await this.repo.addonCount(pkg.id);
      await this.repo.addAddon({ packageId: pkg.id, name, price: price ?? 0, active: active !== false, position: count });
    }
    return this.addons(actor, code);
  }

  async removeAddon(actor: Actor, code: string, id: string) {
    requireGrant(actor, 'edit');
    const pkg = await this.repo.packageByCode(code);
    const row = await this.repo.addonById(id);
    if (!pkg || !row || row.packageId !== pkg.id) fail(404, 'NOT_FOUND');
    await this.repo.removeAddon(id);
    return this.addons(actor, code);
  }

  async setChain(actor: Actor, code: string, body: unknown) {
    requireGrant(actor, 'edit');
    const pkg = await this.repo.packageByCode(code);
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
    await this.repo.savePackage(pkg.id, {
      ...next,
      ...(esimPrice === undefined ? {} : { esimPrice }),
      renewalBranchCost: renewal.branchCost,
      renewalMainPrice: renewal.mainPrice,
      renewalAgentPrice: renewal.agentPrice,
      renewalPosPrice: renewal.posPrice,
      renewalSubscriberPrice: renewal.subscriberPrice,
      // The duration row that mirrors these columns moves with them, in the same statement (package plan D.2).
      durations: { updateMany: { where: { unit: 'month', count: Math.max(1, pkg.months) }, data: renewal } },
    });
    return { ok: true as const };
  }

  async setTargets(actor: Actor, code: string, kind: 'renewals' | 'switches', body: unknown) {
    requireGrant(actor, 'edit');
    const { targets: targetCodes } = parseInput(PackageTargetsBody, body);
    if (new Set(targetCodes).size !== targetCodes.length || targetCodes.includes(code)) fail(400, 'INVALID');
    const [pkg, targets] = await Promise.all([
      this.repo.packageWithCompany(code),
      targetCodes.length
        ? this.repo.packagesByCodes(targetCodes)
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
    await this.uow.runTx(async (tx) => {
      if (kind === 'renewals') {
        await this.repo.clearRenewalTargets(tx, pkg.id);
        if (targets.length) {
          await this.repo.addRenewalTargets(tx, targets.map((target) => ({ packageId: pkg.id, targetPackageId: target.id })));
        }
      } else {
        await this.repo.clearSwitchTargets(tx, pkg.id);
        if (targets.length) {
          await this.repo.addSwitchTargets(tx, targets.map((target) => ({ packageId: pkg.id, targetPackageId: target.id })));
        }
      }
    });
    return { ok: true as const };
  }
}
