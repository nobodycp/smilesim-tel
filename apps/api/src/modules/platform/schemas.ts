import { z } from 'zod';

// The pieces every body schema is built from (backend-engineering.mdc 4.1, 4.2): every string has a maximum,
// every number is a whole number with bounds. A domain adds its own in `<domain>/<domain>.schemas.ts`.

/** The largest amount, price or ceiling the API accepts, in agorot. */
export const MAX_AGOROT = 100_000_000;

/** Zero or more agorot. */
export const agorot = z.number().int().min(0).max(MAX_AGOROT);

/** One agora or more. */
export const positiveAgorot = z.number().int().min(1).max(MAX_AGOROT);

/** A price that may be cleared: a number of agorot, or null / absent for "no price of its own". */
export const optionalAgorot = agorot.nullish().transform((value) => value ?? null);

/** Text with a hard maximum, trimmed. */
export const text = (max: number) => z.string().trim().max(max);

/** Text that may be absent: absent and empty are the same thing, the empty string. */
export const optionalText = (max: number) => z.string().trim().max(max).optional().default('');

/** A free note a person writes on a movement, a task or a refusal. */
export const NOTE_MAX = 500;
export const note = optionalText(NOTE_MAX);

/** An account's login name as it is stored. */
export const loginName = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/);

/** A mobile number as the office writes it. */
export const msisdn = z.string().trim().regex(/^05\d{8}$/);

/** A SIM serial as typed: digits are checked against the company's rules by the service. */
export const iccid = z.string().trim().max(32);

/** A catalog code (package, company, provider). */
export const code = z.string().trim().min(1).max(64);

/** A row id. */
export const id = z.string().min(1).max(64);

/** A picture as a data URL, up to `max` characters. The service checks its type and size in bytes. */
export const dataUrl = (max: number) => z.string().max(max);

/**
 * Simulation only: what the simulated provider answers (`success` or `fail`). A real gateway ignores it; the
 * gateway itself refuses a request it cannot run (providers/gateway).
 */
export const providerHint = z.unknown().optional();

// Query-string pieces (backend-engineering.mdc 4.1). A query is parsed by a schema like a body: a parameter the
// schema does not name is dropped (browsers and proxies add their own), a named one with a value outside its set is
// 400 INVALID. Every value arrives as text; an empty one counts as not sent.
const sent = (value: unknown) => (value === '' || value === null ? undefined : value);

/** Free text of a filter: a search box, a code, a login. */
export const queryText = (max = 100) => z.preprocess(sent, z.string().trim().max(max).optional());

/** One of a closed set of values. */
export const queryOneOf = <T extends string>(values: readonly T[]) => z.preprocess(sent, z.enum(values as [T, ...T[]]).optional());

/** A yes/no switch as the web writes it: `1` or `true`, `0` or `false`. */
export const queryFlag = z.preprocess(sent, z.enum(['1', 'true', '0', 'false']).optional());

/** A day (`2026-11-10`) or a moment, as the day range reads it. */
export const queryDay = z.preprocess(sent, z.string().max(40).refine((value) => !Number.isNaN(new Date(value).getTime())).optional());

/** A list cursor: opaque here, judged by `cursorPosition` / `keyCursor`. */
export const queryCursor = queryText(400);

/** Whether a `queryFlag` was sent on. */
export const isOn = (flag: '1' | 'true' | '0' | 'false' | undefined) => flag === '1' || flag === 'true';

/** A list or report over a range of days. */
export const PeriodQuery = z.object({ from: queryDay, to: queryDay });
export type PeriodQuery = z.input<typeof PeriodQuery>;
