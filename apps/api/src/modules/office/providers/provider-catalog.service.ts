import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { nonNegative } from '../kernel/values';
import { ACTION_KEYS, chainHolds, flagsForMode, normalizeActionModes, SIM_LENGTH_MAX, SIM_LENGTH_MIN, type ActionKey, type ActionMode } from '../office-rules';
import { adapterFor } from './adapters/simulated-adapter';

const PRICE_KEYS = ['branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice'] as const;
type Ladder = Record<(typeof PRICE_KEYS)[number], number>;
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
  if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'FORBIDDEN');
  if (!actor.isBranchOwner && !actor.grants.includes('edit')) fail(403, 'FORBIDDEN');
}

function ladderOf(raw: unknown): Ladder {
  if (!raw || typeof raw !== 'object') fail(400, 'INVALID');
  const ladder = {} as Ladder;
  for (const key of PRICE_KEYS) {
    const price = nonNegative((raw as Record<string, unknown>)[key]);
    if (price === null) fail(400, 'INVALID');
    ladder[key] = price;
  }
  return ladder;
}

const amount = (value: unknown) => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= -1 && value <= 1_000_000);

/**
 * Adding to the catalog from the provider (spec 2026-11-09-admin-review, 3): query the provider's companies and
 * products (`adapters/`, simulated for now), then add a company or a package from what it answered. Branch owner or
 * staff with the edit grant.
 */
@Injectable()
export class ProviderCatalogService {
  constructor(private readonly kernel: OfficeKernel) {}

  private async provider(code: string) {
    const row = await this.kernel.prisma.provider.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    return row;
  }

  /** The provider's companies, each marked when the office already has it. */
  async companies(actor: Actor, code: string) {
    canEdit(actor);
    await this.provider(code);
    const adapter = adapterFor(code);
    const offered = await adapter.companies();
    const stored = await this.kernel.prisma.company.findMany({ where: { code: { in: offered.map((row) => row.code) } }, select: { code: true } });
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
    const stored = await this.kernel.prisma.package.findMany({
      where: { OR: [{ code: { in: offered.map((row) => row.code) } }, { providerId: provider.id, providerProductCode: { in: offered.map((row) => row.code) } }] },
      select: { code: true, providerProductCode: true },
    });
    const have = new Set(stored.flatMap((row) => [row.code, row.providerProductCode ?? '']));
    return { simulated: adapter.simulated, products: offered.map((row) => ({ ...row, added: have.has(row.code) })) };
  }

  /** A company the provider offers, with its SIM rules as the owner left them. */
  async createCompany(actor: Actor, body: Record<string, unknown>) {
    canEdit(actor);
    const providerCode = typeof body.providerCode === 'string' ? body.providerCode : '';
    const companyCode = typeof body.companyCode === 'string' ? body.companyCode : '';
    await this.provider(providerCode);
    const offered = (await adapterFor(providerCode).companies()).find((row) => row.code === companyCode);
    if (!offered) fail(404, 'PRODUCT_NOT_FOUND');
    if (await this.kernel.prisma.company.findUnique({ where: { code: companyCode } })) fail(409, 'COMPANY_EXISTS');
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : offered.name;
    const length = body.simLength === null || body.simLength === undefined ? null : Number(body.simLength);
    if (length !== null && !(Number.isInteger(length) && length >= SIM_LENGTH_MIN && length <= SIM_LENGTH_MAX)) fail(400, 'INVALID');
    const prefix = typeof body.simPrefix === 'string' ? body.simPrefix.trim() : '';
    if (prefix && !/^\d{1,10}$/.test(prefix)) fail(400, 'INVALID');
    const esimPrice = body.esimPrice === undefined ? offered.esimPrice : nonNegative(body.esimPrice);
    if (esimPrice === null) fail(400, 'INVALID');
    const company = await this.kernel.prisma.company.create({
      data: { code: companyCode, name, iccidLength: length, iccidPrefix: prefix || null, esim: body.esim === undefined ? offered.sim.esim : body.esim === true, esimPrice },
    });
    return { ok: true as const, code: company.code };
  }

  /**
   * A package from one of the provider's products: its facts, prices, extra operations and how each operation runs.
   * A mode left at «inherit» follows the provider (ADR 0009); the rest are the package's own.
   */
  async createPackage(actor: Actor, body: Record<string, unknown>) {
    canEdit(actor);
    const providerCode = typeof body.providerCode === 'string' ? body.providerCode : '';
    const companyCode = typeof body.companyCode === 'string' ? body.companyCode : '';
    const productCode = typeof body.productCode === 'string' ? body.productCode : '';
    const provider = await this.provider(providerCode);
    const company = await this.kernel.prisma.company.findUnique({ where: { code: companyCode } });
    if (!company) fail(404, 'NOT_FOUND');
    const product = (await adapterFor(providerCode).products(companyCode)).find((row) => row.code === productCode);
    if (!product) fail(404, 'PRODUCT_NOT_FOUND');
    const taken = await this.kernel.prisma.package.findFirst({
      where: { OR: [{ code: productCode }, { providerId: provider.id, providerProductCode: productCode }] },
      select: { id: true },
    });
    if (taken) fail(409, 'PACKAGE_EXISTS');

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : product.name;
    if (!amount(body.dataGb ?? product.dataGb) || !amount(body.smsCount ?? product.smsCount) || !amount(body.minutes ?? product.minutes)) fail(400, 'INVALID');
    const months = body.months === undefined ? product.months : Number(body.months);
    if (!Number.isInteger(months) || months < 1 || months > 36) fail(400, 'INVALID');
    const suspendAfterDays = body.suspendAfterDays === undefined ? 90 : Number(body.suspendAfterDays);
    if (!Number.isInteger(suspendAfterDays) || suspendAfterDays < 1 || suspendAfterDays > 3650) fail(400, 'INVALID');
    const details = typeof body.details === 'string' ? body.details.trim() : product.details;
    if (details.length > 300) fail(400, 'INVALID');
    const subscription = ladderOf(body.subscription);
    const renewal = ladderOf(body.renewal);
    if (!chainHolds(subscription) || !chainHolds(renewal)) fail(400, 'PRICE_BELOW_FLOOR');

    // Each action: «inherit» (the provider's mode now and later) or a mode of its own.
    const asked = (body.modes && typeof body.modes === 'object' ? body.modes : {}) as Record<string, unknown>;
    const providerModes = normalizeActionModes(provider.actionModes);
    const modes = {} as Record<ActionKey, ActionMode>;
    const inheritedModes: string[] = [];
    for (const key of ACTION_KEYS) {
      const value = asked[key] ?? 'inherit';
      if (value === 'inherit') {
        modes[key] = providerModes[key];
        inheritedModes.push(key);
      } else if (value === 'auto' || value === 'manual' || value === 'off') modes[key] = value;
      else fail(400, 'INVALID');
    }
    const columns: Record<string, boolean> = {};
    for (const [key, [auto, allow]] of Object.entries(MODE_COLUMNS) as [Exclude<ActionKey, 'companySwitch'>, [string, string]][]) {
      const flags = flagsForMode(modes[key]);
      columns[auto] = flags.auto;
      columns[allow] = flags.allow;
    }

    const addons = Array.isArray(body.addons) ? body.addons : [];
    if (addons.length > 20) fail(400, 'INVALID');
    const addonRows = addons.map((raw, position) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const addonName = typeof row.name === 'string' ? row.name.trim() : '';
      const price = nonNegative(row.price);
      if (!addonName || addonName.length > 80 || price === null) fail(400, 'INVALID');
      return { name: addonName, price, position };
    });

    const created = await this.kernel.prisma.package.create({
      data: {
        code: productCode,
        providerProductCode: productCode,
        name,
        providerId: provider.id,
        companyId: company.id,
        dataGb: (body.dataGb ?? product.dataGb) as number | null,
        smsCount: (body.smsCount ?? product.smsCount) as number | null,
        minutes: (body.minutes ?? product.minutes) as number | null,
        details: details || null,
        months,
        suspendAfterDays,
        esimAvailable: body.esimAvailable === undefined ? true : body.esimAvailable === true,
        forSale: body.forSale === undefined ? true : body.forSale === true,
        enabled: body.enabled === undefined ? true : body.enabled === true,
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
      },
    });
    return { ok: true as const, code: created.code, companyCode: company.code };
  }
}
