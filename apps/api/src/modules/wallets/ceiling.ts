// The credit ceiling a debit is checked against (slice R.3: from `rules/prices.ts`; the ledger is the only user).

export function withinCeiling(layer: string, balance: number, ceiling: number, debit: number): boolean {
  if (debit <= 0) return true;
  if (layer === 'branch') return true;
  return balance - debit >= -ceiling;
}

/**
 * The part of a debit that a hold does not cover: new money, to be checked against the ceiling. A hold covers a
 * debit up to its own size; what it has beyond the debit simply goes back.
 */
export function uncoveredDebit(held: number, debit: number): number {
  return Math.max(0, debit - Math.max(0, held));
}
