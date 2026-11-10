import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { env, isTest } from '../../../config';
import { logger, reason } from '../../shared/log';
import { AccountTree } from '../kernel/account-tree';
import { visibleAccountIds } from '../rules/account-visibility';
import { expiringWhere, suspendedWhere } from '../rules/office-paging';
import { DeskRepository } from './desk.repository';

const log = logger('LineSnapshots');

/** How often today's snapshot is written over: the day's last one is what a later day compares with. */
export const SNAPSHOT_EVERY_MINUTES = 60;

export type LineCounts = { active: number; expiring: number; frozen: number; disconnected: number; suspended: number };

/**
 * Keeps each account's line counts by day, so the home can say how its numbers moved over a period (spec
 * 2026-11-09-admin-review, 6.4). A timer writes today's row for every account that is not frozen; reading the
 * home never writes (plan backend-loose-ends A.3). The row is an upsert on (account, day), so several API
 * processes, or a restart, write the same thing. Off under tests and without a database, like the provider watch.
 */
@Injectable()
export class LineSnapshotsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly tree: AccountTree, private readonly repo: DeskRepository) {}

  onModuleInit() {
    if (isTest() || !env('DATABASE_URL')) return;
    const run = () => void this.writeToday().catch((error) => log.warn(`snapshot failed: ${reason(error)}`));
    run();
    this.timer = setInterval(run, SNAPSHOT_EVERY_MINUTES * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Writes today's counts for every account that is not frozen. Answers how many rows it wrote. */
  async writeToday(now: Date = new Date()): Promise<number> {
    const [accounts, periods] = await Promise.all([this.tree.accounts(), this.repo.suspendPeriods()]);
    const suspended = suspendedWhere(periods.map((row) => row.suspendAfterDays), now);
    // Five queries for the whole office, grouped by point of sale; each account then sums the points of sale it sees.
    const [active, expiring, frozen, disconnected, suspendedNow] = await Promise.all([
      this.byPos({ status: 'active' }),
      this.byPos(expiringWhere(now)),
      this.byPos({ status: 'frozen' }),
      this.byPos({ status: 'disconnected' }),
      this.byPos(suspended),
    ]);
    const day = now.toISOString().slice(0, 10);
    const open = accounts.filter((account) => account.disabledAt === null);
    for (const account of open) {
      const seen = visibleAccountIds(account.id, account.layer, accounts);
      const sum = (counts: Map<string, number>) => [...seen].reduce((total, id) => total + (counts.get(id) ?? 0), 0);
      const lines: LineCounts = { active: sum(active), expiring: sum(expiring), frozen: sum(frozen), disconnected: sum(disconnected), suspended: sum(suspendedNow) };
      // A suspended line is still stored as active: it leaves the active slice, and so does an expiring one.
      await this.repo.saveLineSnapshot(account.id, day, { ...lines, active: Math.max(0, lines.active - lines.expiring - lines.suspended) });
    }
    return open.length;
  }

  private async byPos(where: Prisma.LineWhereInput): Promise<Map<string, number>> {
    return new Map((await this.repo.lineCountsByPos(where)).map((row) => [row.posId, row._count._all]));
  }
}
