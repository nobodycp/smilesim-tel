import { z } from 'zod';
import { ERROR_MESSAGES, queryCursor, queryDay, queryText, type ErrorCode } from '../platform';

// The queries of the request log routes (backend-engineering.mdc 4.1).

const ERROR_CODES = Object.keys(ERROR_MESSAGES) as ErrorCode[];

/** `2xx`…`5xx` for a class of answers, or one status (`404`). */
const statusFilter = queryText(3).refine((value) => value === undefined || /^([1-5]xx|[1-5]\d\d)$/.test(value));

/** Milliseconds, a whole number up to ten minutes. */
const millis = queryText(6).refine((value) => value === undefined || (/^\d{1,6}$/.test(value) && Number(value) <= 600_000));

/** One of the API's error codes. */
const errorCode = queryText(40).refine((value) => value === undefined || ERROR_CODES.includes(value as ErrorCode));

/** GET system/requests/summary — the filters of the log, without a cursor. */
export const RequestLogFilterQuery = z.object({
  status: statusFilter,
  code: errorCode,
  route: queryText(200),
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
