import { Injectable } from '@nestjs/common';
import { fail } from '../../../shared/office-failure';
import { UnitOfWork, type Db } from '../../kernel/unit-of-work';
import type { Action } from '../../kernel/types';
import { ATTEMPT_LEASE_MS, afterAttempt, attemptAfter, canMove, closesUnknown, maySend, recoveryOutcome, requestHash, storedRef, validKey, type AttemptOutcome, type OperationRequest, type OperationStatus, type OutgoingOperation, type Verdict } from './provider-operation.rules';
import { OPERATION_REQUESTED, ProviderOperationsRepository } from './provider-operations.repository';

export type RecordedOperation = { id: string; status: OperationStatus; created: boolean };

/**
 * The durable record of what is asked of a provider (ADR 0017). It sends nothing: a later dispatcher reads the
 * outbox, claims the operation, calls the provider outside any transaction, and reports what came back here.
 *
 * At-least-once on our side, exactly-once only where the provider honours the idempotency key: the key is what
 * the adapter sends with every attempt of the same operation.
 */
@Injectable()
export class ProviderOperationsService {
  constructor(private readonly uow: UnitOfWork, private readonly repo: ProviderOperationsRepository) {}

  /** Records the operation and its outbox message in one transaction of its own. */
  record(idempotencyKey: string, request: OperationRequest): Promise<RecordedOperation> {
    return this.uow.runTx((tx) => this.recordIn(tx, idempotencyKey, request));
  }

  /**
   * Records the operation inside the caller's transaction, so it commits or rolls back with the caller's own
   * writes. The same key with the same request answers the first operation and writes nothing; the same key with
   * another request is refused.
   */
  async recordIn(tx: Db, idempotencyKey: string, request: OperationRequest): Promise<RecordedOperation> {
    if (!validKey(idempotencyKey)) fail(400, 'INVALID');
    const providerId = await this.repo.providerIdByCode(tx, request.providerCode);
    if (!providerId) fail(404, 'NOT_FOUND');
    const hash = requestHash(request);
    const { action, packageCode, msisdn, iccid, lineId } = request;
    const id = await this.repo.insertUnlessKeyTaken(tx, { idempotencyKey, requestHash: hash, providerId, action, packageCode, msisdn, iccid, lineId });
    if (id) {
      await this.repo.addOutbox(tx, OPERATION_REQUESTED, id, 0);
      return { id, status: 'requested', created: true };
    }
    // The insert waited for whoever held the key; their row is committed and visible to this statement.
    const first = await this.repo.operationByKey(tx, idempotencyKey);
    if (!first || first.requestHash !== hash) fail(400, 'INVALID');
    return { id: first.id, status: first.status as OperationStatus, created: false };
  }

  /** Where an operation stands, by its id or by the key it was recorded with. */
  async status(by: { id: string } | { idempotencyKey: string }) {
    const row = 'id' in by ? await this.repo.operationById(this.uow.prisma, by.id) : await this.repo.operationByKey(this.uow.prisma, by.idempotencyKey);
    if (!row) fail(404, 'NOT_FOUND');
    return { id: row.id, status: row.status as OperationStatus, providerRef: row.providerRef, attempts: row.attempts, lastError: row.lastError, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  /**
   * Takes the operation for one attempt: `requested` → `pending`, counted and leased to the caller for
   * `ATTEMPT_LEASE_MS`. Answers the attempt's number, which the caller hands back with the result, or null when
   * the operation is not there to take (another worker has it, it is settled, or it is unknown). Committed
   * before the provider is called, so a process that dies mid-call leaves `pending`, never a second send.
   */
  async claim(id: string, now: Date = new Date()): Promise<number | null> {
    const row = await this.repo.operationById(this.uow.prisma, id);
    if (!row) fail(404, 'NOT_FOUND');
    if (!maySend(row.status as OperationStatus)) return null;
    // Compare-and-set on the count: of two workers that read the same row, one moves it.
    const claim = { at: now, leaseUntil: new Date(now.getTime() + ATTEMPT_LEASE_MS) };
    const taken = await this.repo.moveStatus(this.uow.prisma, id, { status: 'requested', attempts: row.attempts }, { status: 'pending', error: null, claim });
    return taken ? attemptAfter(row.attempts) : null;
  }

  /**
   * Marks attempt `attempt` as about to be sent and answers what to send; null when the attempt is no longer the
   * caller's (recovery took it back, or it was marked before). The caller calls the provider only on an answer:
   * that makes "no mark" proof that nothing left.
   */
  async beginSend(id: string, attempt: number, now: Date = new Date()): Promise<OutgoingOperation | null> {
    const row = await this.repo.operationToSend(this.uow.prisma, id);
    if (!row || !(await this.repo.markSent(this.uow.prisma, id, attempt, now))) return null;
    return { idempotencyKey: row.idempotencyKey, attempt, action: row.action as Action, providerCode: row.provider.code, packageCode: row.packageCode, msisdn: row.msisdn, iccid: row.iccid };
  }

  /**
   * Writes what attempt number `attempt` came to. Refused unless the operation is `pending` on that very attempt:
   * an answer that arrives late, after the operation was taken again, changes nothing. When the operation goes
   * back to `requested` (the request never left), the message that schedules its next send is written in the
   * same transaction. One late answer is still taken: the provider's own verdict on an attempt that recovery had
   * marked unknown.
   */
  settle(id: string, attempt: number, outcome: AttemptOutcome): Promise<OperationStatus> {
    return this.uow.runTx(async (tx) => {
      if (!(await this.repo.operationById(tx, id))) fail(404, 'NOT_FOUND');
      const next = afterAttempt(outcome, attempt);
      if (!canMove('pending', next.status)) fail(409, 'DUPLICATE_REQUEST');
      const change = { status: next.status, providerRef: storedRef(next.providerRef), error: next.error };
      const moved = await this.repo.moveStatus(tx, id, { status: 'pending', attempts: attempt }, change);
      const late = !moved && closesUnknown(outcome) && (await this.repo.moveStatus(tx, id, { status: 'unknown', attempts: attempt }, change));
      if (!moved && !late) fail(409, 'DUPLICATE_REQUEST');
      if (maySend(next.status)) await this.repo.addOutbox(tx, OPERATION_REQUESTED, id, attempt);
      return next.status;
    });
  }

  /** Closes an unknown operation with an answer about the request already sent. It never sends again. */
  async resolveUnknown(id: string, verdict: Verdict): Promise<void> {
    const change = verdict.status === 'succeeded' ? { status: verdict.status, providerRef: storedRef(verdict.providerRef), error: null } : { status: verdict.status, error: verdict.error };
    const moved = await this.repo.moveStatus(this.uow.prisma, id, { status: 'unknown' }, change);
    if (!moved) fail(409, 'DUPLICATE_REQUEST');
  }

  /** The pending operations recovery should look at now. */
  expiredPending(now: Date, limit: number): Promise<string[]> {
    return this.repo.expiredPendingIds(this.uow.prisma, now, limit);
  }

  /**
   * Recovers one pending attempt whose worker is gone (`recoveryOutcome`): back to `requested` with its next
   * message when the send mark proves nothing left, `unknown` when the provider may have been called. Answers the
   * new status, or null when there was nothing to do (the lease still runs, or a worker settled it meanwhile).
   */
  recover(id: string, now: Date = new Date()): Promise<OperationStatus | null> {
    return this.uow.runTx(async (tx) => {
      const row = await this.repo.operationById(tx, id);
      if (!row || row.status !== 'pending') return null;
      const outcome = recoveryOutcome(row, now);
      if (!outcome) return null;
      const next = afterAttempt(outcome, row.attempts);
      // Guarded by the attempt, and for "never sent" by the mark still being empty: a worker that writes the
      // mark first keeps the attempt, and one that comes after finds it gone and does not call the provider.
      const expected = { status: 'pending' as const, attempts: row.attempts, ...(outcome.kind === 'not-sent' ? { unsent: true as const } : {}) };
      if (!(await this.repo.moveStatus(tx, id, expected, { status: next.status, error: next.error }))) return null;
      if (maySend(next.status)) await this.repo.addOutbox(tx, OPERATION_REQUESTED, id, row.attempts);
      return next.status;
    });
  }
}
