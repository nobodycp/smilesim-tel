// The wallet-entry kinds read by name (ADR 0028, decision 5). A sum over kinds is an allow-list; an account's own
// wallet page («المحفظة», `WalletsService.ledger`) is a statement and lists by exclusion, so nothing that moved a
// balance is hidden from its owner.

/**
 * What an account's wallet page leaves out (spec F.2): the entries that move no balance and are not the account's
 * business to read as movements — a task's hold and its release (amount 0, `held` signed). Every other kind is on
 * the page, a kind added tomorrow included.
 */
export const OFF_THE_STATEMENT: readonly string[] = ['hold', 'release'];
