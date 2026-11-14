import { isOn } from '../shared/schemas';
import { AuditQuery, type AuditFilter } from './audit.schemas';
import { parseInput } from '../shared/input';
import { AccountTree } from '../office/kernel/account-tree';
import { AuditRepository } from './audit.repository';
import { dayRange } from '../shared/dates';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { activityActorFilter, clampActivityRange } from './activity-log';
import type { Actor } from '../office/kernel/types';
import { after, cursorPosition, page } from '../shared/paging';
import { FEED_PAGE } from '../office/rules/office-paging';
import { visibleAccountIds } from '../office/rules/account-visibility';
import { csvDocument } from '../shared/csv';

/** The most events one CSV holds. */
export const AUDIT_EXPORT_LIMIT = 5_000;

/** The activity log as the signed-in account may read it: its own subtree, filtered and paged. */
@Injectable()
export class AuditService {
  constructor(private readonly tree: AccountTree, private readonly repo: AuditRepository) {}

  /** The filter every read of the log shares: the viewer's subtree, then the person's own filters. */
  private async whereFor(actor: Actor, query: AuditFilter): Promise<Prisma.ActivityEventWhereInput> {
    const accounts = await this.tree.accounts();
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
        ? { OR: [{ actorLoginName: { contains: needle, mode: 'insensitive' } }, { subjectRef: { contains: needle, mode: 'insensitive' } }] }
        : {}),
    };
    return where;
  }

  async list(actor: Actor, input: AuditQuery = {}) {
    const query = parseInput(AuditQuery, input);
    const where = await this.whereFor(actor, query);
    const position = cursorPosition(query.cursor);
    const [rows, total, addresses] = await Promise.all([
      this.repo.events({ ...where, AND: after(position, 'at') }, FEED_PAGE + 1),
      this.repo.eventCount(where),
      // On request (the failed sign-ins figure): from how many network addresses the matching events came.
      isOn(query.addresses) ? this.repo.addressCount(where) : Promise.resolve(undefined),
    ]);
    const { items, nextCursor } = page(rows, FEED_PAGE, (row) => row.at);
    return {
      total,
      ...(addresses === undefined ? {} : { addresses }),
      items: items.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        action: row.action,
        result: row.result,
        reason: row.reason,
        ip: row.ip,
        actorLoginName: row.actorLoginName,
        actorLayer: row.actorLayer,
        subjectKind: row.subjectKind,
        subjectRef: row.subjectRef,
      })),
      nextCursor,
    };
  }

  /** The log under the same filters as a CSV, newest first, at most `AUDIT_EXPORT_LIMIT` events. */
  async csv(actor: Actor, input: AuditQuery = {}) {
    const query = parseInput(AuditQuery, input);
    const rows = await this.repo.events(await this.whereFor(actor, query), AUDIT_EXPORT_LIMIT);
    return csvDocument(
      ['at', 'account', 'layer', 'action', 'subject', 'result', 'reason', 'ip'],
      rows.map((row) => [row.at.toISOString(), row.actorLoginName, row.actorLayer ?? '', row.action, row.subjectRef ?? '', row.result, row.reason ?? '', (row.ip ?? '').replace(/^::ffff:/, '')]),
    );
  }
}
