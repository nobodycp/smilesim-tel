import { z } from 'zod';

/** The largest amount or ceiling a wallet route accepts, in agorot. */
export const MAX_AGOROT = 100_000_000;

/** A positive whole amount in agorot. */
export const amount = z.number().int().min(1).max(MAX_AGOROT);

/** A ceiling: zero or more agorot. */
export const ceilingValue = z.number().int().min(0).max(MAX_AGOROT);

/** A free note: trimmed text, and anything that is not text counts as no note. */
const note = z.unknown().transform((value) => (typeof value === 'string' ? value.trim() : ''));

export const FundBody = z.object({ amount, note });
export const CeilingBody = z.object({ ceiling: ceilingValue });
