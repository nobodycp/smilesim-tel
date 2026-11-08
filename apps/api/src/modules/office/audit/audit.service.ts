import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { activityActorFilter, clampActivityRange } from '../activity-log';
import { feedPosition } from '../kernel/feed';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { FEED_PAGE, encodeFeedCursor } from '../office-paging';
import { visibleAccountIds } from '../office-rules';

/** The activity log as the signed-in account may read it: its own subtree, filtered and paged. */
@Injectable()
export class AuditService {
  constructor(private readonly kernel: OfficeKernel) {}

  async list(actor: Actor, query: { cursor?: string; action?: string; result?: string; layer?: string; q?: string; from?: string; to?: string } = {}) {
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const position = feedPosition(query.cursor);
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999Z` : query.to) : null;
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
    const [rows, total] = await Promise.all([
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
    ]);
    const page = rows.slice(0, FEED_PAGE);
    const last = page[page.length - 1];
    return {
      total,
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
}
