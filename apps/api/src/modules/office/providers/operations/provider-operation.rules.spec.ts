import { MAX_ATTEMPTS, OPERATION_STATUSES, afterAttempt, canMove, isSettled, maySend, requestHash, storedRef, validKey, type OperationRequest, type OperationStatus } from './provider-operation.rules';

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
    expect(afterAttempt({ kind: 'confirmed', providerRef: 'R-1' }, 1)).toEqual({ status: 'succeeded', providerRef: 'R-1', error: null });
    expect(afterAttempt({ kind: 'refused', error: 'refused' }, 1)).toEqual({ status: 'failed', providerRef: null, error: 'refused' });
    // The request left and nothing came back: not a failure, and not sent again.
    expect(afterAttempt({ kind: 'no-answer', error: 'timeout' }, 1)).toEqual({ status: 'unknown', providerRef: null, error: 'timeout' });
    expect(afterAttempt({ kind: 'no-answer', error: 'connection-lost' }, MAX_ATTEMPTS)).toMatchObject({ status: 'unknown' });
  });

  it('sends again only what never left, and only so many times', () => {
    expect(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, 1)).toMatchObject({ status: 'requested', error: 'unreachable' });
    expect(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, MAX_ATTEMPTS - 1)).toMatchObject({ status: 'requested' });
    expect(afterAttempt({ kind: 'not-sent', error: 'unreachable' }, MAX_ATTEMPTS)).toMatchObject({ status: 'failed', error: 'unreachable' });
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
