import { assertStoredSealed, UnitOfWork, type Db, NEWEST_FIRST, TASKS_PAGE } from '../platform';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

/**
 * The database as this domain reads and writes it: tasks and their notes. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
/** What a task's screens read of its provider operation (ADR 0019, O6): its state, never what it handed back. */
const OPERATION_STATE = { status: true, appliedAt: true, applyError: true } as const;

@Injectable()
export class TasksRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** One page of the inbox (and one row more), each task with its people and the last note `notes` lets through. */
  tasksPage(where: Prisma.TaskWhereInput, notes: Prisma.TaskNoteWhereInput) {
    return this.uow.prisma.task.findMany({
      where,
      include: {
        submitter: true,
        assignee: true,
        notes: { where: notes, orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
        providerOperation: { select: OPERATION_STATE },
      },
      orderBy: [...NEWEST_FIRST],
      take: TASKS_PAGE + 1,
    });
  }

  countTasks(where: Prisma.TaskWhereInput) {
    return this.uow.prisma.task.count({ where });
  }

  /** How many tasks under `where` hold each status: one grouped count, a row per status that has any. */
  async countByStatus(where: Prisma.TaskWhereInput): Promise<{ status: string; count: number }[]> {
    const groups = await this.uow.prisma.task.groupBy({ by: ['status'], where, _count: { _all: true } });
    return groups.map((group) => ({ status: group.status, count: group._count._all }));
  }

  /** Every package with its company and its provider. */
  packagesWithCompany() {
    return this.uow.prisma.package.findMany({ include: { company: true, provider: true } });
  }

  /** The ids of the packages a list filter names. */
  packageIdsMatching(where: Prisma.PackageWhereInput) {
    return this.uow.prisma.package.findMany({ where, select: { id: true } });
  }

  /** One task as its page shows it: its people, the notes `notes` lets through, and its number with the package. */
  taskDetail(id: string, notes: Prisma.TaskNoteWhereInput) {
    return this.uow.prisma.task.findUnique({
      where: { id },
      include: {
        submitter: true,
        assignee: true,
        notes: { where: notes, include: { author: true }, orderBy: { createdAt: 'asc' } },
        line: { include: { package: { include: { company: true, provider: true } } } },
        providerOperation: { select: OPERATION_STATE },
      },
    });
  }

  /** The package of a task that has no number yet. */
  packageOfTask(packageId: string) {
    return this.uow.prisma.package.findUnique({
      where: { id: packageId },
      include: { company: true, provider: true },
    });
  }

  /** The task as it stands before a transaction; the guarded writes below decide. */
  task(id: string) {
    return this.uow.prisma.task.findUnique({ where: { id } });
  }

  addNote(db: Db, data: Prisma.TaskNoteUncheckedCreateInput) {
    return db.taskNote.create({ data });
  }

  /** Names the handler of an open task nobody took; the caller checks `count`. */
  takeTask(db: Db, id: string, assigneeId: string, log: string) {
    return db.task.updateMany({
      where: { id, status: 'working', assigneeId: null },
      data: { assigneeId, log },
    });
  }

  /** Gives an open task back, only by the one who took it; the caller checks `count`. */
  releaseTask(db: Db, id: string, assigneeId: string, log: string) {
    return db.task.updateMany({
      where: { id, status: 'working', assigneeId },
      data: { assigneeId: null, log },
    });
  }

  /** Closes an open task as refused, with the reason; the caller checks `count`. */
  rejectTask(db: Db, id: string, reason: string, assigneeId: string) {
    return db.task.updateMany({
      where: { id, status: 'working' },
      data: { status: 'cancelled', resultNote: reason, assigneeId },
    });
  }

  /** Closes a task its own submitter withdraws while it is open; the caller checks `count`. */
  cancelTask(db: Db, id: string, submitterId: string) {
    return db.task.updateMany({
      where: { id, submitterId, status: { in: ['pending', 'working'] } },
      data: { status: 'cancelled', resultNote: null, assigneeId: null },
    });
  }

  /** The open task for this number and operation, if there is one (rule 2.3). */
  openTaskOn(db: Db, lineId: string, action: string) {
    return db.task.findFirst({ where: { lineId, action, status: 'working' }, select: { id: true } });
  }

  /**
   * Inserts a task unless a unique index refuses it (`ON CONFLICT DO NOTHING`, so the caller's transaction is not
   * aborted): for an activation, the open-reservation indexes on its serial and its number, and the unique
   * request key (D14). An insert that meets a row another transaction has not committed yet waits for it, so the
   * answer is final. Answers the new row, or null when the database refused it.
   */
  async insertTask(db: Db, data: Omit<Prisma.TaskCreateManyInput, 'id'>) {
    assertStoredSealed(data.esimQr);
    const id = randomUUID();
    const made = await db.task.createMany({ data: [{ id, ...data }], skipDuplicates: true });
    return made.count === 1 ? db.task.findUnique({ where: { id } }) : null;
  }

  /** The task a request key opened (ADR 0019, D14), if there is one: its id and the fingerprint it was sent with. */
  taskByRequestKey(db: Db, requestKey: string) {
    return db.task.findUnique({ where: { requestKey }, select: { id: true, requestHash: true } });
  }

  packageName(db: Db, id: string) {
    return db.package.findUnique({ where: { id }, select: { name: true } });
  }

  /** The branch's enabled users with their roles: who may be told about a task. */
  branchUsers(db: Db) {
    return db.user.findMany({
      where: { layer: 'branch', disabledAt: null },
      include: { role: true, extraRoles: { include: { role: true } } },
    });
  }

  // A frozen account's tasks (slice R.8: from `AccountsRepository`, unchanged).
  /** The tasks this account is working on now. */
  openTasksHandledBy(assigneeId: string) {
    return this.uow.prisma.task.findMany({ where: { assigneeId, status: 'working' }, select: { id: true, log: true } });
  }
}
