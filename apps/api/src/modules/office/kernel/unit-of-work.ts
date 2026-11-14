import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPrismaClient } from '../../../db';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { logger, reason } from '../../shared/log';
import { PrismaService } from '../../shared/prisma.service';
import { NOTICE_WRITER, type NoticeWriter, type WrittenNotice } from '../../shared/notices';

const log = logger('Office');

/** A client to read or write with: the process's own, or the one a transaction handed out (rule 1.3). */
export type Db = Prisma.TransactionClient | PrismaClient;

/**
 * The database as the office uses it: one client per process, and transactions that publish the notices they
 * wrote only once they have committed.
 */
@Injectable()
export class UnitOfWork {
  /** The client; specs replace it to run on in-memory tables. */
  prismaClient: PrismaClient | null = null;

  /** Notices written inside a transaction wait here until that transaction commits. */
  private readonly queued = new WeakMap<object, WrittenNotice[]>();

  /**
   * `notice` is the notice writer behind its port: provided by `NoticeWriterModule` in the app, handed in by the
   * worker (`provider-dispatch.ts`) and by specs. The unit of work never builds one.
   */
  constructor(@Inject(NOTICE_WRITER) readonly notice: NoticeWriter, @Optional() private readonly db?: PrismaService) {}

  get prisma(): PrismaClient {
    this.prismaClient ??= this.db?.client ?? createPrismaClient();
    return this.prismaClient;
  }

  queueNotices(tx: Prisma.TransactionClient, rows: WrittenNotice[]): void {
    if (rows.length === 0) return;
    const list = this.queued.get(tx) ?? [];
    list.push(...rows);
    this.queued.set(tx, list);
  }

  /** Runs a transaction and publishes the notices it queued once it has committed. */
  async runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let inner: Prisma.TransactionClient | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      inner = tx;
      return fn(tx);
    });
    const rows = inner ? this.queued.get(inner) ?? [] : [];
    if (inner) this.queued.delete(inner);
    if (rows.length > 0) await this.publishQuietly(rows);
    return result;
  }

  // The row is committed; the live push is a courtesy. The 60s poll in the browser picks up what Redis missed.
  async publishQuietly(rows: WrittenNotice[]): Promise<void> {
    try {
      await this.notice.publish(rows);
    } catch (error) {
      log.warn(`notice publish failed: ${reason(error)}`);
    }
  }
}
