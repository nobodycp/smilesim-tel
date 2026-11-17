import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { logger, reason } from './log';
import { PrismaService } from './prisma.service';
import { NOTICE_WRITER, type NoticeWriter, type WrittenNotice } from './notices';

const log = logger('UnitOfWork');

/**
 * How long a transaction may wait and run, stated here for every transaction of the application. Prisma's own
 * defaults are 2 s to be given a connection and 5 s to finish: under load a settlement that waited longer than 2 s
 * for a connection was refused (`P2028`) though nothing was wrong with it, and a write over many rows (a provider's
 * run modes with all its packages) could pass 5 s. Waiting is the right answer for a queue of money writes; the
 * upper limit still ends a transaction that hangs, so its row locks are let go.
 */
export const TRANSACTION_LIMITS = { maxWait: 10_000, timeout: 15_000 } as const;

/**
 * A transaction on a client of the caller's own, with the stated limits: for the two callers that have a client and
 * no unit of work (the boot seeder of the trial accounts, the command-line sealing script). Everything else goes
 * through `UnitOfWork.runTx`, which also publishes the notices a transaction wrote.
 */
export function transaction<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, TRANSACTION_LIMITS);
}

/** A client to read or write with: the process's own, or the one a transaction handed out (rule 1.3). */
export type Db = Prisma.TransactionClient | PrismaClient;

/**
 * The database as the application uses it: one client per process, and transactions that publish the notices they
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

  /**
   * The client to use: the one handed in (the worker's, a spec's), else the API's `PrismaService.client`, asked each
   * time and not kept, so a CSV export's reads go to the export client (`withExportLimit`, DB.15).
   */
  get prisma(): PrismaClient {
    if (this.prismaClient) return this.prismaClient;
    if (this.db) return this.db.client;
    this.prismaClient = createPrismaClient();
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
    const result = await transaction(this.prisma, async (tx) => {
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
