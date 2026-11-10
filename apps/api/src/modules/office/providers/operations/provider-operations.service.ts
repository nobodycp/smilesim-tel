import { Injectable } from '@nestjs/common';
import { fail } from '../../../shared/office-failure';
import { UnitOfWork, type Db } from '../../kernel/unit-of-work';
import { afterAttempt, canMove, maySend, requestHash, storedRef, validKey, type AttemptOutcome, type OperationRequest, type OperationStatus, type Verdict } from './provider-operation.rules';
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
      await this.repo.addOutbox(tx, OPERATION_REQUESTED, id);
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
   * Takes the operation for one attempt: `requested` → `pending`, counted. False when it is not there to take
   * (another worker has it, it is settled, or it is unknown). Committed before the provider is called, so a
   * process that dies mid-call leaves `pending`, never a second send.
   */
  async claim(id: string): Promise<boolean> {
    const row = await this.repo.operationById(this.uow.prisma, id);
    if (!row) fail(404, 'NOT_FOUND');
    if (!maySend(row.status as OperationStatus)) return false;
    return this.repo.moveStatus(this.uow.prisma, id, 'requested', { status: 'pending', error: null, attempt: true });
  }

  /** Writes what a claimed attempt came to. Refused unless the operation is `pending`. */
  async settle(id: string, outcome: AttemptOutcome): Promise<OperationStatus> {
    const row = await this.repo.operationById(this.uow.prisma, id);
    if (!row) fail(404, 'NOT_FOUND');
    const next = afterAttempt(outcome, row.attempts);
    if (row.status !== 'pending' || !canMove('pending', next.status)) fail(409, 'DUPLICATE_REQUEST');
    const moved = await this.repo.moveStatus(this.uow.prisma, id, 'pending', { status: next.status, providerRef: storedRef(next.providerRef), error: next.error });
    if (!moved) fail(409, 'DUPLICATE_REQUEST');
    return next.status;
  }

  /** Closes an unknown operation with an answer about the request already sent. It never sends again. */
  async resolveUnknown(id: string, verdict: Verdict): Promise<void> {
    const change = verdict.status === 'succeeded' ? { status: verdict.status, providerRef: storedRef(verdict.providerRef), error: null } : { status: verdict.status, error: verdict.error };
    const moved = await this.repo.moveStatus(this.uow.prisma, id, 'unknown', change);
    if (!moved) fail(409, 'DUPLICATE_REQUEST');
  }
}
