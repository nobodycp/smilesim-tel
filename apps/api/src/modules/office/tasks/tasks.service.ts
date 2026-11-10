import { lockLine } from '../lines/line-state';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/office-failure';
import { assertBranch, OfficeKernel } from '../kernel/office-kernel';
import { feedPosition } from '../kernel/feed';
import type { Action, Actor } from '../kernel/types';
import type { WrittenNotice } from '../notice.service';
import { excerpt, type TaskNoticePayload } from '../notice-kinds';
import { NEWEST_FIRST, TASKS_PAGE, afterFeed, mergeFeed, taskStatusOf } from '../office-paging';
import { simRulesOf } from '../office-rules';
import { canHandleTasks, taskAudience, taskReaders, taskWhereFor, type TaskEvent } from '../task-access';
import { parseTaskLogLine, stampTaskLog } from '../task-log';
import { TaskNoteBody, TaskRejectBody } from './tasks.schemas';

/**
 * Branch tasks: the inbox and one task, inspection notes, take and release, reject and cancel, plus the helpers
 * the line operations use to open a task and tell its audience. Closing a task (`completeTask`) applies a line
 * operation, so it lives in LinesService (`completeTask`).
 */
@Injectable()
export class TasksService {
  constructor(private readonly kernel: OfficeKernel) {}

  async list(actor: Actor, query: {
      cursor?: string;
      q?: string;
      status?: string;
      action?: string;
      packageCode?: string;
      company?: string;
      provider?: string;
    } = {},) {
    const handler = canHandleTasks(actor);
    const accounts = await this.kernel.accounts();
    const status = taskStatusOf(query.status);
    const action = typeof query.action === 'string' ? query.action.trim() : '';
    const packageCode = typeof query.packageCode === 'string' ? query.packageCode.trim() : '';
    const company = typeof query.company === 'string' ? query.company.trim() : '';
    const provider = typeof query.provider === 'string' ? query.provider.trim() : '';
    const digits = (typeof query.q === 'string' ? query.q : '').replace(/\s/g, '');
    const packageFilterOn = Boolean(packageCode || company || provider);
    const matchedPackages = packageFilterOn
      ? await this.kernel.prisma.package.findMany({
          where: {
            ...(packageCode ? { code: packageCode } : {}),
            ...(company ? { company: { name: company } } : {}),
            ...(provider ? { provider: { name: provider } } : {}),
          },
          select: { id: true },
        })
      : null;
    if (matchedPackages && matchedPackages.length === 0) {
      return { tasks: [], nextCursor: null, total: 0 };
    }
    const where = {
      ...taskWhereFor(actor, accounts),
      ...(status ? { status } : {}),
      ...(action ? { action } : {}),
      ...(digits ? { msisdn: { contains: digits } } : {}),
      ...(matchedPackages ? { packageId: { in: matchedPackages.map((row) => row.id) } } : {}),
    };
    const [read, total] = await Promise.all([
      this.kernel.prisma.officeTask.findMany({
        where: { ...where, AND: afterFeed(feedPosition(query.cursor)) },
        include: {
          submitter: true,
          assignee: true,
          // The list's last note skips internal notes for accounts outside the branch.
          notes: { where: actor.layer === 'branch' ? {} : { internal: false }, orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
        },
        orderBy: [...NEWEST_FIRST],
        take: TASKS_PAGE + 1,
      }),
      this.kernel.prisma.officeTask.count({ where }),
    ]);
    const { page: rows, nextCursor } = mergeFeed([read], TASKS_PAGE);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const packages = await this.kernel.prisma.package.findMany({ include: { company: true, provider: true } });
    const byPackage = new Map(packages.map((row) => [row.id, row]));
    return {
      tasks: rows.map((row) => {
        const pkg = byPackage.get(row.packageId);
        const open = row.status === 'pending' || row.status === 'working';
        return {
          id: row.id,
          action: row.action,
          status: row.status,
          posLogin: byId.get(row.posId)?.loginName ?? '',
          submitterLogin: row.submitter.loginName,
          assigneeLogin: row.assignee?.loginName ?? null,
          posDelta: row.posDelta,
          msisdn: row.msisdn,
          packageName: pkg?.name ?? '',
          companyName: pkg?.company?.name ?? '',
          providerName: pkg?.provider?.name ?? '',
          note: row.note,
          resultNote: row.status === 'pending' && !handler ? null : row.resultNote,
          lastNote: row.notes[0]?.body ?? null,
          log: handler ? row.log : '',
          createdAt: row.createdAt.toISOString(),
          canTake: handler && row.status === 'working' && !row.assigneeId,
          canWork: handler && row.status === 'working',
          canCancel: row.submitterId === actor.id && open,
        };
      }),
      nextCursor,
      total,
    };
  }

  async detail(actor: Actor, id: string) {
    const handler = canHandleTasks(actor);
    const row = await this.kernel.prisma.officeTask.findUnique({
      where: { id },
      include: {
        submitter: true,
        assignee: true,
        notes: { where: actor.layer === 'branch' ? {} : { internal: false }, include: { author: true }, orderBy: { createdAt: 'asc' } },
        line: { include: { package: { include: { company: true, provider: true } } } },
      },
    });
    if (!row) fail(404, 'NOT_FOUND');
    const accounts = await this.kernel.accounts();
    if (!taskReaders(row, accounts).has(actor.id)) fail(403, 'FORBIDDEN');
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const pkg =
      row.line?.package ??
      (await this.kernel.prisma.package.findUnique({
        where: { id: row.packageId },
        include: { company: true, provider: true },
      }));
    const events: {
      id: string;
      kind: 'system' | 'note' | 'result';
      /** An internal note: the branch only. */
      internal?: boolean;
      body: string;
      authorName: string | null;
      at: string;
    }[] = [];
    if (handler && row.log.trim()) {
      row.log
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line, index) => {
          const parsed = parseTaskLogLine(line, row.createdAt.toISOString());
          events.push({
            id: `log-${String(index).padStart(4, '0')}`,
            kind: 'system',
            body: parsed.body,
            authorName: null,
            at: parsed.at,
          });
        });
    }
    for (const note of row.notes) {
      events.push({
        id: note.id,
        kind: 'note',
        ...(note.internal ? { internal: true } : {}),
        body: note.body,
        authorName: note.author.nickname || note.author.loginName,
        at: note.createdAt.toISOString(),
      });
    }
    const resultNote = row.status === 'pending' && !handler ? null : row.resultNote;
    if (resultNote) {
      events.push({
        id: 'result',
        kind: 'result',
        body: resultNote,
        authorName: row.assignee?.nickname || row.assignee?.loginName || null,
        at: row.updatedAt.toISOString(),
      });
    }
    events.sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
    const open = row.status === 'pending' || row.status === 'working';
    return {
      task: {
        id: row.id,
        action: row.action,
        status: row.status,
        posLogin: byId.get(row.posId)?.loginName ?? '',
        submitterLogin: row.submitter.loginName,
        assigneeLogin: row.assignee?.loginName ?? null,
        posDelta: row.posDelta,
        msisdn: row.line?.msisdn ?? row.msisdn,
        iccid: row.line?.iccid ?? row.iccid,
        esim: row.line?.esim ?? row.esim,
        esimQr: row.line?.esimQr ?? row.esimQr ?? null,
        sim: simRulesOf(pkg?.company ?? null),
        lineStatus: row.line?.status ?? null,
        packageName: pkg?.name ?? '',
        companyName: pkg?.company?.name ?? '',
        providerName: pkg?.provider?.name ?? '',
        note: row.note,
        resultNote,
        log: handler ? row.log : '',
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        canTake: handler && row.status === 'working' && !row.assigneeId,
        canWork: handler && row.status === 'working',
        canNote: open,
        canNoteInternal: open && actor.layer === 'branch',
        canCancel: row.submitterId === actor.id && open,
      },
      events,
    };
  }

  async addNote(actor: Actor, id: string, body: unknown) {
    // An internal note is written and read by the branch only (spec 2026-11-09, 2).
    const { text, internal } = parseInput(TaskNoteBody, body);
    if (internal && actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const current = await this.kernel.prisma.officeTask.findUnique({ where: { id } });
    if (!current) fail(404, 'NOT_FOUND');
    if (!taskReaders(current, await this.kernel.accounts()).has(actor.id)) fail(403, 'FORBIDDEN');
    if (current.status !== 'pending' && current.status !== 'working') fail(400, 'INVALID');
    const written = await this.kernel.runTx(async (tx) => {
      await tx.officeTaskNote.create({ data: { taskId: id, authorId: actor.id, body: text, internal } });
      return this.taskNotice(tx, 'note', current, actor, { authorName: actor.nickname, excerpt: excerpt(text) }, internal);
    });
    await this.kernel.publishQuietly(written);
    return { ok: true };
  }

  async take(actor: Actor, id: string) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const current = await this.kernel.prisma.officeTask.findUnique({ where: { id } });
    // Taking is optional now (spec 2026-11-09, 2): it names who handles the open task.
    if (!current || current.status !== 'working' || current.assigneeId) fail(400, 'INVALID');
    const written = await this.kernel.runTx(async (tx) => {
      const updated = await tx.officeTask.updateMany({
        where: { id, status: 'working', assigneeId: null },
        data: { assigneeId: actor.id, log: this.noteLog(current.log, `أخذها ${actor.nickname}`) },
      });
      if (updated.count !== 1) fail(400, 'INVALID');
      return this.taskNotice(tx, 'taken', { ...current, assigneeId: actor.id }, actor, { handlerName: actor.nickname });
    });
    await this.kernel.publishQuietly(written);
    return { ok: true };
  }

  async release(actor: Actor, id: string) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const current = await this.kernel.prisma.officeTask.findUnique({ where: { id } });
    if (!current || current.status !== 'working' || current.assigneeId !== actor.id) fail(400, 'INVALID');
    const written = await this.kernel.runTx(async (tx) => {
      const updated = await tx.officeTask.updateMany({
        where: { id, status: 'working', assigneeId: actor.id },
        data: { assigneeId: null, log: this.noteLog(current.log, `أرجعها ${actor.nickname}`) },
      });
      if (updated.count !== 1) fail(400, 'INVALID');
      return this.taskNotice(tx, 'released', { ...current, assigneeId: null }, actor);
    });
    await this.kernel.publishQuietly(written);
    return { ok: true };
  }

  async reject(actor: Actor, id: string, body: unknown) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const { reason } = parseInput(TaskRejectBody, body);
    const task = await this.kernel.prisma.officeTask.findUnique({ where: { id } });
    if (!task || task.status !== 'working') fail(400, 'INVALID');
    const written = await this.kernel.runTx(async (tx) => {
      const updated = await tx.officeTask.updateMany({
        where: { id, status: 'working' },
        data: { status: 'cancelled', resultNote: reason, assigneeId: actor.id },
      });
      if (updated.count !== 1) fail(400, 'INVALID');
      await this.kernel.release(tx, task.posId, task.held ?? 0, actor.operatorId, reason);
      return this.taskNotice(tx, 'rejected', task, actor, { reason, handlerName: actor.nickname });
    });
    await this.kernel.publishQuietly(written);
    return { ok: true };
  }

  async cancel(actor: Actor, id: string) {
    const task = await this.kernel.prisma.officeTask.findUnique({ where: { id } });
    if (!task || task.submitterId !== actor.id || (task.status !== 'pending' && task.status !== 'working')) fail(400, 'INVALID');
    const written = await this.kernel.runTx(async (tx) => {
      const updated = await tx.officeTask.updateMany({
        where: { id, submitterId: actor.id, status: { in: ['pending', 'working'] } },
        data: { status: 'cancelled', resultNote: null, assigneeId: null },
      });
      if (updated.count !== 1) fail(400, 'INVALID');
      await this.kernel.release(tx, task.posId, task.held ?? 0, actor.operatorId, '');
      return this.taskNotice(tx, 'cancelled', task, actor);
    });
    await this.kernel.publishQuietly(written);
    return { ok: true };
  }

  async openTask(input: {
    action: Action;
    actor: Actor;
    posId: string;
    packageId: string;
    lineId?: string;
    nextPackageId?: string;
    posDelta: number;
    msisdn?: string | null;
    iccid?: string | null;
    esim?: boolean;
    esimQr?: string | null;
    note: string;
    /** The price of what the task sells, fixed now so completion charges and records the same number (rule 1.5). */
    unitPrice?: number;
  }) {
    const { task, written } = await this.kernel.runTx(async (tx) => {
      // One open task per number and operation (rule 2.3). The line's row serialises two requests for it.
      if (input.lineId && input.action !== 'addon') {
        await lockLine(tx, input.lineId);
        const open = await tx.officeTask.findFirst({ where: { lineId: input.lineId, action: input.action, status: 'working' }, select: { id: true } });
        if (open) fail(409, 'DUPLICATE_REQUEST');
      }
      // A task that will charge holds its price first (roadmap N6): refused before anything is written when the
      // wallet cannot cover it, released when the task closes.
      const held = input.posDelta < 0
        ? await this.kernel.hold(tx, input.posId, -input.posDelta, input.actor.operatorId, input.note, input.msisdn ? { msisdn: input.msisdn, lineId: input.lineId ?? '', companyName: '', packageName: '', packagePrice: -input.posDelta } : undefined)
        : 0;
      const created = await tx.officeTask.create({
        data: {
          action: input.action,
          // No «بانتظار الاستلام» (spec 2026-11-09, 2): a task is in progress from the moment it opens.
          status: 'working',
          posId: input.posId,
          packageId: input.packageId,
          lineId: input.lineId,
          nextPackageId: input.nextPackageId,
          submitterId: input.actor.id,
          posDelta: input.posDelta,
          msisdn: input.msisdn,
          iccid: input.iccid,
          esim: input.esim ?? false,
          esimQr: input.esimQr ?? null,
          note: input.note,
          held,
          unitPrice: input.unitPrice ?? null,
        },
      });
      const named = await tx.package.findUnique({ where: { id: input.nextPackageId ?? input.packageId }, select: { name: true } });
      const notices = await this.taskNotice(tx, 'opened', created, input.actor, {
        packageName: named?.name ?? '',
        amount: input.posDelta,
      });
      return { task: created, written: notices };
    });
    await this.kernel.publishQuietly(written);
    return task;
  }

  /** Branch users who may take a task: the owner and anyone holding the handling grant. */
  private async handlerIds(db: Prisma.TransactionClient): Promise<string[]> {
    const users = await db.user.findMany({
      where: { layer: 'branch', disabledAt: null },
      include: { role: true, extraRoles: { include: { role: true } } },
    });
    const ids: string[] = [];
    for (const user of users) {
      if (user.isBranchOwner || (await this.kernel.grantsFor(user, db)).includes('tasks')) ids.push(user.id);
    }
    return ids;
  }

  async taskNotice(
    tx: Prisma.TransactionClient,
    event: TaskEvent,
    task: { id: string; action: string; msisdn: string | null; submitterId: string; posId: string; assigneeId: string | null },
    actor: Actor,
    extra: Partial<TaskNoticePayload> = {},
    branchOnly = false,
  ): Promise<WrittenNotice[]> {
    const handlers = await this.handlerIds(tx);
    let audience = taskAudience(event, task, handlers, { id: actor.id, handler: canHandleTasks(actor) });
    if (branchOnly) {
      const branch = new Set((await this.kernel.accounts(tx)).filter((account) => account.layer === 'branch').map((account) => account.id));
      audience = audience.filter((id) => branch.has(id));
    }
    const payload: TaskNoticePayload = { taskId: task.id, action: task.action, msisdn: task.msisdn, ...extra };
    return this.kernel.notice.write(tx, audience, actor, { kind: `task.${event}`, payload });
  }

  noteLog(current: string, line: string) {
    return stampTaskLog(current, line);
  }
}
