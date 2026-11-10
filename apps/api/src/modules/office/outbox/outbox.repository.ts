import type { Db } from '../kernel/unit-of-work';

export type ClaimedMessage = { id: string; topic: string; aggregateId: string; sequence: number; payload: unknown };

/** The outbox as its relay reads it. Each method is one statement: no transaction stays open around a publish. */
export class OutboxRepository {
  /**
   * Takes up to `limit` unpublished messages of the given topics for one relay until `leaseUntil`, oldest first.
   * One statement: `FOR UPDATE SKIP LOCKED` keeps two relays off the same rows while it runs, and the lease keeps
   * them off afterwards. A message whose relay died is taken again once its lease is over. A topic the relay has
   * no queue for is left alone.
   */
  claimUnpublished(db: Db, topics: string[], now: Date, leaseUntil: Date, limit: number): Promise<ClaimedMessage[]> {
    return db.$queryRaw<ClaimedMessage[]>`
      UPDATE "OutboxMessage" SET "claimedUntil" = ${leaseUntil}
      WHERE "id" IN (
        SELECT "id" FROM "OutboxMessage"
        WHERE "topic" = ANY(${topics}) AND "publishedAt" IS NULL AND ("claimedUntil" IS NULL OR "claimedUntil" < ${now})
        ORDER BY "createdAt", "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "topic", "aggregateId", "sequence", "payload"`;
  }

  /** Stamps a message the queue has accepted. Harmless when a second relay published it too. */
  async markPublished(db: Db, id: string, at: Date): Promise<void> {
    await db.outboxMessage.updateMany({ where: { id, publishedAt: null }, data: { publishedAt: at } });
  }
}
