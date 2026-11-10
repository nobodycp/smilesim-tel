import { z } from 'zod';
import { queryCursor, queryFlag, queryOneOf, queryText } from '../../shared/schemas';
import { LAYER_ORDER } from '../kernel/values';

// The queries of the report routes (backend-engineering.mdc 4.1).

/** GET reports/balances and its export — the accounts under the viewer; `negative=1` keeps the ones in debt. */
export const BalancesQuery = z.object({ cursor: queryCursor, q: queryText(), layer: queryOneOf(LAYER_ORDER), negative: queryFlag });
export type BalancesQuery = z.input<typeof BalancesQuery>;
/** The balances filters once parsed. */
export type BalancesFilter = z.output<typeof BalancesQuery>;
