import { z } from 'zod';
import { MAX_AGOROT, agorot, code, optionalText } from '../../shared/schemas';
import { simLength, simPrefix } from '../companies/companies.schemas';
import { ACTION_KEYS, type ActionKey } from '../office-rules';
import { ceilingValue } from '../wallet.schemas';

// The bodies of the provider routes (backend-engineering.mdc 4.1): provider settings, adding to the catalog from
// the provider, and our account with each provider. The services parse them with `parseInput` after their
// permission checks; the controllers document each route from the same schema.

// ── Provider settings ──────────────────────────────────────────────────────────────────────────────────────────

/** PATCH providers/:code/esim-price — the provider's eSIM price; null clears it. */
export const ProviderEsimPriceBody = z.object({ price: agorot.nullable() });
export type ProviderEsimPriceBody = z.input<typeof ProviderEsimPriceBody>;

/** PATCH providers/:code/settings — how the provider runs one operation by default. */
export const ProviderModeBody = z.object({ action: z.enum(ACTION_KEYS), mode: z.enum(['auto', 'manual', 'off']) });
export type ProviderModeBody = z.input<typeof ProviderModeBody>;

// ── Adding to the catalog from the provider ────────────────────────────────────────────────────────────────────
// Numbers are real numbers here: `"19"` and `true` are refused, not read as 19 and 1.

/** A name the owner may leave out, to take the provider's own. */
const ownName = optionalText(80);

/** POST companies — a company the provider sells, with its SIM rules; what is left out is taken from the provider. */
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

/** POST packages — a package from one of the provider's products: facts, prices, extra operations, run modes. */
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

// ── Our account with each provider ─────────────────────────────────────────────────────────────────────────────

/** A free note: trimmed text, and anything that is not text counts as no note. */
const note = z.unknown().transform((value) => (typeof value === 'string' ? value.trim() : ''));

/** The request body limit (main.ts, 1 MB): no text arrives longer than this. */
const BODY_CHARS = 1_048_576;

/** POST provider-accounts/:code/entries — a payment (positive) or a settlement (either sign). */
export const ProviderEntryBody = z.object({
  kind: z.enum(['payment', 'settlement']),
  amount: z.number().int().min(-MAX_AGOROT).max(MAX_AGOROT),
  note,
});
export type ProviderEntryBody = z.input<typeof ProviderEntryBody>;

/** PATCH provider-accounts/:code/matching — matched through the API at once, or by statement every N days. */
export const ProviderMatchingBody = z.object({ matchSource: z.enum(['api', 'statement']), matchEveryDays: z.number().int().min(1).max(90) });
export type ProviderMatchingBody = z.input<typeof ProviderMatchingBody>;

/** PATCH provider-accounts/:code/credit — how far we may owe the provider, and the balance that raises an alert. */
export const ProviderCreditBody = z.object({ creditLimit: ceilingValue, alertFloor: z.number().int().min(-MAX_AGOROT).max(MAX_AGOROT).optional() });
export type ProviderCreditBody = z.input<typeof ProviderCreditBody>;

/** POST provider-accounts/:code/statements/preview — a statement file, its content in base64. */
export const StatementFileBody = z.object({ fileName: z.string().min(1).max(200), content: z.string().min(1).max(BODY_CHARS) });
export type StatementFileBody = z.input<typeof StatementFileBody>;

const column = z.number().int().min(0).max(200);

/** POST provider-accounts/:code/reconciliations — the statement file and which of its columns to read. */
export const ReconciliationBody = StatementFileBody.extend({ map: z.object({ msisdn: column, date: column, amount: column, reference: column.nullable().optional() }) });
export type ReconciliationBody = z.input<typeof ReconciliationBody>;

/** PATCH reconciliation-items/:id — mark a difference handled (with a note) or open it again. */
export const ReconciliationItemBody = z.object({ status: z.enum(['open', 'resolved']), note });
export type ReconciliationItemBody = z.input<typeof ReconciliationItemBody>;
