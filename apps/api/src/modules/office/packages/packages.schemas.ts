import { z } from 'zod';
import { agorot, optionalAgorot, text } from '../../shared/schemas';
import { ACTION_KEYS } from '../rules/office-rules';

// The bodies of the package routes (backend-engineering.mdc 4.1). The service parses them with `parseInput`
// after its permission checks; the controller documents each route from the same schema.

/** The longest extra text a package carries. */
export const PACKAGE_DETAILS_LIMIT = 300;

/**
 * The highest price of a package's extra operation, in agorot. Lower than the 100,000,000 every other price
 * accepts (`MAX_AGOROT`); kept as it was when the route was written, named here so the difference is visible.
 */
export const ADDON_PRICE_MAX = 10_000_000;

/** A place in a list as the database stores it (a 32-bit whole number). */
const position = z.number().int().min(-2_147_483_648).max(2_147_483_647);

/** GB, minutes or messages: null is "not stated", -1 is "unlimited". */
const fact = z.number().int().min(-1).max(1_000_000).nullable();

/** PUT sell-prices/:code — the caller's own sell price; a renewal price left out or null is cleared. */
export const SellPriceBody = z.object({ price: agorot, renewalPrice: optionalAgorot });
export type SellPriceBody = z.input<typeof SellPriceBody>;

const flag = z.boolean().optional();

/** PATCH packages/:code/mode — any of the run flags, or one action with its mode (`inherit` follows the provider). */
export const PackageModeBody = z.object({
  autoActivate: flag,
  autoCharge: flag,
  autoDisconnect: flag,
  autoFreeze: flag,
  autoSwitch: flag,
  autoExtend: flag,
  autoRename: flag,
  autoSim: flag,
  allowActivate: flag,
  allowCharge: flag,
  allowDisconnect: flag,
  allowFreeze: flag,
  allowSwitch: flag,
  allowExtend: flag,
  allowRename: flag,
  allowSim: flag,
  enabled: flag,
  action: z.enum(ACTION_KEYS).optional(),
  mode: z.enum(['auto', 'manual', 'off', 'inherit']).optional(),
});
export type PackageModeBody = z.input<typeof PackageModeBody>;

/** PATCH packages/:code/details — the package facts and its extra text. */
export const PackageDetailsBody = z.object({
  dataGb: fact,
  smsCount: fact,
  minutes: fact,
  details: text(PACKAGE_DETAILS_LIMIT),
  // Days after the end before a line counts as suspended (spec 2026-11-08-overview-and-reports-nav, I).
  suspendAfterDays: z.number().int().min(1).max(3650).optional(),
  esimAvailable: z.boolean().optional(),
});
export type PackageDetailsBody = z.input<typeof PackageDetailsBody>;

const addonName = z.string().trim().min(1).max(60);
const addonPrice = z.number().int().min(0).max(ADDON_PRICE_MAX);

/** PATCH packages/:code/addons/:id — any of the name, the price, on/off and the place in the list. */
export const PackageAddonUpdateBody = z.object({
  name: addonName.optional(),
  price: addonPrice.optional(),
  active: z.boolean().optional(),
  position: position.optional(),
});
export type PackageAddonUpdateBody = z.input<typeof PackageAddonUpdateBody>;

/** POST packages/:code/addons — a new extra operation: the name is required, the price is 0 when left out. */
export const PackageAddonBody = PackageAddonUpdateBody.extend({ name: addonName });
export type PackageAddonBody = z.input<typeof PackageAddonBody>;

/** PATCH packages/:code/chain — any of the subscription and renewal prices; the eSIM price may be cleared with null. */
export const PackageChainBody = z.object({
  branchCost: agorot.optional(),
  mainPrice: agorot.optional(),
  agentPrice: agorot.optional(),
  posPrice: agorot.optional(),
  subscriberPrice: agorot.optional(),
  renewalBranchCost: agorot.optional(),
  renewalMainPrice: agorot.optional(),
  renewalAgentPrice: agorot.optional(),
  renewalPosPrice: agorot.optional(),
  renewalSubscriberPrice: agorot.optional(),
  esimPrice: agorot.nullable().optional(),
});
export type PackageChainBody = z.input<typeof PackageChainBody>;

/** The most packages one package may renew or switch into. */
export const PACKAGE_TARGETS_MAX = 500;

/** PUT packages/:code/renewals and PUT packages/:code/switches — the codes of the target packages. */
export const PackageTargetsBody = z.object({ targets: z.array(z.string().min(1).max(64)).max(PACKAGE_TARGETS_MAX) });
export type PackageTargetsBody = z.input<typeof PackageTargetsBody>;
