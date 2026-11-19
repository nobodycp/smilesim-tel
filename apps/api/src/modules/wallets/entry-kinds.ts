// The wallet-entry kinds read by name (ADR 0028, decision 5). A sum over kinds is an allow-list; an account's own
// wallet page («المحفظة», `WalletsService.ledger`) is a statement and lists by exclusion, so nothing that moved a
// balance is hidden from its owner.

/**
 * What an account's wallet page leaves out (spec F.2): the entries that move no balance and are not the account's
 * business to read as movements — a task's hold and its release (amount 0, `held` signed). Every other kind is on
 * the page, a kind added tomorrow included.
 */
export const OFF_THE_STATEMENT: readonly string[] = ['hold', 'release'];

/**
 * The postpaid line's kinds («الفواتير»; ADR 0028, decision 5): a wallet-entry kind names one thing for ever, so these
 * bare words belong to postpaid — `charge` is a renewal, `esim` the local eSIM swap. A new line's kinds carry its
 * prefix and a dot (`prepaid.…`, `games.…`); kind-lists.spec.ts refuses a new bare kind that is in neither list.
 */
export const POSTPAID_KINDS: readonly string[] = [
  'activate', 'charge', 'extend', 'reactivate', 'disconnect', 'switch', 'esim', 'sim', 'refresh', 'transfer', 'rename', 'freeze', 'unfreeze', 'addon',
];

/** The kinds every line shares: money moved between wallets, and a task's hold and release. */
export const MONEY_KINDS: readonly string[] = ['fund', 'self_fund', 'deduct', 'deduct_in', 'hold', 'release'];

/**
 * The kinds no profit or cost sum counts (ADR 0028, decision 5: a sum is an allow-list). Every kind the API writes is
 * in a sum's allow-list (`SALE_KINDS`, `REFUND_KINDS`, `PROVIDER_OPERATION_KINDS`) or here, never both: a kind added
 * tomorrow is placed on purpose (kind-lists.spec.ts). An add-on's charge moves money with no ladder and no provider.
 */
export const MOVES_NO_PROFIT: readonly string[] = [...MONEY_KINDS, 'addon'];

/** Whether a kind is a new line's: its line's prefix, a dot, then its own word. */
export const isLineKind = (kind: string): boolean => /^[a-z][a-z-]*\.[a-z_]+$/.test(kind);
