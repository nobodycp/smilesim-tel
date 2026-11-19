import { costsAtProvider } from '../pricing';
import type { Sale } from './sale';

// The provider and the cost every operation's wallet entry stores (ADR 0025); the provider books are sums of them.

// The kinds are also listed in the CHECK `WalletEntry_operation_priced` (migration 20261117210000_provider_ledger_stored);
// provider-priced-entries.db.spec.ts compares the two lists. No read selects a provider's operations by this list: they
// read the stored fact, `providerId IS NOT NULL` (spec F.5; provider-predicate.db.spec.ts), so a kind of a new line
// that stores a provider is in the books and the lists at once.
export const PROVIDER_OPERATION_KINDS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer'];

const OPERATION_KINDS = new Set(PROVIDER_OPERATION_KINDS);

/**
 * Why an operation the provider was paid for charged the point of sale nothing (spec DB.5 P.7, ADR 0025 answer 4):
 * `given_back` — the provider succeeded and the money was given back (`release-after-success`, named by the caller);
 * `priced_zero` — an activation or renewal sold at 0 (worked out here). A given-back operation the branch charged the
 * point of sale for afterwards (spec DB.5 P.9, ADR 0027) turns to `charged_later`: the row keeps its purchase and its
 * `branchMargin`, and is no longer a loss to chase. The CHECK `WalletEntry_provider_loss` (migrations
 * 20261117240000_provider_loss, 20261118100000_provider_loss_charged_later) accepts these three only.
 */
export const PROVIDER_LOSSES = ['given_back', 'priced_zero', 'charged_later'] as const;
export type ProviderLoss = (typeof PROVIDER_LOSSES)[number];

/** The marks still open (P.9): what the warnings count and price, and what the filter `any` keeps. */
export const OPEN_LOSSES = ['given_back', 'priced_zero'] as const;
const OPEN = new Set<string>(OPEN_LOSSES);

/** Whether a mark is a loss still to chase (P.9): `charged_later` is not. */
export function isOpenLoss(loss: string | null | undefined): boolean {
  return loss != null && OPEN.has(loss);
}

/** What a screen may filter on: every open mark (`any`), or one reason. */
export const LOSS_FILTERS = ['any', ...PROVIDER_LOSSES] as const;
export type LossFilter = (typeof LOSS_FILTERS)[number];

/**
 * The entries a loss filter keeps, in SQL. `any` keeps `IS NOT NULL` beside the open marks, and one reason is an
 * equality (which implies it), so the partial index `WalletEntry_provider_loss` (its predicate) serves every form.
 */
export function lossWhere(filter: LossFilter | undefined): { providerLoss?: { not: null; in: string[] } | ProviderLoss } {
  if (!filter) return {};
  return filter === 'any' ? { providerLoss: { not: null, in: [...OPEN_LOSSES] } } : { providerLoss: filter };
}

/**
 * The kinds that are a sale of a package at the provider. A switch is not among them: a difference of 0 between two
 * packages is the price list, not a sale priced 0.
 */
const PRICED_ZERO_KINDS = new Set(['activate', 'charge', 'extend', 'reactivate']);

export type OperationColumns = { providerId: string | null; providerCost: number | null; providerLoss: 'given_back' | 'priced_zero' | null };

/**
 * The provider, the cost and the loss mark an entry of `kind` stores, written in the entry's own INSERT (ADR 0025,
 * slice P.1; P.7): no statement is added for them. An operation kind always carries a provider and a cost, fixed at
 * the write and never updated afterwards; the CHECK `WalletEntry_operation_priced` refuses an operation entry without
 * them.
 *
 * - The provider is the sale's (`Sale.providerId`): the provider of the package the operation was carried out on.
 * - The cost is the sale's when it names one. Otherwise it is 0 for a kind the provider does not price, and for an
 *   operation recorded without money (`recorded`, `WalletLedger.recordOp`) that names none. A priced operation that
 *   moves money must name its cost: the caller works it out from the package and the terms it holds.
 * - The mark (P.7): the sale's `providerLoss` when the caller names one (`given_back`); otherwise `priced_zero` for an
 *   activation or renewal that moves 0 (`amount`) and costs the branch more than 0; else none.
 * - Any other kind keeps what it stored before: the sale's cost or nothing, no provider, no mark.
 */
export function operationColumns(kind: string, sale: Sale | undefined, recorded: boolean, amount: number): OperationColumns {
  if (!OPERATION_KINDS.has(kind)) return { providerId: null, providerCost: recorded ? (sale?.providerCost ?? 0) : (sale?.providerCost ?? null), providerLoss: null };
  if (!sale?.providerId) throw new Error(`a ${kind} entry is written without its provider (ADR 0025)`);
  if (sale.providerCost === undefined && !recorded && costsAtProvider(kind)) throw new Error(`a ${kind} entry is written without its provider cost (ADR 0025)`);
  const providerCost = sale.providerCost ?? 0;
  if (sale.providerLoss && amount !== 0) throw new Error(`a ${kind} entry that moves money is marked ${sale.providerLoss} (P.7)`);
  const providerLoss = sale.providerLoss ?? (PRICED_ZERO_KINDS.has(kind) && amount === 0 && providerCost > 0 ? 'priced_zero' : null);
  return { providerId: sale.providerId, providerCost, providerLoss };
}
