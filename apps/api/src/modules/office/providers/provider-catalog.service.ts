import { ProvidersRepository } from './providers.repository';
import { UnitOfWork } from '../kernel/unit-of-work';
import { refuseEntered, requireGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { parseInput } from '../../shared/input';
import { ACTION_KEYS, chainHolds, flagsForMode, normalizeActionModes, type ActionKey, type ActionMode } from '../rules/office-rules';
import { adapterFor } from './adapters/simulated-adapter';
import { CompanyCreateBody, PackageCreateBody } from './providers.schemas';

const MODE_COLUMNS: Record<Exclude<ActionKey, 'companySwitch'>, [string, string]> = {
  activate: ['autoActivate', 'allowActivate'],
  charge: ['autoCharge', 'allowCharge'],
  extend: ['autoExtend', 'allowExtend'],
  disconnect: ['autoDisconnect', 'allowDisconnect'],
  freeze: ['autoFreeze', 'allowFreeze'],
  switch: ['autoSwitch', 'allowSwitch'],
  rename: ['autoRename', 'allowRename'],
  sim: ['autoSim', 'allowSim'],
};

function canEdit(actor: Actor) {
  refuseEntered(actor);
  requireGrant(actor, 'edit');
}

/**
 * Adding to the catalog from the provider (spec 2026-11-09-admin-review, 3): query the provider's companies and
 * products (`adapters/`, simulated for now), then add a company or a package from what it answered. Branch owner or
 * staff with the edit grant.
 */
@Injectable()
export class ProviderCatalogService {
  constructor(readonly uow: UnitOfWork, private readonly repo: ProvidersRepository) {}

  private async provider(code: string) {
    const row = await this.repo.providerByCode(code);
    if (!row) fail(404, 'NOT_FOUND');
    return row;
  }

  /** The provider's companies, each marked when the office already has it. */
  async companies(actor: Actor, code: string) {
    canEdit(actor);
    await this.provider(code);
    const adapter = adapterFor(code);
    const offered = await adapter.companies();
    const stored = await this.repo.storedCompanyCodes(offered.map((row) => row.code));
    const have = new Set(stored.map((row) => row.code));
    return { simulated: adapter.simulated, companies: offered.map((row) => ({ ...row, added: have.has(row.code) })) };
  }

  /** The provider's products for one company, each marked when a package was already added from it. */
  async products(actor: Actor, code: string, companyCode: string) {
    canEdit(actor);
    const provider = await this.provider(code);
    if (!companyCode) fail(400, 'INVALID');
    const adapter = adapterFor(code);
    const offered = await adapter.products(companyCode);
    const stored = await this.repo.packagesOfProducts(provider.id, offered.map((row) => row.code));
    const have = new Set(stored.flatMap((row) => [row.code, row.providerProductCode ?? '']));
    return { simulated: adapter.simulated, products: offered.map((row) => ({ ...row, added: have.has(row.code) })) };
  }

  /** A company the provider offers, with its SIM rules as the owner left them. */
  async createCompany(actor: Actor, body: unknown) {
    canEdit(actor);
    const input = parseInput(CompanyCreateBody, body);
    const { providerCode, companyCode } = input;
    await this.provider(providerCode);
    const offered = (await adapterFor(providerCode).companies()).find((row) => row.code === companyCode);
    if (!offered) fail(404, 'PRODUCT_NOT_FOUND');
    if (await this.repo.companyByCode(companyCode)) fail(409, 'COMPANY_EXISTS');
    const company = await this.repo.addCompany({
      code: companyCode,
      name: input.name || offered.name,
      iccidLength: input.simLength ?? null,
      iccidPrefix: input.simPrefix || null,
      esim: input.esim ?? offered.sim.esim,
      esimPrice: input.esimPrice ?? offered.esimPrice,
    });
    return { ok: true as const, code: company.code };
  }

  /**
   * A package from one of the provider's products: its facts, prices, extra operations and how each operation runs.
   * A mode left at «inherit» follows the provider (ADR 0009); the rest are the package's own.
   */
  async createPackage(actor: Actor, body: unknown) {
    canEdit(actor);
    const input = parseInput(PackageCreateBody, body);
    const { providerCode, companyCode, productCode, subscription, renewal } = input;
    const provider = await this.provider(providerCode);
    const company = await this.repo.companyByCode(companyCode);
    if (!company) fail(404, 'NOT_FOUND');
    const product = (await adapterFor(providerCode).products(companyCode)).find((row) => row.code === productCode);
    if (!product) fail(404, 'PRODUCT_NOT_FOUND');
    const taken = await this.repo.packageOfProduct(provider.id, productCode);
    if (taken) fail(409, 'PACKAGE_EXISTS');

    const details = input.details ?? product.details;
    if (details.length > 300) fail(400, 'INVALID');
    if (!chainHolds(subscription) || !chainHolds(renewal)) fail(400, 'PRICE_BELOW_FLOOR');

    // Each action: «inherit» (the provider's mode now and later) or a mode of its own.
    const asked = input.modes ?? {};
    const providerModes = normalizeActionModes(provider.actionModes);
    const modes = {} as Record<ActionKey, ActionMode>;
    const inheritedModes: string[] = [];
    for (const key of ACTION_KEYS) {
      const value = asked[key] ?? 'inherit';
      if (value === 'inherit') {
        modes[key] = providerModes[key];
        inheritedModes.push(key);
      } else modes[key] = value;
    }
    const columns: Record<string, boolean> = {};
    for (const [key, [auto, allow]] of Object.entries(MODE_COLUMNS) as [Exclude<ActionKey, 'companySwitch'>, [string, string]][]) {
      const flags = flagsForMode(modes[key]);
      columns[auto] = flags.auto;
      columns[allow] = flags.allow;
    }

    const addonRows = (input.addons ?? []).map((row, position) => ({ ...row, position }));

    const created = await this.repo.addPackage({
      code: productCode,
      providerProductCode: productCode,
      name: input.name || product.name,
      providerId: provider.id,
      companyId: company.id,
      dataGb: input.dataGb ?? product.dataGb,
      smsCount: input.smsCount ?? product.smsCount,
      minutes: input.minutes ?? product.minutes,
      details: details || null,
      months: input.months ?? product.months,
      suspendAfterDays: input.suspendAfterDays ?? 90,
      esimAvailable: input.esimAvailable ?? true,
      forSale: input.forSale ?? true,
      enabled: input.enabled ?? true,
      ...subscription,
      renewalBranchCost: renewal.branchCost,
      renewalMainPrice: renewal.mainPrice,
      renewalAgentPrice: renewal.agentPrice,
      renewalPosPrice: renewal.posPrice,
      renewalSubscriberPrice: renewal.subscriberPrice,
      ...(columns as Record<string, boolean> & { autoActivate: boolean; autoCharge: boolean; autoDisconnect: boolean; autoFreeze: boolean; autoSwitch: boolean }),
      actionModes: modes,
      inheritedModes,
      addons: addonRows.length ? { create: addonRows } : undefined,
    });
    return { ok: true as const, code: created.code, companyCode: company.code };
  }
}
