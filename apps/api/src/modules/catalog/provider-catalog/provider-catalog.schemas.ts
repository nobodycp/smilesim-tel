import { z } from 'zod';
import { agorot, code, optionalText, queryText } from '../../platform';
import { simLength, simPrefix } from '../companies/companies.schemas';
import { ACTION_KEYS, type ActionKey } from '../rules/run-modes';

// The bodies of adding to the catalog from a provider (backend-engineering.mdc 4.1). The service parses them with
// `parseInput` after its permission checks; the controller documents each route from the same schema. Slice F.7e:
// from `providers.schemas.ts`, the same schemas.

// ── Adding to the catalog from the provider ────────────────────────────────────────────────────────────────────
// Numbers are real numbers here: `"19"` and `true` are refused, not read as 19 and 1.

/** A name the owner may leave out, to take the provider's own. */
const ownName = optionalText(80);

/** POST postpaid/companies — a company the provider sells, with its SIM rules; what is left out is taken from the provider. */
export const CompanyCreateBody = z.object({
  providerCode: code,
  companyCode: code,
  name: ownName,
  simLength: simLength.nullish(),
  simPrefix: simPrefix.nullish().transform((value) => value ?? ''),
  esim: z.boolean().optional(),
  esimPrice: agorot.optional(),
});
export type CompanyCreateBody = z.input<typeof CompanyCreateBody>;

/** GB, minutes or messages: -1 is "unlimited"; null or absent takes the provider's own figure. */
const fact = z.number().int().min(-1).max(1_000_000).nullish();

/** The five prices of a package, top to bottom; the service checks that each layer pays no less than the one above. */
const ladder = z.object({ branchCost: agorot, mainPrice: agorot, agentPrice: agorot, posPrice: agorot, subscriberPrice: agorot });

/** How one operation runs: `inherit` (also when left out) follows the provider now and later. */
const askedMode = z.enum(['inherit', 'auto', 'manual', 'off']).nullish();
const modes = z.object(Object.fromEntries(ACTION_KEYS.map((key) => [key, askedMode])) as Record<ActionKey, typeof askedMode>);

/** The most extra operations a new package may carry. */
export const NEW_PACKAGE_ADDONS_MAX = 20;

/** POST postpaid/packages — a package from one of the provider's products: facts, prices, extra operations, run modes. */
export const PackageCreateBody = z.object({
  providerCode: code,
  companyCode: code,
  productCode: code,
  name: ownName,
  dataGb: fact,
  smsCount: fact,
  minutes: fact,
  months: z.number().int().min(1).max(36).optional(),
  suspendAfterDays: z.number().int().min(1).max(3650).optional(),
  details: z.string().trim().max(300).optional(),
  subscription: ladder,
  renewal: ladder,
  modes: modes.nullish(),
  addons: z.array(z.object({ name: z.string().trim().min(1).max(80), price: agorot })).max(NEW_PACKAGE_ADDONS_MAX).nullish(),
  esimAvailable: z.boolean().optional(),
  forSale: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
export type PackageCreateBody = z.input<typeof PackageCreateBody>;

/** GET postpaid/providers/:code/catalog/products — the company whose products are listed. */
export const CatalogProductsQuery = z.object({ company: queryText(64) });
export type CatalogProductsQuery = z.input<typeof CatalogProductsQuery>;
