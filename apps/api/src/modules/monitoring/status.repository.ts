import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../platform';
import { WORKER_DOWN_AFTER_S } from './thresholds';

/** The migrations the build carries: `apps/api/prisma/migrations`, from `src/` and from `dist/` alike. */
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'prisma', 'migrations');

/**
 * What the system status reads of PostgreSQL and of the build (system monitor M.5). One method a figure; ages are
 * worked out by the database's clock, the clock the worker's heartbeat and the outbox are written with.
 */
@Injectable()
export class StatusRepository {
  constructor(private readonly uow: UnitOfWork) {}

  async ping(): Promise<void> {
    await this.uow.prisma.$queryRaw`SELECT 1`;
  }

  /** The connections open to this database (every client's, the worker's too) and its size on disk. */
  async database(): Promise<{ connections: number; sizeBytes: number }> {
    const [row] = await this.uow.prisma.$queryRaw<{ connections: number; sizeBytes: number }[]>`
      SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS "connections",
             pg_database_size(current_database())::float8 AS "sizeBytes"`;
    return { connections: row?.connections ?? 0, sizeBytes: row?.sizeBytes ?? 0 };
  }

  /** How many workers beat within the `down` window, and the age of the latest beat in seconds (null: none ever). */
  async heartbeat(): Promise<{ workers: number; lastBeatAgeS: number | null }> {
    const [row] = await this.uow.prisma.$queryRaw<{ workers: number; ageS: number | null }[]>`
      SELECT (count(*) FILTER (WHERE "beatAt" > now() - make_interval(secs => ${WORKER_DOWN_AFTER_S})))::int AS "workers",
             EXTRACT(EPOCH FROM (now() - max("beatAt")))::float8 AS "ageS"
      FROM "WorkerHeartbeat"`;
    return { workers: row?.workers ?? 0, lastBeatAgeS: row?.ageS ?? null };
  }

  /** The messages not yet published, and the age of the oldest in seconds (null: none waits). */
  async outbox(): Promise<{ unpublished: number; oldestAgeS: number | null }> {
    const [row] = await this.uow.prisma.$queryRaw<{ unpublished: number; ageS: number | null }[]>`
      SELECT count(*)::int AS "unpublished", EXTRACT(EPOCH FROM (now() - min("createdAt")))::float8 AS "ageS"
      FROM "OutboxMessage" WHERE "publishedAt" IS NULL`;
    return { unpublished: row?.unpublished ?? 0, oldestAgeS: row?.ageS ?? null };
  }

  /** The migrations the database has applied and finished, rolled-back ones left out. */
  async appliedMigrations(): Promise<string[]> {
    const rows = await this.uow.prisma.$queryRaw<{ name: string }[]>`
      SELECT "migration_name" AS "name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
    return rows.map((row) => row.name);
  }

  /** The migrations this build carries: each folder of the migrations directory. */
  async carriedMigrations(): Promise<string[]> {
    const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  }
}
