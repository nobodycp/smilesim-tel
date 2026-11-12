import { createHash } from 'node:crypto';
import { validKey, type OperationStatus } from '../providers/operations/provider-operation.rules';

// How a provider operation and its activation task stand to each other (ADR 0019). Pure: no Nest, no Prisma, no
// HTTP. The services of later slices ask these functions and decide nothing themselves.

// ── The operation as its task sees it ───────────────────────────────────────────────────────────────────────

/** Why a succeeded operation could not be applied (D16). The database accepts no other value. */
export const APPLY_ERRORS = ['number-taken', 'sim-taken', 'target-missing', 'esim-code-missing'] as const;
export type ApplyError = (typeof APPLY_ERRORS)[number];

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

/**
 * The idempotency key of a task's operation (D3). One task has one operation, so the key is the task: a retry
 * is another attempt under the same key, never another key.
 */
export function operationKey(taskId: string): string {
  const key = `activate:${taskId}`;
  if (!taskId || !validKey(key)) throw new RangeError('a task id that cannot name a provider operation');
  return key;
}

// ── The request that opens an activation task (D14) ─────────────────────────────────────────────────────────

/** What is stored for a request sent with an `Idempotency-Key`: whose key it is, and what it was sent with. */
export type TaskRequest = { key: string; hash: string };

/** The parsed body of an activation, as `ActivateBody` leaves it. */
export type ActivationInput = { packageCode: string; posLoginName: string; esim: boolean; iccid: string; msisdn: string; currentDetails: string; outcome?: unknown };

/**
 * The stored form of a request key: SHA-256 of the submitter and the key the client sent. A key is one account's:
 * the same text sent by another account is another key, so no account is ever answered with another's task.
 * Null for a key that is not 8 to 120 characters of `A-Z a-z 0-9 . _ : -`.
 */
export function requestKeyOf(submitterId: string, sent: string): string | null {
  if (!submitterId || !validKey(sent)) return null;
  return createHash('sha256').update(`${submitterId}:${sent}`).digest('hex');
}

/** The fingerprint of a parsed activation: a key that comes back with another one is refused, never answered. */
export function activationRequestHash(input: ActivationInput): string {
  const fields = [input.packageCode, input.posLoginName, input.esim, input.iccid, input.msisdn, input.currentDetails, input.outcome ?? null];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

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

// ── What the system does next (D6, D8, D16) ─────────────────────────────────────────────────────────────────

/**
 * The settlement's next step for an operation:
 * - `none`: nothing to settle (no operation).
 * - `wait`: the relay and the dispatcher have it.
 * - `apply`: create the line and capture the hold (T5).
 * - `hand-to-branch`: note the task as a provider failure and leave it to the branch (T6).
 * - `await-decision`: unknown, or an exception: only a person, or the provider's own late answer, moves it.
 * - `settled`: applied or handed over; nothing more.
 */
export type SettlementStep = 'none' | 'wait' | 'apply' | 'hand-to-branch' | 'await-decision' | 'settled';

export function settlementOf(operation: TaskOperation): SettlementStep {
  const phase = phaseOf(operation);
  if (phase === 'none') return 'none';
  if (phase === 'requested' || phase === 'pending') return 'wait';
  if (phase === 'unapplied') return 'apply';
  if (phase === 'unknown' || phase === 'exception') return 'await-decision';
  if (phase === 'applied') return 'settled';
  // Failed: handed to the branch once, marked by `appliedAt`.
  return operation?.appliedAt ? 'settled' : 'hand-to-branch';
}

/**
 * Why a succeeded operation cannot be applied, from the refusal its application met (D16); null for anything
 * else. Only these three are business refusals: the serial or the number was taken meanwhile, or what the task
 * names is gone. Every other failure is technical: nothing is written for it and the application is tried again.
 */
export function applyErrorOf(refusal: { status: number; code: string }): ApplyError | null {
  if (refusal.status === 409 && refusal.code === 'SIM_TAKEN') return 'sim-taken';
  if (refusal.status === 409 && refusal.code === 'NUMBER_TAKEN') return 'number-taken';
  if (refusal.status === 404 && refusal.code === 'NOT_FOUND') return 'target-missing';
  return null;
}

/** Whether the sweeper should run the settlement for it: only the two steps the system itself can take. */
export function sweepable(operation: TaskOperation): boolean {
  const step = settlementOf(operation);
  return step === 'apply' || step === 'hand-to-branch';
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

/**
 * What an account may do about a task's operation right now, asked of `decisionStep` with evidence that is
 * complete: the decisions it may state, and whether it may approve or refuse the proposal that is open. A screen
 * offers exactly these; the routes ask the rules again with what was really sent.
 */
export function decisionChoices(events: readonly DecisionEvent[], actor: DecisionActor, operation: TaskOperation, submitterId: string): { decisions: Decision[]; approve: boolean; refuse: boolean; blocked: DecisionRefusal | null } {
  const evidence: DecisionEvidence = { kind: EVIDENCE_KINDS[0], note: 'x'.repeat(MIN_DECISION_NOTE), providerRef: 'x' };
  const tried = DECISIONS.map((decision) => ({ decision, step: decisionStep(events, actor, { act: 'decide', decision, evidence, operation, submitterId }) }));
  const approve = decisionStep(events, actor, { act: 'approve', operation, submitterId });
  const refuse = decisionStep(events, actor, { act: 'refuse', operation, submitterId });
  // Why this account can do nothing here, when the reason is the account and not the operation's state.
  const personal: DecisionRefusal[] = ['entered-session', 'not-authorised', 'own-task', 'own-proposal'];
  const refusals = [...tried.map((row) => row.step), approve, refuse].flatMap((step) => (step.ok ? [] : [step.refusal]));
  const any = tried.some((row) => row.step.ok) || approve.ok || refuse.ok;
  return {
    decisions: tried.filter((row) => row.step.ok).map((row) => row.decision),
    approve: approve.ok,
    refuse: refuse.ok,
    blocked: any ? null : refusals.find((refusal) => personal.includes(refusal)) ?? null,
  };
}

// ── Decisions by people (D15) ───────────────────────────────────────────────────────────────────────────────

export const DECISIONS = ['confirm-success', 'declare-failure', 'apply-corrected', 'release-after-success'] as const;
export type Decision = (typeof DECISIONS)[number];

export const EVIDENCE_KINDS = ['provider-portal', 'provider-statement', 'provider-answer', 'line-test'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const DECISION_EVENT_TYPES = ['proposed', 'approved', 'refused', 'applied'] as const;
export type DecisionEventType = (typeof DECISION_EVENT_TYPES)[number];

/** The shortest note a decision may carry, counted without the spaces around it. */
export const MIN_DECISION_NOTE = 20;

/** The phase each decision is about. */
const DECIDES: Record<Decision, OperationPhase> = {
  'confirm-success': 'unknown',
  'declare-failure': 'unknown',
  'apply-corrected': 'exception',
  'release-after-success': 'exception',
};

/**
 * The decisions that let money go back to the point of sale. They are only proposed by one account and take
 * effect when a second, independent account approves. The other two keep the sale and need one account.
 */
export function needsSecondAccount(decision: Decision): boolean {
  return decision === 'declare-failure' || decision === 'release-after-success';
}

/** One stored step of a decision, as much of it as the rules read. */
export type DecisionEvent = { sequence: number; type: DecisionEventType; decision: Decision; accountId: string };

/** Who is acting: the fields of the office's `Actor` the rules read. */
export type DecisionActor = { id: string; layer: string; isBranchOwner: boolean; grants: readonly string[]; impersonating: boolean };

export type DecisionEvidence = { kind: string | null; note: string; providerRef: string | null };

/** What is asked: to state a decision with its evidence, or to answer the proposal that is open. */
export type DecisionRequest = (
  | { act: 'decide'; decision: Decision; evidence: DecisionEvidence }
  | { act: 'approve' }
  | { act: 'refuse' }
) & { operation: TaskOperation; submitterId: string };

export type DecisionRefusal =
  /** An entered (impersonation) session: the account named would not be the person who acted. */
  | 'entered-session'
  /** Not the branch owner and not a branch account holding `accounting`. */
  | 'not-authorised'
  /** The account that submitted the task decides nothing about it. */
  | 'own-task'
  /** The operation is not in the state this decision is about. */
  | 'not-applicable'
  /** A proposal waits for its answer: it is approved or refused before anything else is decided. */
  | 'proposal-open'
  | 'no-proposal'
  /** Nobody answers their own proposal: it is approved, or refused, by another account. */
  | 'own-proposal'
  | 'evidence-missing'
  | 'note-too-short'
  | 'reference-missing';

/**
 * The event to write, and what it does:
 * - `none`: the event is the whole step (a proposal, a refusal).
 * - a decision: the caller applies it in the same transaction as the event.
 */
export type DecisionStep =
  | { ok: true; event: { sequence: number; type: DecisionEventType; decision: Decision }; effect: 'none' | Decision }
  | { ok: false; refusal: DecisionRefusal };

const refuse = (refusal: DecisionRefusal): DecisionStep => ({ ok: false, refusal });

/** The proposal that waits for an answer: the last event, when it is a proposal. */
export function openProposal(events: readonly DecisionEvent[]): DecisionEvent | null {
  const last = [...events].sort((a, b) => a.sequence - b.sequence).at(-1);
  return last?.type === 'proposed' ? last : null;
}

/** Whether a release after the provider's success was approved: the last word on an operation. */
export function released(events: readonly DecisionEvent[]): boolean {
  return events.some((event) => event.type === 'approved' && event.decision === 'release-after-success');
}

function authorised(actor: DecisionActor): boolean {
  return mayDecide(actor);
}

/** The grant that lets a branch account decide on a provider operation; the owner needs none. */
export const DECISION_GRANT = 'accounting';

/** Who may decide on a provider operation, and so who is told when one waits for a decision (D15, D16). */
export function mayDecide(account: { layer: string; isBranchOwner: boolean; grants: readonly string[] }): boolean {
  return account.layer === 'branch' && (account.isBranchOwner || account.grants.includes(DECISION_GRANT));
}

function evidenceRefusal(decision: Decision, evidence: DecisionEvidence): DecisionRefusal | null {
  if (!evidence.kind || !(EVIDENCE_KINDS as readonly string[]).includes(evidence.kind)) return 'evidence-missing';
  if (evidence.note.trim().length < MIN_DECISION_NOTE) return 'note-too-short';
  if (decision === 'confirm-success' && !evidence.providerRef?.trim()) return 'reference-missing';
  return null;
}

/**
 * The next step of a decision on a provider operation (D15), or why it is refused.
 *
 * Who: the branch owner or a branch account holding `accounting`, in a session of their own, and never the task's
 * submitter. What: a decision is stated with evidence; the two that keep the sale (`confirm-success`,
 * `apply-corrected`) take effect at once, the two that let money go back (`declare-failure`,
 * `release-after-success`) are a proposal that changes nothing until **another** authorised account approves it.
 * That other account may refuse it instead, which closes it and changes nothing. The account that made a proposal
 * answers it in neither way. While a proposal is open no other decision by a person is taken; the provider's own
 * answer is not a decision and is never held back by one (`ProviderOperationsService.settle`, ADR 0018).
 *
 * A proposal is about the state the operation was in. Once the operation has left that state (the provider
 * answered late, or the settlement ran), the proposal is stale: it cannot be approved, so it moves no money, and
 * another account can only close it.
 */
export function decisionStep(events: readonly DecisionEvent[], actor: DecisionActor, request: DecisionRequest): DecisionStep {
  if (actor.impersonating) return refuse('entered-session');
  if (!authorised(actor)) return refuse('not-authorised');
  if (actor.id === request.submitterId) return refuse('own-task');

  const proposal = openProposal(events);
  // An approved release closed the task and gave its hold back: the operation keeps `succeeded` and its exception
  // as the record of what the provider did, and nothing more is decided about it.
  if (released(events)) return refuse('not-applicable');
  const sequence = events.reduce((highest, event) => Math.max(highest, event.sequence), 0) + 1;
  const phase = phaseOf(request.operation);

  if (request.act === 'decide') {
    if (DECIDES[request.decision] !== phase) return refuse('not-applicable');
    if (proposal) return refuse('proposal-open');
    const missing = evidenceRefusal(request.decision, request.evidence);
    if (missing) return refuse(missing);
    return needsSecondAccount(request.decision)
      ? { ok: true, event: { sequence, type: 'proposed', decision: request.decision }, effect: 'none' }
      : { ok: true, event: { sequence, type: 'applied', decision: request.decision }, effect: request.decision };
  }

  if (!proposal) return refuse('no-proposal');
  // Approving and refusing are both the second account's: the proposer does neither.
  if (proposal.accountId === actor.id) return refuse('own-proposal');
  if (request.act === 'refuse') return { ok: true, event: { sequence, type: 'refused', decision: proposal.decision }, effect: 'none' };
  // Stale: the operation is no longer in the state the proposal was made about. It can only be refused (above).
  if (DECIDES[proposal.decision] !== phase) return refuse('not-applicable');
  return { ok: true, event: { sequence, type: 'approved', decision: proposal.decision }, effect: proposal.decision };
}
