import { insertNotices } from './notice-insert.repository';
import { env } from '../../../config';
import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import { hrefFor, type NoticeDraft } from './notice-kinds';

/** Pub/sub behind the live channel. Redis in the app, memory in tests. */
export type NoticeBus = {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
};

/** What a browser receives: the same shape the list endpoint returns. */
export type NoticeView = {
  id: string;
  kind: string;
  payload: unknown;
  actorName: string;
  href: string;
  read: boolean;
  createdAt: string;
};

export type WrittenNotice = NoticeView & { userId: string };

type Actor = { id: string; nickname: string };

function channelOf(userId: string) {
  return `notice:${userId}`;
}

class RedisBus implements NoticeBus {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, Set<(message: string) => void>>();

  private url() {
    const url = env('REDIS_URL');
    if (!url) throw new Error('REDIS_URL is required');
    return url;
  }

  private pub() {
    this.publisher ??= new IORedis(this.url());
    return this.publisher;
  }

  private sub() {
    if (!this.subscriber) {
      this.subscriber = new IORedis(this.url());
      this.subscriber.on('message', (channel: string, message: string) => {
        for (const handler of this.handlers.get(channel) ?? []) handler(message);
      });
    }
    return this.subscriber;
  }

  async publish(channel: string, message: string) {
    await this.pub().publish(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void) {
    const set = this.handlers.get(channel) ?? new Set();
    const first = set.size === 0;
    set.add(handler);
    this.handlers.set(channel, set);
    if (first) await this.sub().subscribe(channel);
    return async () => {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(channel);
        await this.sub().unsubscribe(channel);
      }
    };
  }

  async close() {
    await Promise.all([this.publisher?.quit(), this.subscriber?.quit()]);
  }
}

/**
 * Writes notices inside the caller's transaction and publishes them after that transaction commits.
 * The actor never receives a notice for their own action.
 */
@Injectable()
export class NoticeService implements OnModuleDestroy {
  private readonly bus: NoticeBus;

  constructor(@Optional() bus?: NoticeBus) {
    this.bus = bus ?? new RedisBus();
  }

  async onModuleDestroy() {
    if (this.bus instanceof RedisBus) await this.bus.close();
  }

  /**
   * Writes one notice for each recipient. The account the notice is from is left out of its own audience: nobody
   * is told what they have just done themselves. `tellActor` is the one exception, for a notice written in an
   * account's name by something else: the settlement of a provider's verdict names the task's submitter as the
   * actor (ADR 0019, D12) and the submitter did not do it, so the submitter is told like any other recipient.
   */
  async write(tx: Prisma.TransactionClient, userIds: string[], actor: Actor, draft: NoticeDraft, options: { tellActor?: boolean } = {}): Promise<WrittenNotice[]> {
    const recipients = [...new Set(userIds)].filter((id) => id && (options.tellActor === true || id !== actor.id));
    if (recipients.length === 0) return [];
    const href = hrefFor(draft);
    const createdAt = new Date();
    const rows = recipients.map((userId) => ({
      id: randomUUID(),
      userId,
      kind: draft.kind,
      payload: draft.payload as Prisma.InputJsonValue,
      actorId: actor.id,
      actorName: actor.nickname,
      href,
      createdAt,
    }));
    await insertNotices(tx, rows);
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      payload: draft.payload,
      actorName: row.actorName,
      href,
      read: false,
      createdAt: createdAt.toISOString(),
    }));
  }

  async publish(rows: WrittenNotice[]) {
    await Promise.all(
      rows.map(({ userId, ...view }) => this.bus.publish(channelOf(userId), JSON.stringify(view))),
    );
  }

  subscribe(userId: string, handler: (message: string) => void) {
    return this.bus.subscribe(channelOf(userId), handler);
  }
}
