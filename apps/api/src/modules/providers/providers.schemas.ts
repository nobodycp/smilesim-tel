import { z } from 'zod';
import { MAX_AGOROT, agorot, queryCursor, queryDay, queryOneOf, queryText } from '../platform';
import { ACTION_KEYS } from '../catalog';
import { ceilingValue, LOSS_FILTERS, PROVIDER_OPERATION_KINDS } from '../wallets';

// The bodies of the provider routes (backend-engineering.mdc 4.1): provider settings and our account with each
// provider. Adding to the catalog from a provider is the postpaid catalog's (`provider-catalog.schemas.ts`, slice
// F.7e). The services parse them with `parseInput` after their permission checks; the controllers document each
// route from the same schema.

// ── Provider settings ──────────────────────────────────────────────────────────────────────────────────────────

/** PATCH providers/:code/esim-price — the provider's eSIM price; null clears it. */
export const ProviderEsimPriceBody = z.object({ price: agorot.nullable() });
export type ProviderEsimPriceBody = z.input<typeof ProviderEsimPriceBody>;

/** PATCH providers/:code/settings — how the provider runs one operation by default. */
export const ProviderModeBody = z.object({ action: z.enum(ACTION_KEYS), mode: z.enum(['auto', 'manual', 'off']) });
export type ProviderModeBody = z.input<typeof ProviderModeBody>;

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

/**
 * A provider's credential as the branch owner enters it (ADR 0019, D18). Write-only: no route answers it. What a
 * provider issues is its own business (a key, a token, a JSON document), so only its size is judged here.
 */
export const ProviderCredentialBody = z.object({ value: z.string().trim().min(8).max(4000) });
export type ProviderCredentialBody = z.input<typeof ProviderCredentialBody>;

/** GET provider-operations — the branch's operations by provider, with their match state. */
export const ProviderOperationsQuery = z.object({
  cursor: queryCursor,
  kind: queryOneOf(PROVIDER_OPERATION_KINDS),
  provider: queryText(),
  q: queryText(),
  from: queryDay,
  to: queryDay,
  match: queryOneOf(['matched', 'difference', 'pending']),
  /** The operations marked as the branch's loss (spec DB.5 P.7): all of them, or one reason. */
  loss: queryOneOf(LOSS_FILTERS),
});
export type ProviderOperationsQuery = z.input<typeof ProviderOperationsQuery>;
