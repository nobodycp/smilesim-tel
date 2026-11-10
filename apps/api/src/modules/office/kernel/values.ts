/** A whole number of agorot from 0 to 100,000,000; anything else is null. */
export function nonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100_000_000) return null;
  return value;
}

/** The ladder, top to bottom. */
export const LAYER_ORDER = ['branch', 'main_agent', 'agent', 'pos'];
