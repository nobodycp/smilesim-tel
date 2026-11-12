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
  | { kind: 'confirmed'; providerRef: string | null; result?: ActivationResult | null }
  | { kind: 'refused'; error: OperationError }
  | { kind: 'not-sent'; error: OperationError }
  | { kind: 'no-answer'; error: OperationError };

/** `result` is what a confirmed activation handed back, as it may be stored; null for every other outcome. */
export type Settlement = { status: OperationStatus; providerRef: string | null; error: OperationError | null; result: StoredResult | null };

/** The state a pending operation moves to after attempt number `attempt`. */
export function afterAttempt(outcome: AttemptOutcome, attempt: number): Settlement {
  if (outcome.kind === 'confirmed') return { status: 'succeeded', providerRef: outcome.providerRef, error: null, result: storedResult(outcome.result) };
  if (outcome.kind === 'refused') return { status: 'failed', providerRef: null, error: outcome.error, result: null };
  if (outcome.kind === 'no-answer') return { status: 'unknown', providerRef: null, error: outcome.error, result: null };
  return { status: attempt >= MAX_ATTEMPTS ? 'failed' : 'requested', providerRef: null, error: outcome.error, result: null };
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
  | { left: true; answer: 'confirmed'; providerRef: string | null; result?: ActivationResult | null }
  | { left: true; answer: 'refused'; error: OperationError }
  | { left: true; answer: 'none'; error: OperationError };

/**
 * The outcome an attempt is settled with. No evidence at all (the adapter threw, or the wait ran out) is treated
 * as "it may have left": never `not-sent`.
 */
export function outcomeOf(evidence: SendEvidence | null): AttemptOutcome {
  if (!evidence) return { kind: 'no-answer', error: 'no-evidence' };
  if (!evidence.left) return { kind: 'not-sent', error: evidence.error };
  if (evidence.answer === 'confirmed') return { kind: 'confirmed', providerRef: evidence.providerRef, result: evidence.result ?? null };
  if (evidence.answer === 'refused') return { kind: 'refused', error: evidence.error };
  return { kind: 'no-answer', error: evidence.error };
}

/** A late answer may close an operation that recovery marked unknown, when it says what the provider did. */
export function closesUnknown(outcome: AttemptOutcome): boolean {
  return outcome.kind === 'confirmed' || outcome.kind === 'refused';
}

/**
 * Whether an attempt still belongs to the worker that claimed it. While it does, that worker may start the send
 * and recovery keeps away; once it does not, the worker may no longer start and recovery may act. The store
 * applies the same test inside the write that marks the send (`leaseUntil > now`).
 */
export function leaseRuns(leaseUntil: Date | null, now: Date): boolean {
  return leaseUntil !== null && leaseUntil.getTime() > now.getTime();
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
  if (leaseRuns(attempt.leaseUntil, now)) return null;
  if (attempt.leaseUntil && !attempt.sentAt) return { kind: 'not-sent', error: 'abandoned' };
  return { kind: 'no-answer', error: 'abandoned' };
}

/** What closes an unknown operation: an answer about the request already sent, never a new send. */
export type Verdict = { status: 'succeeded'; providerRef: string | null; result?: ActivationResult | null } | { status: 'failed'; error: OperationError };

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

/**
 * What a provider hands back with a confirmed activation (ADR 0019, D11): the number it assigned, the serial it
 * issued, and for an eSIM the activation code. Each part is there only when the provider chose it; a part the
 * seller gave comes back empty. The activation code is a secret: it is sealed before it is stored and is never
 * logged, queued or put in a notice (D17). It never appears in an error or a log line built from an outcome.
 */
export type ActivationResult = { msisdn?: string | null; iccid?: string | null; esimCode?: string | null };

/** The same, as it may be stored: every part present, trimmed and bounded, or null. */
export type StoredResult = { msisdn: string | null; iccid: string | null; esimCode: string | null };

export const RESULT_LIMITS = { msisdn: 20, iccid: 22, esimCode: 512 } as const;

/**
 * A confirmed activation's result as it may be stored: digits only for the number and the serial, the code as
 * given; each trimmed; a part that is empty, too long, or not what it should be is dropped, not cut (half a
 * serial is worse than none). Null when nothing usable was handed back.
 */
export function storedResult(result: ActivationResult | null | undefined): StoredResult | null {
  if (!result) return null;
  const digits = (value: string | null | undefined, max: number) => {
    const text = value?.trim() ?? '';
    return /^\d+$/.test(text) && text.length <= max ? text : null;
  };
  const code = result.esimCode?.trim() ?? '';
  const stored: StoredResult = {
    msisdn: digits(result.msisdn, RESULT_LIMITS.msisdn),
    iccid: digits(result.iccid, RESULT_LIMITS.iccid),
    esimCode: code && code.length <= RESULT_LIMITS.esimCode ? code : null,
  };
  return stored.msisdn || stored.iccid || stored.esimCode ? stored : null;
}

/**
 * The outbox sequence of an operation's `settled` message. The outbox holds one message per (topic, operation,
 * sequence), so two writers of the same verdict cannot both commit. An attempt has at most two verdicts: the
 * one that ends it (`pending` → a verdict, or recovery's `unknown`), and the late one that closes that `unknown`.
 */
export function settledSequence(attempt: number, closesUnknown: boolean): number {
  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('an attempt number that cannot order a message');
  return attempt * 2 + (closesUnknown ? 1 : 0);
}

/** A provider's reference as it is stored: trimmed, at most 120 characters, or nothing. */
export function storedRef(ref: string | null): string | null {
  const text = ref?.trim().slice(0, 120);
  return text ? text : null;
}
