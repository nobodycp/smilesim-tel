import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '../../config';
import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import type { PrismaClient } from '../../generated/prisma/client';

/** Set while a CSV export runs (`withExportLimit`). */
const exportReads = new AsyncLocalStorage<true>();

/**
 * Runs a CSV export's reads on the export client (plan DB.15): every statement the export makes through
 * `PrismaService.client` (and so through `UnitOfWork.prisma`) is limited by `EXPORT_STATEMENT_TIMEOUT_MS` instead
 * of the API's 15 s. The owner excepted the exports from the API's limit on 2026-11-17. Only the six export routes
 * call it, around their service call; nothing else runs under it.
 */
export function withExportLimit<T>(read: () => Promise<T>): Promise<T> {
  return exportReads.run(true, read);
}

/**
 * The PostgreSQL clients of the API process. Every store and service asks it for `client` instead of opening its
 * own pool: the API's client (pool 20 unless `DATABASE_POOL_MAX` says otherwise, statements limited to 15 s,
 * `db.ts`), or, inside `withExportLimit`, the exports' small client with their longer limit. Each is created on
 * first use, so a process (or a spec) that never touches the database never needs `DATABASE_URL`.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private instance: PrismaClient | null = null;
  private exportInstance: PrismaClient | null = null;

  /** Whether a database is configured. Optional writers (the activity log) skip their work without one. */
  get available(): boolean {
    return Boolean(env('DATABASE_URL'));
  }

  get client(): PrismaClient {
    if (exportReads.getStore()) {
      this.exportInstance ??= createPrismaClient('export');
      return this.exportInstance;
    }
    this.instance ??= createPrismaClient('api');
    return this.instance;
  }

  async onModuleDestroy(): Promise<void> {
    const clients = [this.instance, this.exportInstance];
    this.instance = null;
    this.exportInstance = null;
    await Promise.all(clients.map((client) => client?.$disconnect()));
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
