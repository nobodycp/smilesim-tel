import { createHash } from 'node:crypto';
import type { Action } from '../../kernel/types';

// The life of one operation asked of a provider (ADR 0017). Pure: no Nest, no Prisma, no HTTP.
//
//   requested ──claim──▶ pending ──▶ succeeded
//       │                   │──────▶ failed
//       │                   │──────▶ unknown ──(status check or a person)──▶ succeeded | failed
//       │                   └──(never sent)──▶ requested
//       └──(never sent, given up)──▶ failed
//
// `unknown` is the state that protects money: the request may have reached the provider, so it is never sent
// again. Only an answer about that same request (the provider's status check, or a person who looked) closes it.

export const OPERATION_STATUSES = ['requested', 'pending', 'succeeded', 'failed', 'unknown'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/** Why an attempt did not succeed. Codes only: a provider's own message may carry what must not be stored. */
export const OPERATION_ERRORS = ['not-connected', 'unreachable', 'timeout', 'connection-lost', 'refused', 'invalid-request', 'provider-error', 'abandoned'] as const;
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

/** The state a pending operation moves to after an attempt; `attempts` counts this one. */
export function afterAttempt(outcome: AttemptOutcome, attempts: number): Settlement {
  if (outcome.kind === 'confirmed') return { status: 'succeeded', providerRef: outcome.providerRef, error: null };
  if (outcome.kind === 'refused') return { status: 'failed', providerRef: null, error: outcome.error };
  if (outcome.kind === 'no-answer') return { status: 'unknown', providerRef: null, error: outcome.error };
  return { status: attempts >= MAX_ATTEMPTS ? 'failed' : 'requested', providerRef: null, error: outcome.error };
}

/** What closes an unknown operation: an answer about the request already sent, never a new send. */
export type Verdict = { status: 'succeeded'; providerRef: string | null } | { status: 'failed'; error: OperationError };

/** What is asked of the provider. It holds no credential: those belong to the adapter that sends it. */
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
