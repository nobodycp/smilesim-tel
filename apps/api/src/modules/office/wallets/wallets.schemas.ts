import { z } from 'zod';
import { MAX_AGOROT, agorot, positiveAgorot, queryCursor, queryDay, queryOneOf, queryText } from '../../shared/schemas';
import { LAYER_ORDER } from '../kernel/values';
import { SUMMARY_WINDOWS } from './finance-summary';
import { PROVIDER_OPERATION_KINDS } from './provider-cost';

/** A positive whole amount in agorot. */
export const amount = positiveAgorot;

/** A ceiling: zero or more agorot. */
export const ceilingValue = agorot;

/** A free note: trimmed text, and anything that is not text counts as no note. */
const note = z.unknown().transform((value) => (typeof value === 'string' ? value.trim() : ''));

/** Why a deposit was made (roadmap N6); a deposit with no reason is a plain deposit. */
export const FUND_REASONS = ['deposit', 'correction', 'settlement'] as const;
/** Why money was taken back from a child. */
export const DEDUCT_REASONS = ['return', 'correction', 'settlement'] as const;

export const FundBody = z.object({ amount, note, reason: z.enum(FUND_REASONS).optional().default('deposit') });
export const DeductBody = z.object({ amount, note, reason: z.enum(DEDUCT_REASONS) });
export const CeilingBody = z.object({ ceiling: ceilingValue });
export type FundBody = z.input<typeof FundBody>;
export type DeductBody = z.input<typeof DeductBody>;
export type CeilingBody = z.input<typeof CeilingBody>;

export { MAX_AGOROT };

// The queries of the wallet, finance and provider-operation lists (backend-engineering.mdc 4.1).

/** Every kind a wallet entry may carry: money moved by hand, holds for tasks, and the line operations. */
export const WALLET_ENTRY_KINDS = ['fund', 'self_fund', 'deduct', 'deduct_in', 'hold', 'release', 'addon', ...PROVIDER_OPERATION_KINDS] as const;

/** GET wallets and GET reports/operations — a list with no filter of its own. */
export const CursorQuery = z.object({ cursor: queryCursor });
export type CursorQuery = z.input<typeof CursorQuery>;

/** GET finance and GET finance/export — the tree's entries. `scope` keeps money movements or line operations. */
export const FinanceQuery = z.object({
  cursor: queryCursor,
  kind: queryOneOf(WALLET_ENTRY_KINDS),
  layer: queryOneOf(LAYER_ORDER),
  q: queryText(),
  from: queryDay,
  to: queryDay,
  scope: queryOneOf(['money', 'operations']),
});
export type FinanceQuery = z.input<typeof FinanceQuery>;
/** The finance filters once parsed: what `financeWhere` reads. */
export type FinanceFilter = Omit<z.output<typeof FinanceQuery>, 'cursor'>;

/** GET ledger — the signed-in account's own wallet. */
export const LedgerQuery = z.object({
  cursor: queryCursor,
  kind: queryOneOf(WALLET_ENTRY_KINDS),
  direction: queryOneOf(['in', 'out']),
  from: queryDay,
  to: queryDay,
});
export type LedgerQuery = z.input<typeof LedgerQuery>;

/** GET provider-operations — the branch's operations by provider, with their match state. */
export const ProviderOperationsQuery = z.object({
  cursor: queryCursor,
  kind: queryOneOf(PROVIDER_OPERATION_KINDS),
  provider: queryText(),
  q: queryText(),
  from: queryDay,
  to: queryDay,
  match: queryOneOf(['matched', 'difference', 'pending']),
});
export type ProviderOperationsQuery = z.input<typeof ProviderOperationsQuery>;

/** GET finance/summary — the window in days; 30 when it is not sent. */
export const FinanceSummaryQuery = z.object({ days: queryOneOf(SUMMARY_WINDOWS.map(String)) });
export type FinanceSummaryQuery = z.input<typeof FinanceSummaryQuery>;

/** GET finance/profits and its export. */
export const ProfitsQuery = z.object({ from: queryDay, to: queryDay, q: queryText() });
export type ProfitsQuery = z.input<typeof ProfitsQuery>;
