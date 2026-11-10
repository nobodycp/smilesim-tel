import { createHash } from 'node:crypto';
import type { Action } from '../../kernel/types';

// The life of one operation asked of a provider (ADR 0017). Pure: no Nest, no Prisma, no HTTP.
//
//   requested ──claim──▶ pending ──(sentAt)──▶ succeeded
//       │                   │──────▶ failed
//       │                   │──────▶ unknown ──(status check or a person)──▶ succeeded | failed
//       │                   └──(never sent)──▶ requested, with a new outbox message
//       └──(never sent, given up)──▶ failed
//
// `unknown` is the state that protects money: the request may have reached the provider, so it is never sent
// again. Only an answer about that same request (the provider's status check, or a person who looked) closes it.

export const OPERATION_STATUSES = ['requested', 'pending', 'succeeded', 'failed', 'unknown'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/** Why an attempt did not succeed. Codes only: a provider's own message may carry what must not be stored. */
export const OPERATION_ERRORS = ['not-connected', 'unreachable', 'timeout', 'connection-lost', 'refused', 'invalid-request', 'provider-error', 'abandoned', 'no-evidence'] as const;
export type OperationError = (typeof OPERATION_ERRORS)[number];

/** How many times one operation may be sent while every earlier attempt is known not to have left. */
export const MAX_ATTEMPTS = 5;

const MOVES: Record<OperationStatus, readonly OperationStatus[]> = {
  requested: ['pending', 'failed'],
  pending: ['succeeded', 'failed', 'unknown', 'requested'],
  unknown: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
};

/**
 * An attempt is named by its number: the first is 1, and each claim makes the next. A result is accepted only for
 * the attempt the operation is on, so an answer from an earlier attempt can never settle a later one.
 */
export function attemptAfter(attemptsMade: number): number {
  return attemptsMade + 1;
}

export function canMove(from: OperationStatus, to: OperationStatus): boolean {
  return MOVES[from].includes(to);
}

export function isSettled(status: OperationStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

/** Only an operation that has never left may be sent. `unknown` and `pending` may have reached the provider. */
export function maySend(status: OperationStatus): boolean {
  return status === 'requested';
}

/**
 * What one attempt came to:
 * - `confirmed`: the provider said it ran the operation.
 * - `refused`: the provider answered and did not run it.
 * - `not-sent`: the request is known not to have left (no connection was made).
 * - `no-answer`: the request left, or may have, and no answer came back.
 */
export type AttemptOutcome =
  | { kind: 'confirmed'; providerRef: string | null }
  | { kind: 'refused'; error: OperationError }
  | { kind: 'not-sent'; error: OperationError }
  | { kind: 'no-answer'; error: OperationError };

export type Settlement = { status: OperationStatus; providerRef: string | null; error: OperationError | null };

/** The state a pending operation moves to after attempt number `attempt`. */
export function afterAttempt(outcome: AttemptOutcome, attempt: number): Settlement {
  if (outcome.kind === 'confirmed') return { status: 'succeeded', providerRef: outcome.providerRef, error: null };
  if (outcome.kind === 'refused') return { status: 'failed', providerRef: null, error: outcome.error };
  if (outcome.kind === 'no-answer') return { status: 'unknown', providerRef: null, error: outcome.error };
  return { status: attempt >= MAX_ATTEMPTS ? 'failed' : 'requested', providerRef: null, error: outcome.error };
}

/** How long the provider is given to answer one attempt before the dispatcher stops waiting. */
export const CALL_TIMEOUT_MS = 30_000;
/**
 * How long a claimed attempt belongs to its worker: the call's own timeout and room to write the result. Only
 * after it may recovery touch the operation, so recovery and a working worker never act on the same attempt.
 */
export const ATTEMPT_LEASE_MS = CALL_TIMEOUT_MS + 60_000;

/**
 * What an adapter knows about one send. `left: false` is a statement, not a guess: no connection was opened and
 * no byte of the request was written. Anything less certain is `left: true`.
 */
export type SendEvidence =
  | { left: false; error: OperationError }
  | { left: true; answer: 'confirmed'; providerRef: string | null }
  | { left: true; answer: 'refused'; error: OperationError }
  | { left: true; answer: 'none'; error: OperationError };

/**
 * The outcome an attempt is settled with. No evidence at all (the adapter threw, or the wait ran out) is treated
 * as "it may have left": never `not-sent`.
 */
export function outcomeOf(evidence: SendEvidence | null): AttemptOutcome {
  if (!evidence) return { kind: 'no-answer', error: 'no-evidence' };
  if (!evidence.left) return { kind: 'not-sent', error: evidence.error };
  if (evidence.answer === 'confirmed') return { kind: 'confirmed', providerRef: evidence.providerRef };
  if (evidence.answer === 'refused') return { kind: 'refused', error: evidence.error };
  return { kind: 'no-answer', error: evidence.error };
}

/** A late answer may close an operation that recovery marked unknown, when it says what the provider did. */
export function closesUnknown(outcome: AttemptOutcome): boolean {
  return outcome.kind === 'confirmed' || outcome.kind === 'refused';
}

/** What a pending attempt looks like to recovery. */
export type PendingAttempt = { leaseUntil: Date | null; sentAt: Date | null };

/**
 * What recovery does with a pending attempt at `now`:
 * - `null` while its lease runs: a worker may still be on it.
 * - `not-sent` when the lease is over and the send mark was never written: the request provably did not leave.
 * - `no-answer` otherwise: the provider may have been called, so the operation becomes unknown, never failed and
 *   never sent again. An attempt with no lease at all cannot be proved unsent either.
 */
export function recoveryOutcome(attempt: PendingAttempt, now: Date): AttemptOutcome | null {
  if (attempt.leaseUntil && attempt.leaseUntil.getTime() > now.getTime()) return null;
  if (attempt.leaseUntil && !attempt.sentAt) return { kind: 'not-sent', error: 'abandoned' };
  return { kind: 'no-answer', error: 'abandoned' };
}

/** What closes an unknown operation: an answer about the request already sent, never a new send. */
export type Verdict = { status: 'succeeded'; providerRef: string | null } | { status: 'failed'; error: OperationError };

/** What is asked of the provider. It holds no credential: those belong to the adapter that sends it. */
/** What the dispatcher hands the gateway: the request, the key the provider dedupes on, and the attempt. */
export type OutgoingOperation = { idempotencyKey: string; attempt: number; action: Action; providerCode: string; packageCode: string; msisdn: string | null; iccid: string | null };

export type OperationRequest = {
  action: Action;
  providerCode: string;
  packageCode: string;
  msisdn: string | null;
  iccid: string | null;
  lineId: string | null;
};

/** A caller's key for one operation: 8 to 120 letters, digits, `.`, `_`, `:` or `-`. */
export function validKey(key: string): boolean {
  return /^[A-Za-z0-9._:-]{8,120}$/.test(key);
}

/** The fingerprint that says whether a key came back with the request it was first used for. */
export function requestHash(request: OperationRequest): string {
  const fields = [request.action, request.providerCode, request.packageCode, request.msisdn, request.iccid, request.lineId];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** A provider's reference as it is stored: trimmed, at most 120 characters, or nothing. */
export function storedRef(ref: string | null): string | null {
  const text = ref?.trim().slice(0, 120);
  return text ? text : null;
}
