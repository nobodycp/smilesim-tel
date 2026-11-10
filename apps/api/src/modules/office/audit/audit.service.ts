import { dayRange } from '../../shared/dates';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { activityActorFilter, clampActivityRange } from '../activity/activity-log';
import { feedPosition } from '../kernel/feed';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { FEED_PAGE, encodeFeedCursor } from '../rules/office-paging';
import { visibleAccountIds } from '../rules/office-rules';
import { csvOf } from '../reports/report-csv';

type AuditQuery = { cursor?: string; action?: string; result?: string; layer?: string; q?: string; from?: string; to?: string; addresses?: string };
/** The most events one CSV holds. */
export const AUDIT_EXPORT_LIMIT = 5_000;

/** The activity log as the signed-in account may read it: its own subtree, filtered and paged. */
@Injectable()
export class AuditService {
  constructor(private readonly kernel: OfficeKernel) {}

  /** The filter every read of the log shares: the viewer's subtree, then the person's own filters. */
  private async whereFor(actor: Actor, query: AuditQuery): Promise<Prisma.ActivityEventWhereInput> {
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const { from, to } = dayRange(query.from, query.to);
    const range = clampActivityRange(from, to);
    const needle = (query.q ?? '').trim();
    const where: Prisma.ActivityEventWhereInput = {
      ...activityActorFilter(actor.layer, [...visible]),
      ...(query.action ? { action: query.action } : {}),
      ...(query.result === 'ok' || query.result === 'fail' ? { result: query.result } : {}),
      ...(query.layer ? { actorLayer: query.layer } : {}),
      at: { gte: range.gte, lte: range.lte },
      ...(needle
        ? { OR: [{ actorLogin: { contains: needle, mode: 'insensitive' } }, { subjectRef: { contains: needle, mode: 'insensitive' } }] }
        : {}),
    };
    return where;
  }

  async list(actor: Actor, query: AuditQuery = {}) {
    const where = await this.whereFor(actor, query);
    const position = feedPosition(query.cursor);
    const [rows, total, addresses] = await Promise.all([
      this.kernel.prisma.activityEvent.findMany({
        where: {
          ...where,
          ...(position
            ? { AND: [{ OR: [{ at: { lt: position.at } }, { at: position.at, id: { lt: position.id } }] }] }
            : {}),
        },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: FEED_PAGE + 1,
      }),
      this.kernel.prisma.activityEvent.count({ where }),
      // On request (the failed sign-ins figure): from how many network addresses the matching events came.
      query.addresses === '1'
        ? this.kernel.prisma.activityEvent.groupBy({ by: ['ip'], where: { AND: [where, { ip: { not: '' } }] } }).then((groups) => groups.length)
        : Promise.resolve(undefined),
    ]);
    const page = rows.slice(0, FEED_PAGE);
    const last = page[page.length - 1];
    return {
      total,
      ...(addresses === undefined ? {} : { addresses }),
      entries: page.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        action: row.action,
        result: row.result,
        reason: row.reason,
        ip: row.ip,
        actorLogin: row.actorLogin,
        actorLayer: row.actorLayer,
        subjectKind: row.subjectKind,
        subjectRef: row.subjectRef,
      })),
      nextCursor: rows.length > FEED_PAGE && last ? encodeFeedCursor({ createdAt: last.at, id: last.id }) : null,
    };
  }

  /** The log under the same filters as a CSV, newest first, at most `AUDIT_EXPORT_LIMIT` events. */
  async csv(actor: Actor, query: AuditQuery = {}) {
    const rows = await this.kernel.prisma.activityEvent.findMany({
      where: await this.whereFor(actor, query),
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: AUDIT_EXPORT_LIMIT,
    });
    return csvOf(
      ['at', 'account', 'layer', 'action', 'subject', 'result', 'reason', 'ip'],
      rows.map((row) => [row.at.toISOString(), row.actorLogin, row.actorLayer ?? '', row.action, row.subjectRef ?? '', row.result, row.reason ?? '', (row.ip ?? '').replace(/^::ffff:/, '')]),
    );
  }
}
