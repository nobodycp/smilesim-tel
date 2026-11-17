import { Injectable } from '@nestjs/common';
import { FEED_PAGE, capList, cursorPosition, dayRange, page, parseInput } from '../platform';
import { requireOwner, type Actor } from '../access';
import { RequestLogRepository } from './request-log.repository';
import { RequestLogWriter } from './request-log.writer';
import { RequestErrorsQuery, RequestLogFilterQuery, RequestLogQuery, type RequestLogFilterInput } from './request-log.schemas';
import { errorRate, statusRange, type RequestFilter } from './request-log.rules';

/** The server errors' list stops at this many groups (a capped list, backend-engineering.mdc 4.7). */
const ERROR_GROUPS = 100;
/**
 * The request log as the branch owner reads and clears it (spec 2026-11-17-system-monitor, section 2). Every use
 * case asks the policy first: the owner in person, no one else (D1), and no entered session.
 */
@Injectable()
export class RequestLogService {
  constructor(private readonly repo: RequestLogRepository, private readonly writer: RequestLogWriter) {}

  /** The rows under the filters, newest first, paged by cursor. */
  async list(actor: Actor, input: RequestLogQuery = {}) {
    requireOwner(actor);
    const query = parseInput(RequestLogQuery, input);
    const filter = await this.filterOf(query);
    const position = cursorPosition(query.cursor);
    const [rows, total] = await Promise.all([this.repo.rows(filter, position, FEED_PAGE + 1), this.repo.count(filter)]);
    const { items, nextCursor } = page(rows, FEED_PAGE, (row) => row.at);
    const operators = [...new Set(items.map((row) => row.operatorId).filter((id): id is string => Boolean(id)))];
    const names = new Map((operators.length > 0 ? await this.repo.loginNames(operators) : []).map((user) => [user.id, user.loginName]));
    return {
      items: items.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        durationMs: row.durationMs,
        method: row.method,
        route: row.route,
        path: row.path,
        status: row.status,
        code: row.code,
        actorLoginName: row.actorLoginName,
        layer: row.layer,
        // An entered session: who entered (empty when that account is gone since).
        operatorLoginName: row.operatorId ? (names.get(row.operatorId) ?? '') : null,
        ip: row.ip,
        userAgent: row.userAgent,
        requestId: row.requestId,
        bytesIn: row.bytesIn,
        bytesOut: row.bytesOut,
      })),
      nextCursor,
      total,
    };
  }

  /** For the rows under the filters: how many, how many refused and failed, the error rate, the slowest and busiest routes. */
  async summary(actor: Actor, input: RequestLogFilterQuery = {}) {
    requireOwner(actor);
    const filter = await this.filterOf(parseInput(RequestLogFilterQuery, input));
    const [totals, routes] = await Promise.all([this.repo.totals(filter), this.repo.routeFigures(filter)]);
    return { ...totals, errorRate: errorRate(totals.failed, totals.count), slowest: routes.slowest, busiest: routes.busiest };
  }

  /**
   * Deletes every row of the request log and every server error (D5: «مسح السجل» clears requests and their errors);
   * the activity log records it, with the count of requests, by the route. What still waits in this process's
   * writer is written first, so the requests made before the clearing go with it; the clearing's own request is
   * written after it.
   */
  async clear(actor: Actor) {
    requireOwner(actor);
    await this.writer.flush();
    return this.repo.clear();
  }
  /**
   * The server errors (5xx) under the filters, grouped by route and message (spec section 3): how many, first and last
   * seen, the last request id and its stack's top; the group seen last first, `ERROR_GROUPS` groups at most (`capped`
   * says more were there). `total` counts the errors under the filters, every group's.
   */
  async errors(actor: Actor, input: RequestErrorsQuery = {}) {
    requireOwner(actor);
    const query = parseInput(RequestErrorsQuery, input);
    const { from, to } = dayRange(query.from, query.to);
    const filter = { ...(query.route ? { route: query.route } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
    const [groups, total] = await Promise.all([this.repo.errorGroups(filter, ERROR_GROUPS + 1), this.repo.errorCount(filter)]);
    const { rows, capped } = capList(groups, ERROR_GROUPS);
    return {
      items: rows.map((group) => ({
        method: group.method,
        route: group.route,
        name: group.name,
        message: group.message,
        count: group.count,
        firstAt: group.firstAt.toISOString(),
        lastAt: group.lastAt.toISOString(),
        lastRequestId: group.lastRequestId,
        stack: group.stack === '' ? [] : group.stack.split('\n'),
      })),
      capped,
      total,
    };
  }
  /** Deletes every server error and leaves the requests (spec section 3: «or alone»); recorded like the clearing of the log. */
  async clearErrors(actor: Actor) {
    requireOwner(actor);
    await this.writer.flush();
    return { removed: await this.repo.clearErrors() };
  }

  private async filterOf(query: RequestLogFilterInput): Promise<RequestFilter> {
    const { from, to } = dayRange(query.from, query.to);
    const loginName = query.account?.toLowerCase();
    return {
      ...(query.status ? { status: statusRange(query.status) } : {}),
      ...(query.code ? { code: query.code } : {}),
      ...(query.route ? { route: query.route } : {}),
      ...(loginName ? { account: { loginName, id: await this.repo.accountId(loginName) } } : {}),
      ...(query.ip ? { ip: query.ip } : {}),
      ...(query.slowerThan ? { slowerThan: Number(query.slowerThan) } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }
}
