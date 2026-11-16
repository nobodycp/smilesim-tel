import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { UnitOfWork } from '../platform';

/**
 * The database as the request log reads and writes it. One method per query, named for what it returns or changes.
 * No rule and no permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class RequestLogRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** One batch of rows in one statement. */
  insertMany(rows: Prisma.RequestLogCreateManyInput[]) {
    return this.uow.prisma.requestLog.createMany({ data: rows });
  }

  /**
   * Who each session belongs to, by the hash of its token (as sign-in stores it). Revoked or expired sessions are
   * named too: the row says whose cookie came with the request, not whether it was still good.
   */
  sessionsByHash(hashes: string[]) {
    return this.uow.prisma.session.findMany({
      where: { tokenHash: { in: hashes } },
      select: { tokenHash: true, kind: true, operatorId: true, user: { select: { id: true, loginName: true, layer: true } } },
    });
  }
}
