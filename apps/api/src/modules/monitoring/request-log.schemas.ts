import { z } from 'zod';
import { ERROR_MESSAGES, queryCursor, queryDay, queryFlag, queryOneOf, queryText, type ErrorCode } from '../platform';

// The queries of the request log routes (backend-engineering.mdc 4.1).

const ERROR_CODES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

/** `2xx`…`5xx` for a class of answers, or one status (`404`). */
const statusFilter = queryText(3).refine((value) => value === undefined || /^([1-5]xx|[1-5]\d\d)$/.test(value));

/** Milliseconds, a whole number up to ten minutes. */
const millis = queryText(6).refine((value) => value === undefined || (/^\d{1,6}$/.test(value) && Number(value) <= 600_000));

/** One of the API's error codes. */
const errorCode = queryText(40).refine((value) => value === undefined || ERROR_CODES.includes(value as ErrorCode));

/** The methods a request can be filtered by. */
export const REQUEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * GET system/requests/summary — the filters of the log, without a cursor. `route` is the pattern, exact; `path` is
 * the path as sent, any part of it, case ignored; `ip` is the start of an address (`10.0.` finds a range);
 * `unmatched=1` keeps the requests no route matched (an empty pattern, which `route` cannot ask for).
 */
export const RequestLogFilterQuery = z.object({
  status: statusFilter,
  code: errorCode,
  method: queryOneOf(REQUEST_METHODS),
  route: queryText(200),
  path: queryText(200),
  unmatched: queryFlag,
  account: queryText(60),
  ip: queryText(64),
  slowerThan: millis,
  from: queryDay,
  to: queryDay,
});
export type RequestLogFilterQuery = z.input<typeof RequestLogFilterQuery>;
export type RequestLogFilterInput = z.output<typeof RequestLogFilterQuery>;

/** GET system/requests — the rows, newest first, paged by cursor. */
export const RequestLogQuery = RequestLogFilterQuery.extend({ cursor: queryCursor });
export type RequestLogQuery = z.input<typeof RequestLogQuery>;
/** GET system/errors — the server errors, grouped: by route and a time range. */
export const RequestErrorsQuery = z.object({
  route: queryText(200),
  from: queryDay,
  to: queryDay,
});
export type RequestErrorsQuery = z.input<typeof RequestErrorsQuery>;
