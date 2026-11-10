import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Db } from '../../kernel/unit-of-work';
import type { OperationError, OperationRequest, OperationStatus } from './provider-operation.rules';

/** The outbox topic of an operation that waits to be sent. */
export const OPERATION_REQUESTED = 'provider-operation.requested';

export type NewOperation = Omit<OperationRequest, 'providerCode'> & { idempotencyKey: string; requestHash: string; providerId: string };
export type StatusChange = { status: OperationStatus; providerRef?: string | null; error: OperationError | null; attempt?: boolean };

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

  /**
   * Guarded: changes the row only while it is still in `from` and has made exactly `attempts` attempts, so a write
   * that belongs to an earlier attempt finds nothing to change. Answers whether it did.
   */
  async moveStatus(db: Db, id: string, from: { status: OperationStatus; attempts?: number }, change: StatusChange): Promise<boolean> {
    const moved = await db.providerOperation.updateMany({
      where: { id, status: from.status, ...(from.attempts !== undefined ? { attempts: from.attempts } : {}) },
      data: {
        status: change.status,
        lastError: change.error,
        ...(change.providerRef !== undefined ? { providerRef: change.providerRef } : {}),
        ...(change.attempt ? { attempts: { increment: 1 }, lastAttemptAt: new Date() } : {}),
      },
    });
    return moved.count === 1;
  }
}
