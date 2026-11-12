import type { Copy } from '../../lib/copy';
import type { ApplyReason, DecisionRecord, HoldState, OperationPhase, ProviderDecision } from '../../lib/api-types';

// The words the office shows for a task's provider operation and for the decisions people take on it
// (spec 2026-11-12-provider-operation-screens). One place, so the ticket and the queue say the same.

export function phaseName(t: Copy, phase: OperationPhase | string): string {
  if (phase === 'requested') return t.poRequested;
  if (phase === 'pending') return t.poPending;
  if (phase === 'unknown') return t.poUnknown;
  if (phase === 'unapplied') return t.poUnapplied;
  if (phase === 'applied') return t.poApplied;
  if (phase === 'failed') return t.poFailed;
  if (phase === 'exception') return t.poException;
  return phase;
}

/** One sentence: what the phase means and what can be done about it. */
export function phaseHint(t: Copy, phase: OperationPhase | string): string {
  if (phase === 'requested') return t.poRequestedHint;
  if (phase === 'pending') return t.poPendingHint;
  if (phase === 'unknown') return t.poUnknownHint;
  if (phase === 'unapplied') return t.poUnappliedHint;
  if (phase === 'applied') return t.poAppliedHint;
  if (phase === 'failed') return t.poFailedHint;
  if (phase === 'exception') return t.poExceptionHint;
  return '';
}

export function reasonName(t: Copy, reason: ApplyReason | string): string {
  if (reason === 'number-taken') return t.poReasonNumber;
  if (reason === 'sim-taken') return t.poReasonSim;
  if (reason === 'target-missing') return t.poReasonTarget;
  if (reason === 'esim-code-missing') return t.poReasonEsim;
  return reason;
}

export function holdName(t: Copy, hold: HoldState | string): string {
  if (hold === 'held') return t.holdHeld;
  if (hold === 'captured') return t.holdCaptured;
  if (hold === 'released') return t.holdReleased;
  return '';
}

export function decisionName(t: Copy, decision: ProviderDecision | string): string {
  if (decision === 'confirm-success') return t.decConfirm;
  if (decision === 'declare-failure') return t.decFail;
  if (decision === 'apply-corrected') return t.decCorrect;
  if (decision === 'release-after-success') return t.decRelease;
  return decision;
}

/** What stating the decision does to the line and to the held amount. */
export function decisionEffect(t: Copy, decision: ProviderDecision | string): string {
  if (decision === 'confirm-success') return t.decConfirmEffect;
  if (decision === 'declare-failure') return t.decFailEffect;
  if (decision === 'apply-corrected') return t.decCorrectEffect;
  if (decision === 'release-after-success') return t.decReleaseEffect;
  return '';
}

/** What approving a proposal does to the money. */
export function approveEffect(t: Copy, decision: ProviderDecision | string): string {
  return decision === 'release-after-success' ? t.decReleaseApprove : t.decFailApprove;
}

/** The two decisions that are a proposal for a second account; the other two take effect at once. */
export function isProposal(decision: ProviderDecision | string): boolean {
  return decision === 'declare-failure' || decision === 'release-after-success';
}

/** The two decisions that make the line, and so take the number, the serial and the code. */
export function makesLine(decision: ProviderDecision | string): boolean {
  return decision === 'confirm-success' || decision === 'apply-corrected';
}

export const EVIDENCE_KINDS = ['provider-portal', 'provider-statement', 'provider-answer', 'line-test'] as const;

export function evidenceName(t: Copy, kind: string | null): string {
  if (kind === 'provider-portal') return t.evPortal;
  if (kind === 'provider-statement') return t.evStatement;
  if (kind === 'provider-answer') return t.evAnswer;
  if (kind === 'line-test') return t.evLineTest;
  return kind ?? '';
}

export function stepVerb(t: Copy, type: DecisionRecord['type'] | string): string {
  if (type === 'proposed') return t.evtProposed;
  if (type === 'approved') return t.evtApproved;
  if (type === 'refused') return t.evtRefused;
  if (type === 'applied') return t.evtApplied;
  return type;
}

/** The shortest decision note, counted as the API counts it: without the spaces around it. */
export const MIN_DECISION_NOTE = 20;

/** A refusal that means the operation is no longer where the screen showed it: say so and ask again. */
export function isStale(code: string | undefined): boolean {
  return code === 'DECISION_NOT_APPLICABLE' || code === 'DECISION_PROPOSAL_OPEN' || code === 'DECISION_NO_PROPOSAL' || code === 'DUPLICATE_REQUEST';
}
