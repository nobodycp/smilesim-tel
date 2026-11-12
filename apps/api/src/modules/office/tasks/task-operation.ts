import type { Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { taskActions, type TaskActions } from '../lines/activation-settlement.rules';
import type { OperationStatus } from '../providers/operations/provider-operation.rules';

// The provider operation of a task, as the manual path sees it (ADR 0019, D6 and D7). Completion, reject and
// cancel lock the operation's row inside their own transaction, after the task's row, the line and the claim keys
// and before any wallet (the one lock order), and ask `taskActions` what the operation allows. Nothing here
// decides: the table of D6 is `taskActions`. Nothing here calls a provider.

/** The locked operation of a task: what `taskActions` reads, and its id for the one write a cancel may make. */
export type LockedOperation = { id: string; status: OperationStatus; appliedAt: Date | null; applyError: string | null };

/**
 * Locks the task's operation until the transaction ends and answers it with what it allows; `operation` is null
 * for a task that never went to a provider. The dispatcher's claim, a settlement and recovery are single guarded
 * statements on the same row: one that committed first is what is read here, one that comes later waits and then
 * finds the row as this transaction left it.
 */
export async function lockedTaskOperation(tx: Prisma.TransactionClient, taskId: string): Promise<{ operation: LockedOperation | null; actions: TaskActions }> {
  const rows = await tx.$queryRaw<LockedOperation[]>`SELECT "id", "status", "appliedAt", "applyError" FROM "ProviderOperation" WHERE "taskId" = ${taskId} FOR UPDATE`;
  const operation = rows[0] ?? null;
  return { operation, actions: taskActions(operation) };
}

/**
 * Refuses a completion by hand or a reject while the task's operation is anything but absent or `failed`
 * (409 `DUPLICATE_REQUEST`): the caller's transaction is rolled back, so the task and its hold stay as they were.
 */
export async function assertOperationAllows(tx: Prisma.TransactionClient, taskId: string, action: 'complete' | 'reject'): Promise<void> {
  const { actions } = await lockedTaskOperation(tx, taskId);
  if (!actions[action]) fail(409, 'DUPLICATE_REQUEST');
}

/**
 * The operation's part of a cancel by the submitter (D7), on the locked row:
 * - no operation, or a `failed` one: nothing to do, the cancel goes on;
 * - `requested`: nothing has left, so the operation is closed as `failed (abandoned)` with `appliedAt` stamped
 *   (the settlement sweeper has nothing to do for it, and no claim can take it);
 * - anything else: refused (409 `DUPLICATE_REQUEST`), and the caller's transaction is rolled back.
 */
export async function withdrawOperation(tx: Prisma.TransactionClient, taskId: string, now: Date = new Date()): Promise<void> {
  const { operation, actions } = await lockedTaskOperation(tx, taskId);
  if (actions.cancel === 'refused') fail(409, 'DUPLICATE_REQUEST');
  if (actions.cancel !== 'abandons-operation' || !operation) return;
  const abandoned = await tx.providerOperation.updateMany({
    where: { id: operation.id, status: 'requested' },
    data: { status: 'failed', lastError: 'abandoned', appliedAt: now, leaseUntil: null },
  });
  if (abandoned.count !== 1) fail(409, 'DUPLICATE_REQUEST');
}
