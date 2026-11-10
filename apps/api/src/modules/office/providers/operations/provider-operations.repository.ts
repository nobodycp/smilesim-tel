import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Db } from '../../kernel/unit-of-work';
import type { OperationError, OperationRequest, OperationStatus } from './provider-operation.rules';

/** The outbox topic of an operation that waits to be sent. */
export const OPERATION_REQUESTED = 'provider-operation.requested';

export type NewOperation = Omit<OperationRequest, 'providerCode'> & { idempotencyKey: string; requestHash: string; providerId: string };
/** `claim` starts a new attempt: counted, leased until the given time, with no send mark. */
export type StatusChange = { status: OperationStatus; providerRef?: string | null; error: OperationError | null; claim?: { at: Date; leaseUntil: Date } };
/** The state a guarded write expects: the status, and where given the attempt's number and that nothing was sent. */
export type Expected = { status: OperationStatus; attempts?: number; unsent?: true };

/**
 * Provider operations and the outbox as the database holds them. Every method takes the client, so an operation,
 * its outbox message and whatever its caller writes are one transaction. No rule lives here.
 */
@Injectable()
export class ProviderOperationsRepository {
  /**
   * Inserts the operation unless its key is taken (`ON CONFLICT DO NOTHING`, so a lost race does not abort the
   * caller's transaction). Answers the new id, or null when the key already has an operation.
   */
  async insertUnlessKeyTaken(db: Db, row: NewOperation): Promise<string | null> {
    const id = randomUUID();
    const made = await db.providerOperation.createMany({ data: [{ id, status: 'requested', ...row }], skipDuplicates: true });
    return made.count === 1 ? id : null;
  }

  async providerIdByCode(db: Db, code: string): Promise<string | null> {
    return (await db.provider.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
  }

  /**
   * Says the operation waits to be sent. `sequence` is the number of attempts already made: the database holds one
   * message per send, so two writers of the same one cannot both commit.
   */
  addOutbox(db: Db, topic: string, aggregateId: string, sequence: number) {
    return db.outboxMessage.create({ data: { topic, aggregateId, sequence, payload: { operationId: aggregateId } } });
  }

  operationById(db: Db, id: string) {
    return db.providerOperation.findUnique({ where: { id } });
  }

  operationByKey(db: Db, idempotencyKey: string) {
    return db.providerOperation.findUnique({ where: { idempotencyKey } });
  }

  /** The operation with its provider's code: what the dispatcher sends. */
  operationToSend(db: Db, id: string) {
    return db.providerOperation.findUnique({ where: { id }, include: { provider: { select: { code: true } } } });
  }

  /** Pending operations whose lease is over (or that never had one), oldest first. */
  async expiredPendingIds(db: Db, now: Date, limit: number): Promise<string[]> {
    const rows = await db.providerOperation.findMany({
      where: { status: 'pending', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Writes the send mark of attempt `attempts`, once, while the operation is still pending on it. The provider is
   * called only after this answered true, so an attempt without the mark never reached the provider.
   */
  async markSent(db: Db, id: string, attempts: number, at: Date): Promise<boolean> {
    const marked = await db.providerOperation.updateMany({ where: { id, status: 'pending', attempts, sentAt: null }, data: { sentAt: at } });
    return marked.count === 1;
  }

  /**
   * Guarded: changes the row only while it is as `from` says (its status, and where given its attempt count and
   * an empty send mark), so a write that belongs to an earlier attempt finds nothing to change. Answers whether
   * it did.
   */
  async moveStatus(db: Db, id: string, from: Expected, change: StatusChange): Promise<boolean> {
    const moved = await db.providerOperation.updateMany({
      where: { id, status: from.status, ...(from.attempts !== undefined ? { attempts: from.attempts } : {}), ...(from.unsent ? { sentAt: null } : {}) },
      data: {
        status: change.status,
        lastError: change.error,
        ...(change.providerRef !== undefined ? { providerRef: change.providerRef } : {}),
        ...(change.claim ? { attempts: { increment: 1 }, lastAttemptAt: change.claim.at, leaseUntil: change.claim.leaseUntil, sentAt: null } : {}),
      },
    });
    return moved.count === 1;
  }
}
