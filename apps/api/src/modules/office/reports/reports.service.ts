import { UnitOfWork } from '../kernel/unit-of-work';
import { requireGrant } from '../policy';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { LineReads } from '../lines/line-reads';
import { TasksService } from '../tasks/tasks.service';
import { feedPosition } from '../kernel/feed';
import { FEED_PAGE, NEWEST_FIRST, afterFeed, mergeFeed } from '../rules/office-paging';
import { PROVIDER_OPERATION_KINDS } from '../wallets/provider-cost';

/** Branch reports: providers and packages, the provider-operations ledger, and the task and number lists. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tasks: TasksService,
    private readonly lines: LineReads,
  ) {}

  async report(actor: Actor, kind: string, cursor?: string) {
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    requireGrant(actor, 'reports', 'REPORTS_BRANCH_ONLY');
    if (kind === 'providers') return this.providerReport();
    if (kind === 'operations') return this.entryReport(cursor, PROVIDER_OPERATION_KINDS);
    if (kind === 'tasks') {
      const listed = await this.tasks.list(actor, { cursor });
      return { tasks: listed.tasks, nextCursor: listed.nextCursor, total: listed.total };
    }
    if (kind === 'numbers') {
      const listed = await this.lines.list(actor, { cursor });
      return { lines: listed.lines, nextCursor: listed.nextCursor, total: listed.total };
    }
    fail(404, 'NOT_FOUND');
  }

  private async providerReport() {
    const rows = await this.uow.prisma.package.findMany({
      where: { companyId: { not: null } },
      include: { provider: true, company: true, _count: { select: { lines: true } } },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' } ],
    });
    return {
      total: rows.length,
      rows: rows.map((row) => ({
        providerName: row.provider.name,
        companyName: row.company?.name ?? '',
        packageName: row.name,
        price: row.branchCost,
        lines: row._count.lines,
      })),
    };
  }

  private async entryReport(cursor: string | undefined, kinds?: string[]) {
    const where = kinds ? { kind: { in: kinds } } : {};
    const [read, total] = await Promise.all([
      this.uow.prisma.walletEntry.findMany({
        where: { ...where, AND: afterFeed(feedPosition(cursor)) },
        include: { user: true, actor: true },
        orderBy: [...NEWEST_FIRST],
        take: FEED_PAGE + 1,
      }),
      this.uow.prisma.walletEntry.count({ where }),
    ]);
    const { page: rows, nextCursor } = mergeFeed([read], FEED_PAGE);
    return {
      total,
      entries: rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        loginName: row.user.loginName,
        actorLogin: row.actor.loginName,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        kind: row.kind,
        note: row.note,
      })),
      nextCursor,
    };
  }
}
