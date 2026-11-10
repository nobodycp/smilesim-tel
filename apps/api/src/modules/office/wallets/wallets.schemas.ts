import { z } from 'zod';
import { MAX_AGOROT, agorot, positiveAgorot } from '../../shared/schemas';

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
