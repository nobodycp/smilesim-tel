import { z } from 'zod';
import { queryOneOf } from '../../shared/schemas';

// The query of the home routes (backend-engineering.mdc 4.1).

export const OVERVIEW_PERIODS = ['day', 'month', 'all'] as const;

/** GET overview — the period the figures cover; `month` when it is not sent. */
export const OverviewQuery = z.object({ period: queryOneOf(OVERVIEW_PERIODS) });
export type OverviewQuery = z.input<typeof OverviewQuery>;
