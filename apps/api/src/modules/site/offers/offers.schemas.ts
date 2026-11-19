import { z } from 'zod';

// The bodies of the offer routes (backend-engineering.mdc 4.1). The service parses them with `parseInput`
// after its permission checks; the controller documents each route from the same schema.

/** The layers an offer may be shown to. */
export const OFFER_LAYERS = ['branch', 'main_agent', 'agent', 'pos'] as const;

/**
 * Decoded bytes an offer picture may have (decision 11, speed plan PF.6): the web shrinks it to WebP, 1600 px on
 * its longest side, under this. A picture already stored is left alone when an edit sends it back unchanged.
 */
export const OFFER_IMAGE_BYTES = 300_000;

/** The request body limit (main.ts, 1 MB): no text arrives longer than this. */
const BODY_CHARS = 1_048_576;

/** A place in a list as the database stores it (a 32-bit whole number). */
const position = z.number().int().min(-2_147_483_648).max(2_147_483_647);

/**
 * A date as text; null or empty clears it and an absent one is left alone. Text that is not a date is refused.
 */
const date = z
  .string()
  .max(40)
  .nullish()
  .transform((value) => (value === undefined ? undefined : value ? new Date(value) : null))
  .refine((value) => !(value instanceof Date) || !Number.isNaN(value.getTime()));

/** Where an offer's button leads: a path inside the app or an https address; empty or null is "no button". */
const href = z
  .string()
  .trim()
  .max(500)
  .refine((value) => !value || /^\/(?!\/)/.test(value) || /^https:\/\//.test(value));

/**
 * PATCH offers/:id — any of an offer's fields. The picture is deliberately wide here: one that is not a PNG, JPEG
 * or WebP data URL answers `INVALID` and a new one over `OFFER_IMAGE_BYTES` answers `IMAGE_TOO_LARGE`, both from
 * the service.
 */
export const OfferUpdateBody = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().max(240).optional(),
  image: z.string().max(BODY_CHARS).nullish(),
  actionLabel: z.string().trim().max(30).nullish(),
  actionHref: href.nullish(),
  seconds: z.number().int().min(3).max(60).optional(),
  active: z.boolean().optional(),
  layers: z.array(z.enum(OFFER_LAYERS)).min(1).max(16).optional(),
  startsAt: date,
  endsAt: date,
  position: position.optional(),
});
export type OfferUpdateBody = z.input<typeof OfferUpdateBody>;

/** POST offers — a new offer: the title is required. */
export const OfferBody = OfferUpdateBody.extend({ title: z.string().trim().min(1).max(80) });
export type OfferBody = z.input<typeof OfferBody>;

/** POST offers/:id/move — one place up or down. */
export const OfferMoveBody = z.object({ direction: z.enum(['up', 'down']) });
export type OfferMoveBody = z.input<typeof OfferMoveBody>;
