import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { UnitOfWork } from '../platform';
import type { Cycle, StackComponent } from './versions.rules';

/** A component's row as the page and the check read it. */
export type StackVersionRow = { name: string; kind: string; latest: string | null; cycles: Cycle[] | null; checkedAt: Date; failed: boolean };

/** What one check found of one component: its newest, and a runtime's cycles; or nothing, its call having failed. */
export type Found = { component: StackComponent; failed: false; latest: string | null; cycles: Cycle[] | null } | { component: StackComponent; failed: true };

/**
 * The database as the versions page reads it and the version check writes it (system monitor M.11): `StackVersion`,
 * the worker's Node.js on its heartbeat row, and PostgreSQL's own version. Nothing of another module is written.
 */
@Injectable()
export class VersionsRepository {
  constructor(private readonly uow: UnitOfWork) {}

  async rows(): Promise<StackVersionRow[]> {
    const rows = await this.uow.prisma.stackVersion.findMany({ select: { name: true, kind: true, latest: true, cycles: true, checkedAt: true, failed: true } });
    return rows.map((row) => ({ ...row, cycles: Array.isArray(row.cycles) ? (row.cycles as Cycle[]) : null }));
  }

  /** When the last check ran (of any component); null before the first. */
  async lastCheckedAt(): Promise<Date | null> {
    const found = await this.uow.prisma.stackVersion.aggregate({ _max: { checkedAt: true } });
    return found?._max?.checkedAt ?? null;
  }

  /** The Node.js of the worker that beat last; null when none ever wrote one. */
  async workerNodeVersion(): Promise<string | null> {
    const [row] = await this.uow.prisma.$queryRaw<{ nodeVersion: string }[]>`
      SELECT "nodeVersion" FROM "WorkerHeartbeat" WHERE "nodeVersion" IS NOT NULL ORDER BY "beatAt" DESC LIMIT 1`;
    return row?.nodeVersion ?? null;
  }

  /** `SHOW server_version` as the server writes it (`17.6 (Debian 17.6-1.pgdg120+1)`); null when it says nothing. */
  async postgresVersion(): Promise<string | null> {
    const [row] = await this.uow.prisma.$queryRaw<{ server_version: string }[]>`SHOW server_version`;
    return row?.server_version ?? null;
  }

  /**
   * The newest each named component had, its row locked until the check's transaction ends (in name order, so two
   * checks never wait on each other crosswise): a second check that ran at the same time reads what the first wrote.
   */
  async lockKnown(tx: Prisma.TransactionClient, names: string[]): Promise<Map<string, string | null>> {
    const rows = await tx.$queryRaw<{ name: string; latest: string | null }[]>`
      SELECT "name", "latest" FROM "StackVersion" WHERE "name" = ANY(${names}) ORDER BY "name" FOR UPDATE`;
    return new Map(rows.map((row) => [row.name, row.latest]));
  }

  /**
   * Writes what a check found of one component. A failed call keeps the last answer and says it failed; an answer
   * with no release (a pre-release under the registry's `latest`) comes here with the last release the caller kept; a newer
   * `latest` keeps what it replaced and when (`previous`, the notice's).
   */
  async save(tx: Prisma.TransactionClient, found: Found, at: Date, previous: string | null): Promise<void> {
    const { name, kind } = found.component;
    if (found.failed) {
      await tx.stackVersion.upsert({ where: { name }, create: { name, kind, checkedAt: at, failed: true }, update: { checkedAt: at, failed: true } });
      return;
    }
    const answer = { latest: found.latest, cycles: found.cycles ?? undefined, checkedAt: at, failed: false };
    const newer = previous === null ? {} : { previousLatest: previous, foundAt: at };
    await tx.stackVersion.upsert({ where: { name }, create: { name, kind, ...answer }, update: { kind, ...answer, ...newer } });
  }
}
