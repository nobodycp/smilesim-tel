import { logger, reason } from '../../shared/log';
import type { UnitOfWork } from '../kernel/unit-of-work';
import { OutboxRepository, type ClaimedMessage } from './outbox.repository';

const log = logger('OutboxRelay');

/** How long a relay may hold a message before another takes it. Longer than a publish can take. */
export const RELAY_LEASE_MS = 30_000;
export const RELAY_BATCH = 50;

/** Where a message goes. It answers only once the queue has accepted the message, and throws otherwise. */
export type OutboxPublisher = { publish(message: ClaimedMessage): Promise<void> };

export type RelayRound = { claimed: number; published: number; failed: number };

/**
 * Moves outbox messages to their queue (ADR 0018): take a batch under a lease, publish each, stamp it once the
 * queue accepted it. Nothing is kept in memory between rounds, so a relay that dies loses nothing: what it held
 * is taken again when the lease ends. Delivery is at least once; the message id is the queue's job id, and the
 * consumer is safe against a repeat.
 */
export class OutboxRelay {
  constructor(private readonly uow: UnitOfWork, private readonly repo: OutboxRepository, private readonly publisher: OutboxPublisher, private readonly topics: string[]) {}

  async runOnce(now: Date = new Date()): Promise<RelayRound> {
    const messages = await this.repo.claimUnpublished(this.uow.prisma, this.topics, now, new Date(now.getTime() + RELAY_LEASE_MS), RELAY_BATCH);
    const round: RelayRound = { claimed: messages.length, published: 0, failed: 0 };
    for (const message of messages) {
      try {
        // No transaction is open here: the row is leased, not locked.
        await this.publisher.publish(message);
        await this.repo.markPublished(this.uow.prisma, message.id, new Date());
        round.published += 1;
      } catch (error) {
        // The message stays unpublished and is taken again after its lease: that wait is the retry.
        round.failed += 1;
        log.warn(`message ${message.id} (${message.topic}) not published: ${reason(error)}`);
      }
    }
    return round;
  }
}
