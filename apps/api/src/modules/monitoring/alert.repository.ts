import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { UnitOfWork, after } from '../platform';
import { VERSION_CHECK_ROUTE } from './thresholds';
import type {
  ActivityRow, AlertFinding, AlertState, DoorRefusals, OpenAlert, PermissionRefusals, ProbeAnswers, RateLimited, RequestFailures, RequestSpeed, RouteCrashes,
} from './alert-rules';

/** The newest event times a group hands back, to count what came after an open alert's `lastAt`. */
const RECENT_MAX = 500;
const RECENT = Prisma.raw(`[1:${RECENT_MAX}]`);
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];
/** Refused sign-ins and second steps read a round at most: far over what the sign-in limit lets through in 15 minutes. */
const ACTIVITY_ROWS_MAX = 5_000;

type Position = NonNullable<Parameters<typeof after>[0]>;

type Times = { firstAt: Date; lastAt: Date; recent: (Date | string)[] | null };
/** A driver may hand an array of timestamps back as text: every time is made a `Date` here. */
const times = <Row extends Times>(rows: Row[]) => rows.map((row) => ({ ...row, firstAt: new Date(row.firstAt), lastAt: new Date(row.lastAt), recent: (row.recent ?? []).map((at) => new Date(at)) }));

/**
 * The database as the alerts read and write it (system monitor M.6). The counting queries read the request log (a
 * count by SQL) and the activity log (`ActivityEvent`: the refused sign-ins and second steps of the window, counted
 * by `alert-rules.ts`) directly, as monitoring reads the tables it watches; no row of another module is changed. The alerts themselves are
 * written by the worker's pass alone; the owner marks them seen and deletes closed ones.
 */
@Injectable()
export class AlertRepository {
  constructor(private readonly uow: UnitOfWork) {}

  // ── What the rules count ─────────────────────────────────────────────────────────────────────────────────────

  /** Refused sign-ins since `since`, newest first, `ACTIVITY_ROWS_MAX` at most. */
  signInFailureRows(since: Date): Promise<ActivityRow[]> {
    return this.activityRows({ action: 'login', result: 'fail', at: { gt: since } });
  }

  /** Wrong second-step codes (`two_factor` refused with `WRONG_CODE`) of a known account since `since`, newest first. */
  wrongCodeRows(since: Date): Promise<ActivityRow[]> {
    return this.activityRows({ action: 'two_factor', result: 'fail', reason: 'WRONG_CODE', actorId: { not: null }, at: { gt: since } });
  }

  private activityRows(where: Prisma.ActivityEventWhereInput): Promise<ActivityRow[]> {
    return this.uow.prisma.activityEvent.findMany({ where, select: { at: true, actorId: true, actorLoginName: true, reason: true, ip: true }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: ACTIVITY_ROWS_MAX });
  }

  /** `429` answers since `since`, by method, path, account and address; not the version check's own (`VERSION_CHECK_ROUTE`). */
  async rateLimited(since: Date): Promise<RateLimited[]> {
    return times(await this.uow.prisma.$queryRaw<(RateLimited & Times)[]>`
      SELECT "method", "path", "actorLoginName" AS "loginName", "actorId" AS "accountId", "ip", count(*)::int AS "hits",
             min("at") AS "firstAt", max("at") AS "lastAt", (array_agg("at" ORDER BY "at" DESC))${RECENT} AS "recent"
      FROM "RequestLog"
      WHERE "status" = 429 AND "at" > ${since} AND "route" <> ${VERSION_CHECK_ROUTE}
      GROUP BY "method", "path", "actorLoginName", "actorId", "ip"`);
  }

  /** `404` and `401` answers since `since`, by address and status. */
  async probeAnswers(since: Date): Promise<ProbeAnswers[]> {
    return times(await this.uow.prisma.$queryRaw<(ProbeAnswers & Times)[]>`
      SELECT "ip", "status", count(*)::int AS "answers",
             min("at") AS "firstAt", max("at") AS "lastAt", (array_agg("at" ORDER BY "at" DESC))${RECENT} AS "recent"
      FROM "RequestLog"
      WHERE "status" IN (401, 404) AND "ip" <> '' AND "at" > ${since}
      GROUP BY "ip", "status"`);
  }

  /**
   * Refusals of the door (`DOOR_MISMATCH`) and of the origin since `since`, by address. The origin's refusal is a
   * write answered `403 FORBIDDEN` before any route matched (`origin.middleware.ts`): a route's own `403` has a pattern.
   */
  async doorRefusals(since: Date): Promise<DoorRefusals[]> {
    return times(await this.uow.prisma.$queryRaw<(DoorRefusals & Times)[]>`
      SELECT "ip", count(*)::int AS "refusals",
             min("at") AS "firstAt", max("at") AS "lastAt", (array_agg("at" ORDER BY "at" DESC))${RECENT} AS "recent"
      FROM "RequestLog"
      WHERE ("code" = 'DOOR_MISMATCH' OR ("status" = 403 AND "code" = 'FORBIDDEN' AND "route" = '' AND "method" = ANY(${WRITES})))
        AND "ip" <> '' AND "at" > ${since}
      GROUP BY "ip"`);
  }

  /** `403` answers to a signed-in account since `since`, the door's refusals left to their own rule. */
  async permissionRefusals(since: Date): Promise<PermissionRefusals[]> {
    return times(await this.uow.prisma.$queryRaw<(PermissionRefusals & Times)[]>`
      SELECT "actorId" AS "accountId", (array_agg("actorLoginName" ORDER BY "at" DESC))[1] AS "loginName", count(*)::int AS "refusals",
             min("at") AS "firstAt", max("at") AS "lastAt", (array_agg("at" ORDER BY "at" DESC))${RECENT} AS "recent"
      FROM "RequestLog"
      WHERE "status" = 403 AND "code" <> 'DOOR_MISMATCH' AND "actorId" IS NOT NULL AND "at" > ${since}
      GROUP BY "actorId"`);
  }

  /** Every request since `since`: how many, how many 5xx. With none, both times are `since`. */
  async requestFailures(since: Date): Promise<RequestFailures> {
    const [row] = await this.uow.prisma.$queryRaw<{ requests: number; failed: number; firstAt: Date | null; lastAt: Date | null }[]>`
      SELECT count(*)::int AS "requests", (count(*) FILTER (WHERE "status" >= 500))::int AS "failed", min("at") AS "firstAt", max("at") AS "lastAt"
      FROM "RequestLog" WHERE "at" > ${since}`;
    return { requests: row?.requests ?? 0, failed: row?.failed ?? 0, firstAt: new Date(row?.firstAt ?? since), lastAt: new Date(row?.lastAt ?? since) };
  }

  /** 5xx answers since `since`, by route. */
  async routeCrashes(since: Date): Promise<RouteCrashes[]> {
    return times(await this.uow.prisma.$queryRaw<(RouteCrashes & Times)[]>`
      SELECT "method", "route", count(*)::int AS "crashes",
             min("at") AS "firstAt", max("at") AS "lastAt", (array_agg("at" ORDER BY "at" DESC))${RECENT} AS "recent"
      FROM "RequestLog"
      WHERE "status" >= 500 AND "at" > ${since}
      GROUP BY "method", "route"`);
  }

  /** Every request since `since`: how many, and the 95th percentile of their durations (whole ms). */
  async requestSpeed(since: Date): Promise<RequestSpeed> {
    const [row] = await this.uow.prisma.$queryRaw<{ requests: number; p95Ms: number | null; firstAt: Date | null; lastAt: Date | null }[]>`
      SELECT count(*)::int AS "requests", round(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"))::int AS "p95Ms",
             min("at") AS "firstAt", max("at") AS "lastAt"
      FROM "RequestLog" WHERE "at" > ${since}`;
    return { requests: row?.requests ?? 0, p95Ms: row?.p95Ms ?? 0, firstAt: new Date(row?.firstAt ?? since), lastAt: new Date(row?.lastAt ?? since) };
  }

  // ── The alerts ───────────────────────────────────────────────────────────────────────────────────────────────

  openAlerts(): Promise<OpenAlert[]> {
    return this.uow.prisma.alert.findMany({ where: { state: 'open' }, select: { id: true, kind: true, key: true, count: true, lastAt: true } });
  }

  /**
   * Opens an alert, unless one is already open for its kind and key (the partial unique index): answers its id,
   * or null when another pass opened it first, so that only the pass that opened it tells the owner.
   */
  async open(tx: Prisma.TransactionClient, finding: AlertFinding): Promise<string | null> {
    const { subject } = finding;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "Alert" ("id", "kind", "key", "state", "loginName", "accountId", "ip", "method", "route", "path", "part", "detail", "count", "firstAt", "lastAt")
      VALUES (gen_random_uuid()::text, ${finding.kind}, ${finding.key}, 'open', ${subject.loginName}, ${subject.accountId}, ${subject.ip}, ${subject.method},
              ${subject.route}, ${subject.path}, ${subject.part}, ${subject.detail}, ${finding.count}, ${finding.firstAt}, ${finding.lastAt})
      ON CONFLICT ("kind", "key") WHERE "state" = 'open' DO NOTHING
      RETURNING "id"`;
    return rows[0]?.id ?? null;
  }

  /** Raises an open alert; a closed one is left as it is. */
  raise(id: string, add: number, lastAt: Date) {
    return this.uow.prisma.alert.updateMany({ where: { id, state: 'open' }, data: { count: { increment: add }, lastAt } });
  }

  /** Closes open alerts; answers how many it closed. */
  async close(ids: string[], at: Date): Promise<number> {
    if (ids.length === 0) return 0;
    return (await this.uow.prisma.alert.updateMany({ where: { id: { in: ids }, state: 'open' }, data: { state: 'closed', closedAt: at } })).count ?? 0;
  }

  /** The branch owners who are not frozen: the alerts' audience (D1, D4). */
  branchOwners(tx: Prisma.TransactionClient) {
    return tx.user.findMany({ where: { isBranchOwner: true, layer: 'branch', disabledAt: null }, select: { id: true } });
  }

  // ── The owner's page ─────────────────────────────────────────────────────────────────────────────────────────

  /** The state of the alert a cursor names; null when it is gone (only closed alerts are deleted). */
  async stateOf(id: string): Promise<AlertState | null> {
    return ((await this.uow.prisma.alert.findUnique({ where: { id }, select: { state: true } }))?.state as AlertState | undefined) ?? null;
  }

  /**
   * The alerts, open first, then closed, each newest `lastAt` first; after the cursor's alert. A cursor on an open
   * alert reads the open ones after it and then every closed one; a cursor on a closed one, the closed ones after it.
   */
  rows(state: AlertState | undefined, position: (Position & { state: AlertState }) | undefined, take: number) {
    const closed: Prisma.AlertWhereInput = { state: 'closed', AND: position?.state === 'closed' ? after(position, 'lastAt') : [] };
    const open: Prisma.AlertWhereInput = { state: 'open', AND: after(position, 'lastAt') };
    const where: Prisma.AlertWhereInput = position?.state === 'closed' ? closed : { OR: [open, { state: 'closed' }] };
    return this.uow.prisma.alert.findMany({
      where: { AND: [where, ...(state ? [{ state }] : [])] },
      orderBy: [{ state: 'desc' }, { lastAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  count(state: AlertState | undefined) {
    return this.uow.prisma.alert.count({ where: state ? { state } : {} });
  }

  /** Marks an alert seen, once: the first owner who saw it is kept. Answers how many it marked (0 or 1). */
  async markSeen(id: string, by: { id: string; loginName: string }, at: Date): Promise<number> {
    return (await this.uow.prisma.alert.updateMany({ where: { id, seenAt: null }, data: { seenAt: at, seenById: by.id, seenByLoginName: by.loginName } })).count ?? 0;
  }

  seenOf(id: string) {
    return this.uow.prisma.alert.findUnique({ where: { id }, select: { id: true, seenAt: true, seenByLoginName: true } });
  }

  /** Deletes the closed alerts, and never an open one; answers how many. */
  async clearClosed(): Promise<number> {
    return (await this.uow.prisma.alert.deleteMany({ where: { state: 'closed' } })).count ?? 0;
  }
}
