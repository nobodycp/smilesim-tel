import { assertStoredSealed, UnitOfWork, type Db, NEWEST_FIRST } from '../platform';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

/**
 * The database as this domain reads and writes it: numbers, and the packages and add-ons an operation on a number reads. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class LinesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  // Numbers as they are read.

  /** The distinct suspension periods the packages use. */
  suspendPeriods() {
    return this.uow.prisma.package.findMany({ distinct: ['suspendAfterDays'], select: { suspendAfterDays: true } });
  }

  /**
   * The ids of the packages whose name, or whose company's name, contains one of these texts, case aside: the
   * catalog is read first so the numbers list filters the lines by an id list (search, plan DB.6).
   */
  async packageIdsNamed(texts: string[]): Promise<string[]> {
    if (texts.length === 0) return [];
    const rows = await this.uow.prisma.package.findMany({
      where: {
        OR: texts.flatMap((text) => [
          { name: { contains: text, mode: 'insensitive' as const } },
          { company: { name: { contains: text, mode: 'insensitive' as const } } },
        ]),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** One page of numbers (and one row more), newest first, each with its package, company and point of sale. */
  linesPage(where: Prisma.LineWhereInput, take: number) {
    return this.uow.prisma.line.findMany({
      where,
      include: { package: { include: { company: true } }, pos: true },
      orderBy: [...NEWEST_FIRST],
      take,
    });
  }

  countLines(where: Prisma.LineWhereInput) {
    return this.uow.prisma.line.count({ where });
  }

  /** One number as its card shows it: its package with company and provider, and its point of sale. */
  lineCard(id: string) {
    return this.uow.prisma.line.findUnique({
      where: { id },
      include: { package: { include: { company: true, provider: true } }, pos: true },
    });
  }

  /** The last 40 tasks opened on a number, with who sent and who handled each. */
  tasksOfLine(lineId: string) {
    return this.uow.prisma.task.findMany({
      where: { lineId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: {
        submitter: { select: { loginName: true, nickname: true } },
        assignee: { select: { loginName: true, nickname: true } },
      },
    });
  }

  /** The last 40 wallet entries written for a number, with who acted. */
  entriesOfLine(lineId: string) {
    return this.uow.prisma.walletEntry.findMany({
      where: { lineId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { actor: { select: { loginName: true, nickname: true } } },
    });
  }

  /** These packages with their company. */
  packagesByIds(ids: string[]) {
    return this.uow.prisma.package.findMany({ where: { id: { in: ids } }, include: { company: true } });
  }

  /** The newest entry of these kinds on a number: its last recharge. */
  lastEntryOfKinds(lineId: string, kinds: string[]) {
    return this.uow.prisma.walletEntry.findFirst({ where: { lineId, kind: { in: kinds } }, orderBy: { createdAt: 'desc' }, select: { kind: true, createdAt: true } });
  }

  /** The add-ons of a package a number may ask for, in their saved order. */
  activeAddons(packageId: string) {
    return this.uow.prisma.packageAddon.findMany({
      where: { packageId, active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, price: true },
    });
  }

  /** The switch targets saved on a package, with what decides whether an account sees each. */
  switchTargets(packageId: string) {
    return this.uow.prisma.packageSwitch.findMany({
      where: { packageId },
      select: { target: { select: { id: true, code: true, enabled: true, forSale: true } } },
    });
  }

  /** The terms these accounts hold on these packages. */
  accountTerms(packageIds: string[], userIds: string[]) {
    return this.uow.prisma.userPackage.findMany({
      where: { packageId: { in: packageIds }, userId: { in: userIds } },
      select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
    });
  }

  // What an operation on a number reads before its transaction.

  /** The number holding this msisdn, if any. */
  lineByMsisdn(msisdn: string, db: Db = this.uow.prisma) {
    return db.line.findUnique({ where: { msisdn } });
  }

  /** The open activation task that has reserved this number, if there is one. */
  numberReservedByTask(msisdn: string, db: Db = this.uow.prisma) {
    return db.task.findFirst({ where: { action: 'activate', status: 'working', msisdn }, select: { id: true } });
  }

  /** A package by its code with company and provider, and each renewal target with its own. */
  packageWithRenewals(code: string) {
    return this.uow.prisma.package.findUnique({
      where: { code },
      include: { company: true, provider: true, renewals: { include: { target: { include: { company: true, provider: true } } } } },
    });
  }

  /** A package by its code, with its company and provider. */
  packageByCode(code: string) {
    return this.uow.prisma.package.findUnique({ where: { code }, include: { company: true, provider: true } });
  }

  /** The switches saved on a package, each with its target's code. */
  switchesOf(packageId: string) {
    return this.uow.prisma.packageSwitch.findMany({ where: { packageId }, include: { target: { select: { code: true } } } });
  }

  addon(id: string) {
    return this.uow.prisma.packageAddon.findUnique({ where: { id } });
  }

  /** The task as it stands before its completion; the claim below decides. */
  task(id: string) {
    return this.uow.prisma.task.findUnique({ where: { id } });
  }

  /** A package by its id with its company: the SIM rules a handed-back serial is checked against. */
  packageWithCompany(id: string) {
    return this.uow.prisma.package.findUnique({ where: { id }, include: { company: true } });
  }

  /** The wallet entries of these kinds on a number, newest first: the paid periods a refund reads back. */
  paidEntries(db: Db, lineId: string, kinds: string[]) {
    return db.walletEntry.findMany({
      where: { lineId, kind: { in: kinds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { kind: true, packagePrice: true, periodDays: true, periodEndsAt: true, periodCost: true },
    });
  }

  // Inside a transaction: the task being closed and the packages its handler reads.

  /** Marks an open task done by this handler (null: by the system, at settlement); the caller checks `count`. */
  claimTask(db: Db, id: string, assigneeId: string | null) {
    return db.task.updateMany({ where: { id, status: 'working' }, data: { status: 'done', assigneeId } });
  }

  // What the settlement of a provider's verdict reads and writes besides the completion's own (ADR 0019, S.8).

  /** An account as the ledger names it. */
  userById(id: string) {
    return this.uow.prisma.user.findUnique({ where: { id }, select: { id: true, loginName: true, nickname: true, layer: true, isBranchOwner: true } });
  }

  packageName(db: Db, id: string) {
    return db.package.findUnique({ where: { id }, select: { name: true } });
  }

  /** Writes the note an open task is read by: a provider failure makes it an ordinary branch task. */
  noteTask(db: Db, id: string, note: string) {
    return db.task.updateMany({ where: { id, status: 'working' }, data: { note } });
  }

  /**
   * Whether a note with these fixed words was already sent about the task, to anybody. Raw SQL so the text key
   * `payload->>'taskId'` is filtered, which the expression index `Notice_kind_taskId` serves (DB.2). The JSON
   * equalities after it are the ones Prisma's `path`/`equals` sent before, so the answer is the same: a stored
   * JSON string equal to `taskId` always has `taskId` as its text.
   */
  async taskNoteSent(db: Db, taskId: string, words: string): Promise<boolean> {
    const [row] = await db.$queryRaw<{ sent: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM "Notice"
        WHERE "kind" = 'task.note'
          AND "payload" ->> 'taskId' = ${taskId}
          AND "payload" -> 'taskId' = to_jsonb(${taskId}::text)
          AND "payload" -> 'excerpt' = to_jsonb(${words}::text)
      ) AS "sent"`;
    return row?.sent === true;
  }

  /** Writes on a claimed task what its completion handed back. */
  recordTaskResult(db: Db, id: string, data: Prisma.TaskUncheckedUpdateInput) {
    assertStoredSealed(data.esimQr);
    return db.task.update({ where: { id }, data });
  }

  /** A number with its package and company, as it stands inside the transaction. */
  lineWithCompany(db: Db, id: string) {
    return db.line.findUnique({ where: { id }, include: { package: { include: { company: true } } } });
  }

  /** A package by its id with company and provider, and each renewal target with its own. */
  packageWithRenewalsById(db: Db, id: string) {
    return db.package.findUnique({
      where: { id },
      include: { company: true, provider: true, renewals: { include: { target: { include: { company: true, provider: true } } } } },
    });
  }

  /** A package by its id, with its company and provider. */
  packageById(db: Db, id: string) {
    return db.package.findUnique({ where: { id }, include: { company: true, provider: true } });
  }

  /** A package by its id with company, provider and the codes it may switch onto. */
  packageWithSwitches(db: Db, id: string) {
    return db.package.findUnique({ where: { id }, include: { company: true, provider: true, switches: { include: { target: { select: { code: true } } } } } });
  }

  // Writes on a number. Its status is never written here (line-state.ts).

  createLine(db: Db, data: Prisma.LineUncheckedCreateInput) {
    assertStoredSealed(data.esimQr);
    return db.line.create({ data });
  }

  /** Puts a number on another package with the terms it now carries, and lifts the switch lock. */
  switchLine(db: Db, id: string, terms: Prisma.InputJsonValue, packageId: string) {
    return db.line.update({ where: { id }, data: { terms, packageId, opsLocked: false } });
  }

  /** Extends a number: its new end, the terms it now carries and, when it renews onto one, its new package. */
  extendLine(db: Db, id: string, data: { endsAt: Date; terms: Prisma.InputJsonValue; packageId?: string }) {
    return db.line.update({ where: { id }, data });
  }

  renameLine(db: Db, id: string, msisdn: string) {
    return db.line.update({ where: { id }, data: { msisdn } });
  }

  /** Puts another SIM on a number. */
  setLineSim(db: Db, id: string, sim: { iccid: string; esim: boolean; esimQr: string | null }) {
    assertStoredSealed(sim.esimQr);
    return db.line.update({ where: { id }, data: { iccid: sim.iccid, esim: sim.esim, esimQr: sim.esimQr } });
  }
}
