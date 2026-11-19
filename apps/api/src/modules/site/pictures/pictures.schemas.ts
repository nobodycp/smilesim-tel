import { z } from 'zod';

// The query of the picture routes (backend-engineering.mdc 4.1).

/**
 * GET pictures/postpaid/companies/:code and GET pictures/offers/:id — `v` is the version the lists put in the URL. Anything
 * else (missing, an old version, a repeated parameter) is not an error: the picture is still served, only without
 * the year-long cache.
 */
export const PictureQuery = z.object({ v: z.string().optional().catch(undefined) });
export type PictureQuery = z.input<typeof PictureQuery>;
