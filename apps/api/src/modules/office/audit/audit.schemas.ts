import { z } from 'zod';
import { queryCursor, queryDay, queryFlag, queryOneOf, queryText } from '../../shared/schemas';
import { ACTIVITY_ACTIONS } from '../activity/activity-log';
import { LAYER_ORDER } from '../kernel/values';

// The query of the activity log routes (backend-engineering.mdc 4.1).

/** GET audit and GET audit/export — the log's filters. `addresses=1` also counts the network addresses. */
export const AuditQuery = z.object({
  cursor: queryCursor,
  action: queryOneOf(ACTIVITY_ACTIONS),
  result: queryOneOf(['ok', 'fail']),
  layer: queryOneOf(LAYER_ORDER),
  q: queryText(),
  from: queryDay,
  to: queryDay,
  addresses: queryFlag,
});
export type AuditQuery = z.input<typeof AuditQuery>;
/** The filters once parsed: what the service reads. */
export type AuditFilter = z.output<typeof AuditQuery>;
