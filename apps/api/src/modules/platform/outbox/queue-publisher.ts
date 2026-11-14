import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import type { OutboxPublisher } from './outbox-relay';
import type { ClaimedMessage } from './outbox.repository';

/** How long a publish may take before it counts as failed. */
export const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * Publishes outbox messages as BullMQ jobs: one queue per topic, the message id as the job id, so a message
 * published twice is one job while the first is still kept. A finished job is kept a day for that reason.
 */
export class QueuePublisher implements OutboxPublisher {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly connection: IORedis, private readonly queueOf: Record<string, string>, private readonly prefix?: string) {}

  async publish(message: ClaimedMessage): Promise<void> {
    const name = this.queueOf[message.topic];
    if (!name) throw new Error(`no queue for topic ${message.topic}`);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('the queue did not answer in time')), PUBLISH_TIMEOUT_MS);
    });
    try {
      const added = this.queue(name).add(message.topic, message.payload, { jobId: message.id, attempts: 1, removeOnComplete: { age: 24 * 60 * 60 }, removeOnFail: { age: 7 * 24 * 60 * 60 } });
      await Promise.race([added, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, ...(this.prefix ? { prefix: this.prefix } : {}) });
      // Without a listener an emitted error would end the process; the failed publish already says what happened.
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close().catch(() => undefined)));
  }
}
