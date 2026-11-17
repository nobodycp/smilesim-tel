import { Injectable } from '@nestjs/common';
import { FEED_PAGE, countUpTo, cursorPosition, fail, page, parseInput } from '../platform';
import { requireOwner, type Actor } from '../access';
import { AlertRepository } from './alert.repository';
import { linkOf, type AlertState } from './alert-rules';
import { AlertsQuery } from './alerts.schemas';

/**
 * The early warnings as the branch owner reads them (spec 2026-11-17-system-monitor, section 4; slice M.6). The
 * worker's pass writes them; here they are listed, marked seen and, once closed, cleared. Every use case asks the
 * policy first: the owner in person, no one else (D1), and no entered session.
 */
@Injectable()
export class AlertsService {
  constructor(private readonly repo: AlertRepository) {}

  /** Open first, then closed, each the newest first, paged by cursor; each with the request-log filters behind it. */
  async list(actor: Actor, input: AlertsQuery = {}) {
    requireOwner(actor);
    const query = parseInput(AlertsQuery, input);
    const position = cursorPosition(query.cursor);
    // The cursor names an alert: whether it was open says which part of the list it stopped in. A gone one was
    // closed (an open alert is never deleted).
    const cursor = position ? { ...position, state: (await this.repo.stateOf(position.id)) ?? ('closed' as AlertState) } : undefined;
    const [rows, counted] = await Promise.all([this.repo.rows(query.state, cursor, FEED_PAGE + 1), countUpTo((take) => this.repo.count(query.state, take))]);
    const { items, nextCursor } = page(rows, FEED_PAGE, (row) => row.lastAt);
    return {
      items: items.map((row) => ({
        id: row.id,
        kind: row.kind,
        state: row.state,
        loginName: row.loginName,
        ip: row.ip,
        method: row.method,
        route: row.route,
        path: row.path,
        part: row.part,
        detail: row.detail,
        count: row.count,
        firstAt: row.firstAt.toISOString(),
        lastAt: row.lastAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        seenAt: row.seenAt?.toISOString() ?? null,
        seenByLoginName: row.seenByLoginName,
        link: linkOf(row),
      })),
      nextCursor,
      ...counted,
    };
  }

  /**
   * Marks an alert seen by the owner: it leaves the count of `GET /v1/me` and stays as it is otherwise (an open one
   * stays open until its rule is quiet). Seen twice, the first stays. 404 for an alert that is not there.
   */
  async markSeen(actor: Actor, id: string) {
    requireOwner(actor);
    await this.repo.markSeen(id, { id: actor.id, loginName: actor.loginName }, new Date());
    const seen = await this.repo.seenOf(id);
    if (!seen?.seenAt) return fail(404, 'NOT_FOUND');
    return { id: seen.id, seenAt: seen.seenAt.toISOString(), seenByLoginName: seen.seenByLoginName };
  }

  /** Deletes the closed alerts (an open one is still happening, D5); recorded in the activity log with the count. */
  async clear(actor: Actor) {
    requireOwner(actor);
    return { removed: await this.repo.clearClosed() };
  }
}
