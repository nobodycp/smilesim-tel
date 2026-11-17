import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../platform';
import { PROBE_TIMEOUT_MS } from './thresholds';

/**
 * The queues the status counts: the worker's two (`worker/provider-dispatch.ts` `OPERATIONS_QUEUE`,
 * `SETTLEMENTS_QUEUE`, under BullMQ's default prefix, as the worker opens them). Monitoring may not import the
 * worker's composition, so the names are written here and `status.service.spec.ts` holds them equal.
 */
export const MONITORED_QUEUES = ['provider-operations', 'provider-settlements'] as const;

export type QueueCounts = { name: string; waiting: number; active: number; failed: number };

/**
 * Redis as the system status reads it (M.5): a `PING`, the memory in use, and the queues' job counts. One
 * connection, opened on the first status read and closed when the module stops; it fails a command after one
 * retry instead of holding it, and every read is under the probe's time limit anyway. Reads only.
 */
@Injectable()
export class StatusRedis implements OnModuleDestroy {
  private client: IORedis | null = null;
  private readonly queues = new Map<string, Queue>();

  /** Whether this deployment names a Redis at all. */
  configured(): boolean {
    return Boolean(env('REDIS_URL'));
  }

  async ping(): Promise<void> {
    await this.connection().ping();
  }

  /** `used_memory` of `INFO memory`, in bytes; null when Redis does not say. */
  async usedMemory(): Promise<number | null> {
    const info = await this.connection().info('memory');
    const found = /^used_memory:(\d+)/m.exec(info);
    return found ? Number(found[1]) : null;
  }

  async counts(name: string): Promise<QueueCounts> {
    const counts = await this.queue(name).getJobCounts('waiting', 'active', 'failed');
    return { name, waiting: counts.waiting ?? 0, active: counts.active ?? 0, failed: counts.failed ?? 0 };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close().catch(() => undefined)));
    this.queues.clear();
    this.client?.disconnect();
    this.client = null;
  }

  private connection(): IORedis {
    if (!this.client) {
      this.client = new IORedis(env('REDIS_URL') as string, { maxRetriesPerRequest: 1, connectTimeout: PROBE_TIMEOUT_MS });
      // A Redis that is away is the status's answer (`down`), not a crash of the API.
      this.client.on('error', () => undefined);
    }
    return this.client;
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection() });
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }
}
