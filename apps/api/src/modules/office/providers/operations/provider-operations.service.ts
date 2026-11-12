import { Injectable } from '@nestjs/common';
import { fail } from '../../../shared/office-failure';
import { isSealed, seal } from '../../../shared/secret-box';
import { UnitOfWork, type Db } from '../../kernel/unit-of-work';
import type { Action } from '../../kernel/types';
import { ATTEMPT_LEASE_MS, afterAttempt, attemptAfter, canMove, closesUnknown, maySend, recoveryOutcome, requestHash, settledSequence, storedRef, storedResult, validKey, type ActivationResult, type AttemptOutcome, type OperationError, type OperationRequest, type OperationStatus, type OutgoingOperation, type StoredResult, type Verdict } from './provider-operation.rules';
import { OPERATION_REQUESTED, OPERATION_SETTLED, ProviderOperationsRepository, type NewDecisionEvent, type ResultColumns } from './provider-operations.repository';

/**
 * A confirmed activation's result as the columns hold it (ADR 0019, D11 and D17): the eSIM code sealed. A code
 * that cannot be sealed is not stored in the clear and not dropped: the write is refused, so the verdict is not
 * recorded and the attempt ends as unknown, for the provider's own answer or a person to close.
 */
function resultColumns(result: StoredResult | null): ResultColumns | null {
  if (!result) return null;
  if (!result.esimCode) return { msisdn: result.msisdn, iccid: result.iccid, sealedEsimCode: null };
  // `seal` leaves alone a value that already has the sealed form, and one it has no key for.
  const sealed = isSealed(result.esimCode) ? '' : seal(result.esimCode);
  if (!isSealed(sealed)) throw new Error('a provider result carries an eSIM code that cannot be sealed');
  return { msisdn: result.msisdn, iccid: result.iccid, sealedEsimCode: sealed };
}

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
   * caller's: its lease is over (the worker was slow, and recovery may take the attempt back at any moment),
   * recovery already took it, or it was marked before. The caller calls the provider only on an answer: that
   * makes "no mark" proof that nothing left.
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
  async settle(id: string, attempt: number, outcome: AttemptOutcome): Promise<OperationStatus> {
    const next = afterAttempt(outcome, attempt);
    // What the provider handed back is made storable before the transaction: its eSIM code sealed, or refused.
    const result = resultColumns(next.result);
    return this.uow.runTx(async (tx) => {
      if (!(await this.repo.operationById(tx, id))) fail(404, 'NOT_FOUND');
      if (!canMove('pending', next.status)) fail(409, 'DUPLICATE_REQUEST');
      const change = { status: next.status, providerRef: storedRef(next.providerRef), error: next.error, result };
      const moved = await this.repo.moveStatus(tx, id, { status: 'pending', attempts: attempt }, change);
      const late = !moved && closesUnknown(outcome) && (await this.repo.moveStatus(tx, id, { status: 'unknown', attempts: attempt }, change));
      if (!moved && !late) fail(409, 'DUPLICATE_REQUEST');
      if (maySend(next.status)) await this.repo.addOutbox(tx, OPERATION_REQUESTED, id, attempt);
      // T4 (ADR 0019, D8): the verdict is on record, and in the same transaction the message that has it acted on.
      // Nothing is applied here: no line, no money, no task.
      else await this.repo.addOutbox(tx, OPERATION_SETTLED, id, settledSequence(attempt, late));
      return next.status;
    });
  }

  /**
   * Closes an unknown operation with an answer about the request already sent. It never sends again. The verdict,
   * what it handed back and the message that has it acted on are one transaction, as in `settle`.
   */
  async resolveUnknown(id: string, verdict: Verdict): Promise<void> {
    const result = verdict.status === 'succeeded' ? resultColumns(storedResult(verdict.result)) : null;
    const change = verdict.status === 'succeeded' ? { status: verdict.status, providerRef: storedRef(verdict.providerRef), error: null, result } : { status: verdict.status, error: verdict.error };
    await this.uow.runTx(async (tx) => {
      const row = await this.repo.operationById(tx, id);
      if (!row || !(await this.repo.moveStatus(tx, id, { status: 'unknown', attempts: row.attempts }, change))) fail(409, 'DUPLICATE_REQUEST');
      await this.repo.addOutbox(tx, OPERATION_SETTLED, id, settledSequence(row.attempts, true));
    });
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
      else await this.repo.addOutbox(tx, OPERATION_SETTLED, id, settledSequence(row.attempts, false));
      return next.status;
    });
  }

  // What the settlement of a verdict asks of the operation (ADR 0019, D8, D9, D16). Each is one guarded
  // statement inside the settlement's own transaction; what they mean is the settlement's to say.

  /** The operations whose verdict the settlement still has to act on (the sweeper's list). */
  unsettled(limit: number): Promise<string[]> {
    return this.repo.unsettledIds(this.uow.prisma, limit);
  }

  /** The operations of tasks whose answer is not known: the settlement makes sure each was announced. */
  awaitingAnswer(limit: number): Promise<string[]> {
    return this.repo.unknownTaskOperationIds(this.uow.prisma, limit);
  }

  /** The operation as it is stored, with its task and what the provider handed back; null when there is none. */
  stored(id: string) {
    return this.repo.operationById(this.uow.prisma, id);
  }

  /** Stamps a succeeded operation as applied, once, and only while it still carries the result it was read with. */
  stampApplied(tx: Db, id: string, read: { resultMsisdn: string | null; resultIccid: string | null; resultEsimCode: string | null }, at: Date): Promise<boolean> {
    return this.repo.markApplied(tx, id, read, at);
  }

  /** Writes why a succeeded operation could not be applied, once; its status and its result stay. */
  stampApplyError(tx: Db, id: string, error: string, at: Date): Promise<boolean> {
    return this.repo.markApplyError(tx, id, error, at);
  }

  /** Stamps a failed operation as handed to the branch, once. */
  stampHandedOver(tx: Db, id: string, at: Date): Promise<boolean> {
    return this.repo.markHandedOver(tx, id, at);
  }

  // What a person's decision asks of the operation (ADR 0019, D15; T10, T11). The caller holds the operation's
  // row lock and has asked the rules (`decisionStep`); each write here is still guarded on its own.

  /** The operation of a task as it is stored, or null for a task that never went to a provider. */
  ofTask(taskId: string) {
    return this.repo.operationByTask(this.uow.prisma, taskId);
  }

  /** The steps of the decisions taken on an operation so far, in order. */
  decisionEvents(db: Db, operationId: string) {
    return this.repo.decisionEvents(db, operationId);
  }

  /** Appends one step of a decision; refused (409) when another writer wrote that step first. */
  async recordDecision(tx: Db, event: NewDecisionEvent): Promise<void> {
    if (!(await this.repo.addDecisionEvent(tx, event))) fail(409, 'DUPLICATE_REQUEST');
  }

  /**
   * What a person says the provider handed back, as the columns hold it: the number and the serial as digits,
   * the eSIM code sealed. Made before the transaction; a code that cannot be sealed throws and nothing is written.
   */
  storableResult(result: ActivationResult): ResultColumns | null {
    return resultColumns(storedResult(result));
  }

  /**
   * A person confirmed that the provider ran an unknown operation: `unknown → succeeded` with the provider's
   * reference and what it handed back, guarded on the attempt. It writes no message: the caller applies the
   * result, or records why it cannot be, in the same transaction. Answers whether it moved.
   */
  async confirmUnknown(tx: Db, id: string, providerRef: string | null, result: ResultColumns | null): Promise<boolean> {
    const row = await this.repo.operationById(tx, id);
    if (!row) return false;
    return this.repo.moveStatus(tx, id, { status: 'unknown', attempts: row.attempts }, { status: 'succeeded', providerRef: storedRef(providerRef), error: null, result });
  }

  /**
   * Two accounts declared that the provider did not run an unknown operation: `unknown → failed`, guarded on the
   * attempt, with the message that has the task handed to the branch (T6). The error stays what made it unknown;
   * that people declared the failure is what the decision events say. It never sends again. Answers whether it moved.
   */
  async declareFailed(tx: Db, id: string): Promise<boolean> {
    const row = await this.repo.operationById(tx, id);
    if (!row) return false;
    const moved = await this.repo.moveStatus(tx, id, { status: 'unknown', attempts: row.attempts }, { status: 'failed', error: row.lastError as OperationError | null });
    if (moved) await this.repo.addOutbox(tx, OPERATION_SETTLED, id, settledSequence(row.attempts, true));
    return moved;
  }

  /** Stamps an exception as applied by a person's corrected data, once. */
  stampAppliedCorrected(tx: Db, id: string, at: Date): Promise<boolean> {
    return this.repo.markAppliedCorrected(tx, id, at);
  }
}
