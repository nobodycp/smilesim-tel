import { z } from 'zod';

/** The largest amount or ceiling a wallet route accepts, in agorot. */
export const MAX_AGOROT = 100_000_000;

/** A positive whole amount in agorot. */
export const amount = z.number().int().min(1).max(MAX_AGOROT);

/** A ceiling: zero or more agorot. */
export const ceilingValue = z.number().int().min(0).max(MAX_AGOROT);

/** A free note: trimmed text, and anything that is not text counts as no note. */
const note = z.unknown().transform((value) => (typeof value === 'string' ? value.trim() : ''));

/** Why a deposit was made (roadmap N6); a deposit with no reason is a plain deposit. */
export const FUND_REASONS = ['deposit', 'correction', 'settlement'] as const;
/** Why money was taken back from a child. */
export const DEDUCT_REASONS = ['return', 'correction', 'settlement'] as const;

export const FundBody = z.object({ amount, note, reason: z.enum(FUND_REASONS).optional().default('deposit') });
export const DeductBody = z.object({ amount, note, reason: z.enum(DEDUCT_REASONS) });
export const CeilingBody = z.object({ ceiling: ceilingValue });
