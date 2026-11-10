import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork } from '../kernel/unit-of-work';
import { NEWEST_FIRST } from '../../shared/paging';

/**
 * The database as this domain reads and writes it: an account's notices. One method per query, named for what it returns or
 * changes. No rule and no permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class NoticesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** Notices under the filter, newest first. */
  notices(where: Prisma.NoticeWhereInput, take: number) {
    return this.uow.prisma.notice.findMany({ where, orderBy: [...NEWEST_FIRST], take });
  }

  noticeCount(where: Prisma.NoticeWhereInput) {
    return this.uow.prisma.notice.count({ where });
  }

  /** Marks one unread notice of the account read, or every unread one when no id is given. */
  markRead(userId: string, id?: string) {
    return this.uow.prisma.notice.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  }
}
