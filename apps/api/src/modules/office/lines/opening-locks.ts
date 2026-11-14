import type { OpeningLocks } from '../tasks/tasks.service';
import { assertClaimFree, lockClaim, lockLine } from './line-state';

/**
 * What opening a task locks and checks on a line, a serial and a number (slice R.4): the functions of
 * `line-state.ts`, handed to `TasksService.openTask` so that tasks imports nothing of sales. Same functions, same
 * order, same transaction as when `openTask` imported them.
 */
export const OPENING_LOCKS: OpeningLocks = {
  lockLine,
  lockClaim,
  assertClaimFree: (tx, claim) => assertClaimFree(tx, claim),
};
