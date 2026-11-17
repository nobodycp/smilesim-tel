import { z } from 'zod';
import { agorot, dataUrl } from '../../platform';
import { SIM_LENGTH_MAX, SIM_LENGTH_MIN } from '../rules/sim-rules';

// The bodies of the company routes (backend-engineering.mdc 4.1). The service parses them with `parseInput`
// after its permission checks; the controller documents each route from the same schema.

/** The serial digits a company's SIM starts with: up to ten, or none. */
export const simPrefix = z.string().trim().regex(/^\d{0,10}$/);

/** How many digits a company's SIM serial has; null is "any length". */
export const simLength = z.number().int().min(SIM_LENGTH_MIN).max(SIM_LENGTH_MAX);

/**
 * PUT companies/:code/sim — the SIM rules and, when sent, the eSIM price. `readSimRules` (rules/sim-rules.ts) still
 * checks the prefix against the length.
 */
export const CompanySimBody = z.object({
  length: simLength.nullish(),
  prefix: simPrefix,
  esim: z.boolean(),
  esimPrice: agorot.optional(),
});
export type CompanySimBody = z.input<typeof CompanySimBody>;

/**
 * The largest new company mark, in decoded bytes (decision 11, speed plan PF.7): the web shrinks it to WebP, 256 px
 * on its longest side, under this. The longest data URL that can hold it (base64 is 4/3, plus the prefix).
 */
export const COMPANY_IMAGE_BYTES = 50_000;
export const COMPANY_IMAGE_CHARS = 70_000;

/**
 * PUT companies/:code/image — the company's picture as a data URL; an empty or absent picture clears it. The
 * service checks the picture's type and its size in bytes: a URL (what the lists carry, speed plan PF.7) or an
 * oversized mark is `INVALID`.
 */
export const CompanyImageBody = z.object({
  image: dataUrl(COMPANY_IMAGE_CHARS).nullish(),
});
export type CompanyImageBody = z.input<typeof CompanyImageBody>;
