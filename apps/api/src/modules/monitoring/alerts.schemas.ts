import { z } from 'zod';
import { queryCursor, queryOneOf } from '../platform';

// The queries of the alerts' routes (backend-engineering.mdc 4.1).

/** GET system/alerts — open first, then closed; `state` keeps one of the two. */
export const AlertsQuery = z.object({
  state: queryOneOf(['open', 'closed'] as const),
  cursor: queryCursor,
});
export type AlertsQuery = z.input<typeof AlertsQuery>;
