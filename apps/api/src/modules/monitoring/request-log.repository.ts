import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { UnitOfWork, after } from '../platform';
import { likeLiteral, type ErrorFilter, type RequestFilter } from './request-log.rules';

/** One route's figures in the summary: how often it was called and how long it took, in whole milliseconds. */
export type RouteFigures = { method: string; route: string; calls: number; medianMs: number; p95Ms: number };

/** How many of the summary's slowest and most called routes are named. */
export const SUMMARY_ROUTES = 5;
/** One group of server errors: a route and a message, how often, first and last seen, the last request and its stack. */
type ErrorGroupRow = { method: string; route: string; name: string; message: string; count: number; firstAt: Date; lastAt: Date; lastRequestId: string; stack: string };

type Position = Parameters<typeof after>[0];

/**
 * The database as the request log reads and writes it. One method per query, named for what it returns or changes.
 * No rule and no permission lives here (backend-engineering.mdc 5.1). A filter is turned into a Prisma `where` for
 * the rows and into SQL for the summary, side by side here, so the two read the same rows.
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

  /** The id of the account with this login name, or null. */
  async accountId(loginName: string): Promise<string | null> {
    return (await this.uow.prisma.user.findUnique({ where: { loginName }, select: { id: true } }))?.id ?? null;
  }

  /** The login names of the given accounts, by id (the accounts that entered others, for one page). */
  loginNames(ids: string[]) {
    return this.uow.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, loginName: true } });
  }

  /** The rows under the filter after the cursor, newest first. */
  rows(filter: RequestFilter, position: Position, take: number) {
    return this.uow.prisma.requestLog.findMany({ where: { AND: [whereOf(filter), ...after(position, 'at')] }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take });
  }

  count(filter: RequestFilter) {
    return this.uow.prisma.requestLog.count({ where: whereOf(filter) });
  }

  /** How many rows the filter holds, how many were refused (4xx) and how many failed (5xx): counted by the database. */
  async totals(filter: RequestFilter): Promise<{ count: number; refused: number; failed: number }> {
    const [row] = await this.uow.prisma.$queryRaw<{ count: number; refused: number; failed: number }[]>`
      SELECT count(*)::int AS "count",
             (count(*) FILTER (WHERE "status" BETWEEN 400 AND 499))::int AS "refused",
             (count(*) FILTER (WHERE "status" >= 500))::int AS "failed"
      FROM "RequestLog" WHERE ${sqlOf(filter)}`;
    return { count: row?.count ?? 0, refused: row?.refused ?? 0, failed: row?.failed ?? 0 };
  }

  /**
   * The slowest routes (by their 95th percentile) and the most called, `SUMMARY_ROUTES` of each, with the median and
   * the 95th percentile of their durations: grouped and ranked by the database (`percentile_cont`, interpolated,
   * rounded to whole milliseconds). A route is its method and pattern; requests no route matched are one group, `''`.
   */
  async routeFigures(filter: RequestFilter): Promise<{ slowest: RouteFigures[]; busiest: RouteFigures[] }> {
    const rows = await this.uow.prisma.$queryRaw<(RouteFigures & { list: 'slowest' | 'busiest' })[]>`
      WITH "figures" AS (
        SELECT "method", "route", count(*)::int AS "calls",
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs"))::int AS "medianMs",
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"))::int AS "p95Ms"
        FROM "RequestLog" WHERE ${sqlOf(filter)}
        GROUP BY "method", "route"
      )
      (SELECT 'slowest' AS "list", * FROM "figures" ORDER BY "p95Ms" DESC, "medianMs" DESC, "calls" DESC, "route", "method" LIMIT ${SUMMARY_ROUTES})
      UNION ALL
      (SELECT 'busiest' AS "list", * FROM "figures" ORDER BY "calls" DESC, "p95Ms" DESC, "route", "method" LIMIT ${SUMMARY_ROUTES})`;
    const figures = (list: string) => rows.filter((row) => row.list === list).map(({ method, route, calls, medianMs, p95Ms }) => ({ method, route, calls, medianMs, p95Ms }));
    return { slowest: figures('slowest'), busiest: figures('busiest') };
  }

  /** One batch of server errors in one statement. */
  insertErrors(rows: Prisma.RequestErrorCreateManyInput[]) {
    return this.uow.prisma.requestError.createMany({ data: rows });
  }
  /**
   * The server errors under the filter, grouped by method, route, class and message, the group seen last first;
   * `limit` groups at most. Each group names its last request and that request's stack, chosen by the database.
   */
  errorGroups(filter: ErrorFilter, limit: number) {
    return this.uow.prisma.$queryRaw<ErrorGroupRow[]>`
      SELECT "method", "route", "name", "message", count(*)::int AS "count", min("at") AS "firstAt", max("at") AS "lastAt",
             (array_agg("requestId" ORDER BY "at" DESC, "id" DESC))[1] AS "lastRequestId",
             (array_agg("stack" ORDER BY "at" DESC, "id" DESC))[1] AS "stack"
      FROM "RequestError" WHERE ${errorSqlOf(filter)}
      GROUP BY "method", "route", "name", "message"
      ORDER BY "lastAt" DESC, "count" DESC, "route", "method", "name", "message"
      LIMIT ${limit}`;
  }
  /** How many server errors the filter holds. */
  errorCount(filter: ErrorFilter) {
    return this.uow.prisma.requestError.count({ where: errorWhereOf(filter) });
  }
  /** Deletes every server error, and nothing else; answers how many. */
  async clearErrors(): Promise<number> {
    return (await this.uow.prisma.requestError.deleteMany({})).count ?? 0;
  }
  /** Deletes every row of the request log and every server error, in one transaction (D5); answers both counts. */
  clear(): Promise<{ removed: number; errorsRemoved: number }> {
    return this.uow.runTx(async (tx) => {
      const removed = (await tx.requestLog.deleteMany({})).count ?? 0;
      const errorsRemoved = (await tx.requestError.deleteMany({})).count ?? 0;
      return { removed, errorsRemoved };
    });
  }
}
/** The errors' filter as Prisma's `where`. */
function errorWhereOf(filter: ErrorFilter): Prisma.RequestErrorWhereInput {
  const and: Prisma.RequestErrorWhereInput[] = [];
  if (filter.route !== undefined) and.push({ route: filter.route });
  if (filter.from) and.push({ at: { gte: filter.from } });
  if (filter.to) and.push({ at: { lte: filter.to } });
  return and.length > 0 ? { AND: and } : {};
}
/** The same filter as SQL; values are parameters. */
function errorSqlOf(filter: ErrorFilter): Prisma.Sql {
  const and: Prisma.Sql[] = [];
  if (filter.route !== undefined) and.push(Prisma.sql`"route" = ${filter.route}`);
  if (filter.from) and.push(Prisma.sql`"at" >= ${filter.from}`);
  if (filter.to) and.push(Prisma.sql`"at" <= ${filter.to}`);
  return and.length > 0 ? Prisma.join(and, ' AND ') : Prisma.sql`TRUE`;
}

/**
 * The filter as Prisma's `where`. Prisma's `contains` and `startsWith` do not escape `LIKE`'s wildcards, so the
 * text is escaped here (`likeLiteral`), the same as the SQL beside it.
 */
function whereOf(filter: RequestFilter): Prisma.RequestLogWhereInput {
  const and: Prisma.RequestLogWhereInput[] = [];
  if (filter.status) and.push({ status: filter.status });
  if (filter.code) and.push({ code: filter.code });
  if (filter.method) and.push({ method: filter.method });
  if (filter.route !== undefined) and.push({ route: filter.route });
  if (filter.pathContains) and.push({ path: { contains: likeLiteral(filter.pathContains), mode: 'insensitive' } });
  if (filter.account) {
    const { loginName, id } = filter.account;
    and.push({ OR: [{ actorLoginName: loginName }, ...(id ? [{ actorId: id }, { operatorId: id }] : [])] });
  }
  if (filter.ipStartsWith) and.push({ ip: { startsWith: likeLiteral(filter.ipStartsWith) } });
  if (filter.slowerThan !== undefined) and.push({ durationMs: { gt: filter.slowerThan } });
  if (filter.from) and.push({ at: { gte: filter.from } });
  if (filter.to) and.push({ at: { lte: filter.to } });
  return and.length > 0 ? { AND: and } : {};
}

/** The same filter as SQL, for the queries the database groups and ranks. Values are parameters, never text. */
function sqlOf(filter: RequestFilter): Prisma.Sql {
  const and: Prisma.Sql[] = [];
  if (filter.status) and.push(Prisma.sql`"status" BETWEEN ${filter.status.gte} AND ${filter.status.lte}`);
  if (filter.code) and.push(Prisma.sql`"code" = ${filter.code}`);
  if (filter.method) and.push(Prisma.sql`"method" = ${filter.method}`);
  if (filter.route !== undefined) and.push(Prisma.sql`"route" = ${filter.route}`);
  if (filter.pathContains) and.push(Prisma.sql`"path" ILIKE ${`%${likeLiteral(filter.pathContains)}%`}`);
  if (filter.account) {
    const { loginName, id } = filter.account;
    and.push(id ? Prisma.sql`("actorLoginName" = ${loginName} OR "actorId" = ${id} OR "operatorId" = ${id})` : Prisma.sql`"actorLoginName" = ${loginName}`);
  }
  if (filter.ipStartsWith) and.push(Prisma.sql`"ip" LIKE ${`${likeLiteral(filter.ipStartsWith)}%`}`);
  if (filter.slowerThan !== undefined) and.push(Prisma.sql`"durationMs" > ${filter.slowerThan}`);
  if (filter.from) and.push(Prisma.sql`"at" >= ${filter.from}`);
  if (filter.to) and.push(Prisma.sql`"at" <= ${filter.to}`);
  return and.length > 0 ? Prisma.join(and, ' AND ') : Prisma.sql`TRUE`;
}

