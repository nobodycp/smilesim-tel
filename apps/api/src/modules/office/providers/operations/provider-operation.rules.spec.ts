import { ATTEMPT_LEASE_MS, CALL_TIMEOUT_MS, MAX_ATTEMPTS, OPERATION_STATUSES, afterAttempt, attemptAfter, spentAttempts, canMove, RESULT_LIMITS, closesUnknown, leaseRuns, outcomeOf, recoveryOutcome, storedResult, isSettled, maySend, requestHash, settledSequence, storedRef, validKey, type OperationRequest, type OperationStatus } from './provider-operation.rules';

const request: OperationRequest = { action: 'activate', providerCode: 'sky', packageCode: 'p-1', msisdn: '0500000001', iccid: '8997202000000000777', lineId: null };

describe('provider operation rules', () => {
  it('allows exactly these moves between states', () => {
    const allowed: Record<OperationStatus, OperationStatus[]> = {
      requested: ['pending', 'failed'],
      pending: ['requested', 'succeeded', 'failed', 'unknown'],
      unknown: ['succeeded', 'failed'],
      succeeded: [],
      failed: [],
    };
    for (const from of OPERATION_STATUSES) {
      for (const to of OPERATION_STATUSES) expect([from, to, canMove(from, to)]).toEqual([from, to, allowed[from].includes(to)]);
    }
  });

  it('never sends an operation that may already have reached the provider', () => {
    expect(OPERATION_STATUSES.filter(maySend)).toEqual(['requested']);
    // Unknown leaves only by an answer, never back to a state that is sent.
    expect(canMove('unknown', 'requested')).toBe(false);
    expect(canMove('unknown', 'pending')).toBe(false);
    expect(OPERATION_STATUSES.filter(isSettled)).toEqual(['succeeded', 'failed']);
  });

  it('settles an attempt by what is known about it', () => {
    expect(afterAttempt({ kind: 'confirmed', providerRef: 'R-1' }, 1)).toEqual({ status: 'succeeded', providerRef: 'R-1', error: null, result: null });
    expect(afterAttempt({ kind: 'refused', error: 'refused' }, 1)).toEqual({ status: 'failed', providerRef: null, error: 'refused', result: null });
    // The request left and nothing came back: not a failure, and not sent again.
    expect(afterAttempt({ kind: 'no-answer', error: 'timeout' }, 1)).toEqual({ status: 'unknown', providerRef: null, error: 'timeout', result: null });
    expect(afterAttempt({ kind: 'no-answer', error: 'connection-lost' }, MAX_ATTEMPTS)).toMatchObject({ status: 'unknown' });
  });

  it('counts against the budget only the attempts that were not waived, and never reduces an attempt\'s number', () => {
    expect([spentAttempts(0, 0), spentAttempts(1, 0), spentAttempts(5, 0), spentAttempts(6, 5), spentAttempts(7, 2)]).toEqual([0, 1, 5, 1, 5]);
    // Nonsense in is nothing spent, never a negative count that would buy extra attempts.
    expect([spentAttempts(2, 9), spentAttempts(3, -4)]).toEqual([0, 3]);
    // Five attempts handed back by a closed gate, then one that did not leave: it is the first of the five, not the sixth.
    expect(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, spentAttempts(6, 5))).toMatchObject({ status: 'requested' });
    // And five that were counted fail the operation whatever was waived between them.
    expect(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, spentAttempts(MAX_ATTEMPTS + 3, 3))).toMatchObject({ status: 'failed' });
    // The number of the next attempt comes from the attempts taken, waived or not: it is never used twice.
    expect([attemptAfter(5), settledSequence(6, false), settledSequence(6, true)]).toEqual([6, 12, 13]);
  });

  it('sends again only what never left, and only so many times', () => {
    expect(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, 1)).toMatchObject({ status: 'requested', error: 'unreachable' });
    expect(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, MAX_ATTEMPTS - 1)).toMatchObject({ status: 'requested' });
    expect(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, MAX_ATTEMPTS)).toMatchObject({ status: 'failed', error: 'unreachable' });
  });

  it('numbers attempts from 1, and schedules a new send only for a state that may be sent', () => {
    expect([attemptAfter(0), attemptAfter(1), attemptAfter(4)]).toEqual([1, 2, 5]);
    const next = (kind: 'confirmed' | 'refused' | 'not-sent' | 'no-answer') => afterAttempt(kind === 'confirmed' ? { kind, providerRef: null } : { kind, error: 'timeout' }, 1).status;
    expect((['confirmed', 'refused', 'not-sent', 'no-answer'] as const).map((kind) => [kind, maySend(next(kind))])).toEqual([['confirmed', false], ['refused', false], ['not-sent', true], ['no-answer', false]]);
    // The last allowed attempt that never left is failed, not scheduled again.
    expect(maySend(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, MAX_ATTEMPTS).status)).toBe(false);
  });

  it('calls an attempt not-sent only on the adapter\'s own statement that nothing left', () => {
    expect(outcomeOf({ left: false, error: 'unreachable' })).toEqual({ kind: 'not-sent', error: 'unreachable' });
    expect(outcomeOf({ left: true, answer: 'confirmed', providerRef: 'R' })).toEqual({ kind: 'confirmed', providerRef: 'R', result: null });
    expect(outcomeOf({ left: true, answer: 'refused', error: 'refused' })).toEqual({ kind: 'refused', error: 'refused' });
    expect(outcomeOf({ left: true, answer: 'none', error: 'timeout' })).toEqual({ kind: 'no-answer', error: 'timeout' });
    // No evidence at all is never "not sent".
    expect(outcomeOf(null)).toEqual({ kind: 'no-answer', error: 'no-evidence' });
    expect(afterAttempt(outcomeOf(null), 1).status).toBe('unknown');
  });

  it('recovers a pending attempt by its lease and its send mark, not by its age', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const before = new Date(now.getTime() - 1);
    const later = new Date(now.getTime() + 1);
    // The lease runs: a worker may be on it, whatever else is true.
    expect(recoveryOutcome({ leaseUntil: later, sentAt: null }, now)).toBeNull();
    expect(recoveryOutcome({ leaseUntil: later, sentAt: before }, now)).toBeNull();
    expect(recoveryOutcome({ leaseUntil: now, sentAt: null }, now)).toEqual({ kind: 'not-sent', error: 'abandoned' });
    // Over, and never marked: it provably did not leave.
    expect(recoveryOutcome({ leaseUntil: before, sentAt: null }, now)).toEqual({ kind: 'not-sent', error: 'abandoned' });
    // Over, and marked: it may be at the provider. Unknown, never failed.
    expect(recoveryOutcome({ leaseUntil: before, sentAt: before }, now)).toEqual({ kind: 'no-answer', error: 'abandoned' });
    expect(afterAttempt({ kind: 'no-answer', error: 'abandoned' }, 1).status).toBe('unknown');
    // No lease recorded: nothing proves it unsent.
    expect(recoveryOutcome({ leaseUntil: null, sentAt: null }, now)).toEqual({ kind: 'no-answer', error: 'abandoned' });
    expect(ATTEMPT_LEASE_MS).toBeGreaterThan(CALL_TIMEOUT_MS);
  });

  it('gives an attempt to its worker while the lease runs and to recovery from the instant it ends', () => {
    const end = new Date('2026-11-10T12:00:00Z');
    const at = (ms: number) => new Date(end.getTime() + ms);
    expect([leaseRuns(end, at(-1)), leaseRuns(end, at(0)), leaseRuns(end, at(1)), leaseRuns(null, at(-1))]).toEqual([true, false, false, false]);
    // Never both, never neither: recovery acts exactly when the worker may no longer start.
    for (const ms of [-60_000, -1, 0, 1, 60_000]) {
      expect(recoveryOutcome({ leaseUntil: end, sentAt: null }, at(ms)) !== null).toBe(!leaseRuns(end, at(ms)));
    }
  });

  it('lets only the provider\'s own verdict close an unknown operation late', () => {
    expect([closesUnknown({ kind: 'confirmed', providerRef: null }), closesUnknown({ kind: 'refused', error: 'refused' })]).toEqual([true, true]);
    expect([closesUnknown({ kind: 'no-answer', error: 'timeout' }), closesUnknown({ kind: 'not-sent', error: 'unreachable' })]).toEqual([false, false]);
  });

  it('carries what a confirmed activation handed back from the evidence to the settlement, and nothing for any other outcome', () => {
    const result = { msisdn: '0501234567', iccid: '8997201234567890123', esimCode: 'LPA:1$smdp.example.com$CODE-123' };
    const outcome = outcomeOf({ left: true, answer: 'confirmed', providerRef: 'R', result });
    expect(outcome).toEqual({ kind: 'confirmed', providerRef: 'R', result });
    expect(afterAttempt(outcome, 1)).toEqual({ status: 'succeeded', providerRef: 'R', error: null, result });
    // A provider that hands nothing back, and every outcome that is not a confirmation, settle with no result.
    expect(afterAttempt(outcomeOf({ left: true, answer: 'confirmed', providerRef: 'R', result: null }), 1).result).toBeNull();
    for (const evidence of [{ left: true, answer: 'refused', error: 'refused' }, { left: true, answer: 'none', error: 'timeout' }, { left: false, error: 'unreachable' }] as const) {
      expect(afterAttempt(outcomeOf(evidence), 1).result).toBeNull();
    }
    expect(afterAttempt(outcomeOf(null), 1).result).toBeNull();
  });

  it('stores a result trimmed and whole: a part that is empty, too long or not digits is dropped, never cut', () => {
    expect(storedResult({ msisdn: ' 0501234567 ', iccid: '8997201234567890123', esimCode: ' LPA:1$a$b ' })).toEqual({ msisdn: '0501234567', iccid: '8997201234567890123', esimCode: 'LPA:1$a$b' });
    // Only what the provider chose: the rest is null.
    expect(storedResult({ msisdn: '0501234567' })).toEqual({ msisdn: '0501234567', iccid: null, esimCode: null });
    expect(storedResult({ esimCode: 'CODE' })).toEqual({ msisdn: null, iccid: null, esimCode: 'CODE' });
    // Not digits, or longer than the field: dropped.
    expect(storedResult({ msisdn: '05-0123', iccid: '8997 2012', esimCode: 'ok' })).toEqual({ msisdn: null, iccid: null, esimCode: 'ok' });
    expect(storedResult({ msisdn: '1'.repeat(RESULT_LIMITS.msisdn + 1), iccid: '1'.repeat(RESULT_LIMITS.iccid + 1), esimCode: 'x'.repeat(RESULT_LIMITS.esimCode + 1) })).toBeNull();
    expect(storedResult({ msisdn: '1'.repeat(RESULT_LIMITS.msisdn), iccid: '1'.repeat(RESULT_LIMITS.iccid), esimCode: 'x'.repeat(RESULT_LIMITS.esimCode) })).not.toBeNull();
    // Nothing usable is nothing.
    for (const empty of [null, undefined, {}, { msisdn: '', iccid: '   ', esimCode: null }]) expect(storedResult(empty)).toBeNull();
  });

  it('accepts a key of 8 to 120 safe characters', () => {
    expect(['activate:0500000001:7f3a', 'a'.repeat(8), 'A_b.c-d:1'.padEnd(120, 'x')].map(validKey)).toEqual([true, true, true]);
    expect(['', 'short', 'a'.repeat(121), 'has space in it', 'semi;colon;key', 'مفتاح-عربي-123'].map(validKey)).toEqual([false, false, false, false, false, false]);
  });

  it('gives one request one fingerprint, and another request another', () => {
    expect(requestHash(request)).toBe(requestHash({ ...request }));
    expect(requestHash(request)).toMatch(/^[0-9a-f]{64}$/);
    const others: OperationRequest[] = [
      { ...request, action: 'extend' },
      { ...request, providerCode: 'other' },
      { ...request, packageCode: 'p-2' },
      { ...request, msisdn: '0500000002' },
      { ...request, iccid: null },
      { ...request, lineId: 'line-1' },
    ];
    expect(new Set([request, ...others].map(requestHash)).size).toBe(7);
  });

  it('stores a provider reference trimmed and bounded', () => {
    expect([storedRef(' R-1 '), storedRef(''), storedRef('   '), storedRef(null), storedRef('x'.repeat(300))?.length]).toEqual(['R-1', null, null, null, 120]);
  });
});

describe('the sequence of a verdict message (ADR 0019, D8)', () => {
  it('gives every verdict of every attempt its own sequence: the one that ends the attempt, and the late one that closes its unknown', () => {
    const all = [1, 2, 3, 4, 5].flatMap((attempt) => [settledSequence(attempt, false), settledSequence(attempt, true)]);
    expect(new Set(all).size).toBe(10);
    expect([settledSequence(1, false), settledSequence(1, true), settledSequence(2, false)]).toEqual([2, 3, 4]);
    expect(() => settledSequence(-1, false)).toThrow(RangeError);
    expect(() => settledSequence(1.5, true)).toThrow(RangeError);
  });
});

