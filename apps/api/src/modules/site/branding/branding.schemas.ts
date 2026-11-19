import { z } from 'zod';

// The query of the branding image route (backend-engineering.mdc 4.1).

/**
 * GET branding/:kind — `v` is the version GET /branding answers. Anything else (missing, an old version, a
 * repeated parameter) is not an error: the image is still served, only without the year-long cache.
 */
export const BrandingImageQuery = z.object({ v: z.string().optional().catch(undefined) });
export type BrandingImageQuery = z.input<typeof BrandingImageQuery>;
