import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork, type Db } from '../kernel/unit-of-work';
import { NEWEST_FIRST } from '../../shared/paging';
import { TASKS_PAGE } from '../rules/office-paging';

/**
 * The database as this domain reads and writes it: tasks and their notes. One method per query, named for what it
 * returns or changes; a method that may run inside a transaction takes the client (`db`). No rule and no
 * permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class TasksRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** One page of the inbox (and one row more), each task with its people and the last note `notes` lets through. */
  tasksPage(where: Prisma.OfficeTaskWhereInput, notes: Prisma.OfficeTaskNoteWhereInput) {
    return this.uow.prisma.officeTask.findMany({
      where,
      include: {
        submitter: true,
        assignee: true,
        notes: { where: notes, orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
      },
      orderBy: [...NEWEST_FIRST],
      take: TASKS_PAGE + 1,
    });
  }

  countTasks(where: Prisma.OfficeTaskWhereInput) {
    return this.uow.prisma.officeTask.count({ where });
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
  taskDetail(id: string, notes: Prisma.OfficeTaskNoteWhereInput) {
    return this.uow.prisma.officeTask.findUnique({
      where: { id },
      include: {
        submitter: true,
        assignee: true,
        notes: { where: notes, include: { author: true }, orderBy: { createdAt: 'asc' } },
        line: { include: { package: { include: { company: true, provider: true } } } },
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
    return this.uow.prisma.officeTask.findUnique({ where: { id } });
  }

  addNote(db: Db, data: Prisma.OfficeTaskNoteUncheckedCreateInput) {
    return db.officeTaskNote.create({ data });
  }

  /** Names the handler of an open task nobody took; the caller checks `count`. */
  takeTask(db: Db, id: string, assigneeId: string, log: string) {
    return db.officeTask.updateMany({
      where: { id, status: 'working', assigneeId: null },
      data: { assigneeId, log },
    });
  }

  /** Gives an open task back, only by the one who took it; the caller checks `count`. */
  releaseTask(db: Db, id: string, assigneeId: string, log: string) {
    return db.officeTask.updateMany({
      where: { id, status: 'working', assigneeId },
      data: { assigneeId: null, log },
    });
  }

  /** Closes an open task as refused, with the reason; the caller checks `count`. */
  rejectTask(db: Db, id: string, reason: string, assigneeId: string) {
    return db.officeTask.updateMany({
      where: { id, status: 'working' },
      data: { status: 'cancelled', resultNote: reason, assigneeId },
    });
  }

  /** Closes a task its own submitter withdraws while it is open; the caller checks `count`. */
  cancelTask(db: Db, id: string, submitterId: string) {
    return db.officeTask.updateMany({
      where: { id, submitterId, status: { in: ['pending', 'working'] } },
      data: { status: 'cancelled', resultNote: null, assigneeId: null },
    });
  }

  /** The open task for this number and operation, if there is one (rule 2.3). */
  openTaskOn(db: Db, lineId: string, action: string) {
    return db.officeTask.findFirst({ where: { lineId, action, status: 'working' }, select: { id: true } });
  }

  /**
   * Inserts a task unless a unique index refuses it (`ON CONFLICT DO NOTHING`, so the caller's transaction is not
   * aborted): for an activation, the open-reservation indexes on its serial and its number. Answers the new row,
   * or null when the database refused it.
   */
  async insertTask(db: Db, data: Omit<Prisma.OfficeTaskCreateManyInput, 'id'>) {
    const id = randomUUID();
    const made = await db.officeTask.createMany({ data: [{ id, ...data }], skipDuplicates: true });
    return made.count === 1 ? db.officeTask.findUnique({ where: { id } }) : null;
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
}
