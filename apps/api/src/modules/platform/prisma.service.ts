import { env } from '../../config';
import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import type { PrismaClient } from '../../generated/prisma/client';

/**
 * The one PostgreSQL client of the API process. Every store and service asks it for `client` instead of opening
 * its own pool. The client is created on first use, so a process (or a spec) that never touches the database
 * never needs `DATABASE_URL`.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private instance: PrismaClient | null = null;

  /** Whether a database is configured. Optional writers (the activity log) skip their work without one. */
  get available(): boolean {
    return Boolean(env('DATABASE_URL'));
  }

  get client(): PrismaClient {
    this.instance ??= createPrismaClient();
    return this.instance;
  }

  async onModuleDestroy(): Promise<void> {
    const instance = this.instance;
    this.instance = null;
    await instance?.$disconnect();
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
