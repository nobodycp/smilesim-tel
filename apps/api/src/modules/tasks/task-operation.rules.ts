import type { OperationStatus } from '../providers';

// What a task reads of its provider operation (ADR 0019 D6, D7, D14, O6): the operation's phase for the task, what
// the phase allows on the task, what became of the task's hold, whether a repeated request is the same one, and
// who may decide on an operation. Pure: no Nest, no Prisma, no HTTP. Slice R.4: from
// `lines/activation-settlement.rules.ts`, text unchanged, so that tasks imports nothing of sales.

// ── The operation as its task sees it ───────────────────────────────────────────────────────────────────────

/** A task's operation, or null for a task that never went to a provider (the manual route). */
export type TaskOperation = { status: OperationStatus; appliedAt: Date | null; applyError: string | null } | null;

/**
 * Where an operation stands for its task and the money:
 * - `none`: no operation, a manual task.
 * - `requested`, `pending`, `unknown`: as the operation's own status says.
 * - `unapplied`: the provider confirmed and the settlement has not run yet.
 * - `exception`: the provider confirmed and the line could not be created (D16).
 * - `applied`: the provider confirmed, the line exists and the hold was captured.
 * - `failed`: the provider did not run it; the task is the branch's.
 */
export type OperationPhase = 'none' | 'requested' | 'pending' | 'unknown' | 'unapplied' | 'exception' | 'applied' | 'failed';

export function phaseOf(operation: TaskOperation): OperationPhase {
  if (!operation) return 'none';
  if (operation.status !== 'succeeded') return operation.status;
  if (operation.appliedAt) return 'applied';
  return operation.applyError ? 'exception' : 'unapplied';
}

// ── The request that opened the task (D14) ─────────────────────────────────────────────────────────────────

/** What is stored for a request sent with an `Idempotency-Key`: whose key it is, and what it was sent with. */
export type TaskRequest = { key: string; hash: string };

/** A task found under a request key: the first answer again when the request is the same one, else a refusal. */
export function sameRequest(first: { requestHash: string | null }, request: TaskRequest): boolean {
  return first.requestHash === request.hash;
}

// ── What an operation allows on its task (D6) ───────────────────────────────────────────────────────────────

/**
 * What may be done to an open task: completed by hand, rejected by the branch, cancelled by its submitter.
 * `abandons-operation` is the one cancel that also changes the operation: it moves `requested` to `failed` in the
 * same transaction as the release (D7), and is refused if the dispatcher got there first.
 */
export type TaskActions = { complete: boolean; reject: boolean; cancel: 'allowed' | 'abandons-operation' | 'refused' };

const FROZEN: TaskActions = { complete: false, reject: false, cancel: 'refused' };
const OPEN: TaskActions = { complete: true, reject: true, cancel: 'allowed' };

const ACTIONS: Record<OperationPhase, TaskActions> = {
  // A manual task, and a task the provider did not run: the branch's, as today.
  none: OPEN,
  failed: OPEN,
  // Nothing has left: the submitter may still withdraw, and only the submitter.
  requested: { complete: false, reject: false, cancel: 'abandons-operation' },
  // The provider may have it, has it, or has done it: nobody completes, rejects or cancels.
  pending: FROZEN,
  unknown: FROZEN,
  unapplied: FROZEN,
  exception: FROZEN,
  applied: FROZEN,
};

export function taskActions(operation: TaskOperation): TaskActions {
  return ACTIONS[phaseOf(operation)];
}

/** In flight: the task's money and reservation must stay as they are until the operation is settled and applied. */
export function inFlight(operation: TaskOperation): boolean {
  const phase = phaseOf(operation);
  return phase === 'requested' || phase === 'pending' || phase === 'unknown' || phase === 'unapplied' || phase === 'exception';
}

// ── What a screen is told (O6) ──────────────────────────────────────────────────────────────────────────────

/** Where a task's money stands: nothing was ever held, it is held, it became the charge, or it went back. */
export type HoldState = 'none' | 'held' | 'captured' | 'released';

/**
 * What became of the hold a task took when it opened, from the task alone: an open task holds it, a done one had
 * it captured as its charge, a rejected or cancelled one had it given back. A task that charges nothing held nothing.
 */
export function holdOf(task: { status: string; held: number | null; posDelta: number }): HoldState {
  if (!task.held || task.held <= 0 || task.posDelta >= 0) return 'none';
  if (task.status === 'pending' || task.status === 'working') return 'held';
  return task.status === 'done' ? 'captured' : 'released';
}

/** The phase a screen shows for a task's operation; null for a task that never went to a provider. */
export function shownPhase(operation: TaskOperation): Exclude<OperationPhase, 'none'> | null {
  const phase = phaseOf(operation);
  return phase === 'none' ? null : phase;
}

// ── Who may decide (D15, D16) ───────────────────────────────────────────────────────────────────────────────

/** The grant that lets a branch account decide on a provider operation; the owner needs none. */
export const DECISION_GRANT = 'accounting';

/** Who may decide on a provider operation, and so who is told when one waits for a decision (D15, D16). */
export function mayDecide(account: { layer: string; isBranchOwner: boolean; grants: readonly string[] }): boolean {
  return account.layer === 'branch' && (account.isBranchOwner || account.grants.includes(DECISION_GRANT));
}
