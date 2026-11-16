import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { env, logger, reason } from '../platform';
import { RequestLogRepository } from './request-log.repository';

const log = logger('RequestLog');

/** A buffered batch is written this long after its first row, or as soon as it holds `REQUEST_LOG_BATCH` rows. */
export const REQUEST_LOG_FLUSH_MS = 2_000;
export const REQUEST_LOG_BATCH = 200;
/** Rows past this many waiting (the database hangs) are dropped and counted, so memory stays bounded. */
export const REQUEST_LOG_BUFFER_MAX = 5_000;

/** Who sent a request, when the request itself knew (the actor interceptor ran). */
export type RequestAccount = { actorId: string; actorLoginName: string; layer: string; operatorId: string | null };

/**
 * One request as the middleware hands it over: the columns of `RequestLog`, and, when the request carried a session
 * the handlers did not resolve, the session token's hash (never the token) to name the account at write time.
 */
export type RequestLogDraft = Omit<Prisma.RequestLogCreateManyInput, 'id' | 'actorId' | 'actorLoginName' | 'layer' | 'operatorId'> & {
  account: RequestAccount | null;
  sessionHash: string | null;
};

/**
 * The request log's writer: rows wait in memory and are written in batches, so a request never waits for its log
 * and never fails because of it. A batch the database refuses is dropped and counted (`dropped`); what is waiting
 * is written when the module stops.
 */
@Injectable()
export class RequestLogWriter implements OnModuleDestroy {
  private waiting: RequestLogDraft[] = [];
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** Rows lost since the process started: refused batches and rows past the buffer's limit. */
  dropped = 0;

  constructor(private readonly repo: RequestLogRepository) {}

  /** Takes one row; never throws, never waits. Without a database (specs that set none) nothing is kept. */
  add(draft: RequestLogDraft): void {
    if (!env('DATABASE_URL')) return;
    if (this.waiting.length >= REQUEST_LOG_BUFFER_MAX) {
      this.dropped += 1;
      return;
    }
    this.waiting.push(draft);
    // Once a batch is full; while one is being written, the rows that pile up are taken by the same pass.
    if (this.waiting.length % REQUEST_LOG_BATCH === 0) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), REQUEST_LOG_FLUSH_MS).unref();
  }

  /** Writes what is waiting, one batch at a time; resolves when it is written or dropped. Never rejects. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Batches are written one after another, so a slow database is never asked for two at once.
    this.writing = this.writing.then(() => this.writeWaiting());
    return this.writing;
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private async writeWaiting(): Promise<void> {
    while (this.waiting.length > 0) {
      const batch = this.waiting.splice(0, REQUEST_LOG_BATCH);
      try {
        await this.repo.insertMany(await this.rowsOf(batch));
      } catch (error) {
        this.dropped += batch.length;
        log.warn(`a batch of ${batch.length} request rows was not written (${this.dropped} lost so far): ${reason(error)}`);
      }
    }
  }

  /** The rows of a batch, each naming its account: from the request, else from its session, in one query. */
  private async rowsOf(batch: RequestLogDraft[]): Promise<Prisma.RequestLogCreateManyInput[]> {
    const hashes = [...new Set(batch.filter((row) => !row.account && row.sessionHash).map((row) => row.sessionHash as string))];
    const sessions = hashes.length > 0 ? await this.repo.sessionsByHash(hashes) : [];
    const bySession = new Map(sessions.map((session): [string, RequestAccount] => [
      session.tokenHash,
      { actorId: session.user.id, actorLoginName: session.user.loginName, layer: session.user.layer, operatorId: session.kind === 'impersonation' ? session.operatorId : null },
    ]));
    return batch.map(({ account, sessionHash, ...row }) => {
      const who = account ?? (sessionHash ? bySession.get(sessionHash) : undefined);
      return { ...row, actorId: who?.actorId ?? null, actorLoginName: who?.actorLoginName ?? '', layer: who?.layer ?? '', operatorId: who?.operatorId ?? null };
    });
  }
}
