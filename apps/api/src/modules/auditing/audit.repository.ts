import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { UnitOfWork } from '../platform';

/**
 * The database as this domain reads and writes it: the activity log. One method per query, named for what it returns or
 * changes. No rule and no permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class AuditRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Events under the filter, newest first. */
  events(where: Prisma.ActivityEventWhereInput, take: number) {
    return this.uow.prisma.activityEvent.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], take });
  }

  /** How many events `where` holds, `take` at most, counted in the page's order (`countUpTo`, plan DB.8). */
  eventCount(where: Prisma.ActivityEventWhereInput, take: number) {
    return this.uow.prisma.activityEvent.count({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], take });
  }

  /** From how many network addresses the events under the filter came. */
  async addressCount(where: Prisma.ActivityEventWhereInput) {
    const groups = await this.uow.prisma.activityEvent.groupBy({ by: ['ip'], where: { AND: [where, { ip: { not: '' } }] } });
    return groups.length;
  }
}
