import { TasksQuery } from './tasks.schemas';
import { TasksRepository } from './tasks.repository';
import { WalletLedger } from '../wallets/wallet-ledger';
import { ActorResolver } from '../kernel/actor-resolver';
import { AccountTree } from '../kernel/account-tree';
import { UnitOfWork } from '../kernel/unit-of-work';
import { assertBranch } from '../policy';
import { taskEvents } from './task-events';
import { esimCodeOrFail } from '../lines/esim-code';
import { sameRequest, type TaskRequest } from '../lines/activation-settlement.rules';
import { assertClaimFree, lockClaim, lockLine } from '../lines/line-state';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/office-failure';
import type { Action, Actor } from '../kernel/types';
import type { WrittenNotice } from '../notices/notice.service';
import { excerpt, type TaskNoticePayload } from '../notices/notice-kinds';
import { after, cursorPosition, page } from '../../shared/paging';
import { TASKS_PAGE, taskStatusOf } from '../rules/office-paging';
import { simRulesOf } from '../rules/sim-rules';
import { canHandleTasks, esimCodeReaders, taskAudience, taskReaders, taskWhereFor, type TaskEvent } from './task-access';
import { stampTaskLog } from './task-log';
import { TaskNoteBody, TaskRejectBody } from './tasks.schemas';

/**
 * Branch tasks: the inbox and one task, inspection notes, take and release, reject and cancel, plus the helpers
 * the line operations use to open a task and tell its audience. Closing a task (`completeTask`) applies a line
 * operation, so it lives in LinesService (`completeTask`).
 */
@Injectable()
export class TasksService {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree, private readonly actors: ActorResolver, private readonly ledger: WalletLedger, private readonly repo: TasksRepository) {}

  async list(actor: Actor, input: TasksQuery = {}) {
    const query = parseInput(TasksQuery, input);
    const handler = canHandleTasks(actor);
    const accounts = await this.tree.accounts();
    const status = taskStatusOf(query.status);
    const action = typeof query.action === 'string' ? query.action.trim() : '';
    const packageCode = typeof query.packageCode === 'string' ? query.packageCode.trim() : '';
    const company = typeof query.company === 'string' ? query.company.trim() : '';
    const provider = typeof query.provider === 'string' ? query.provider.trim() : '';
    const digits = (typeof query.q === 'string' ? query.q : '').replace(/\s/g, '');
    const matchedPackages = await this.packagesMatching({ packageCode, company, provider });
    if (matchedPackages && matchedPackages.length === 0) {
      return { items: [], nextCursor: null, total: 0 };
    }
    const where = {
      ...taskWhereFor(actor, accounts),
      ...(status ? { status } : {}),
      ...(action ? { action } : {}),
      ...(digits ? { msisdn: { contains: digits } } : {}),
      ...(matchedPackages ? { packageId: { in: matchedPackages.map((row) => row.id) } } : {}),
    };
    const [read, total] = await Promise.all([
      // The list's last note skips internal notes for accounts outside the branch.
      this.repo.tasksPage({ ...where, AND: after(cursorPosition(query.cursor)) }, actor.layer === 'branch' ? {} : { internal: false }),
      this.repo.countTasks(where),
    ]);
    const { items: rows, nextCursor } = page(read, TASKS_PAGE);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const packages = await this.repo.packagesWithCompany();
    const byPackage = new Map(packages.map((row) => [row.id, row]));
    return {
      items: rows.map((row) => {
        const pkg = byPackage.get(row.packageId);
        const open = row.status === 'pending' || row.status === 'working';
        return {
          id: row.id,
          action: row.action,
          status: row.status,
          posLoginName: byId.get(row.posId)?.loginName ?? '',
          submitterLoginName: row.submitter.loginName,
          assigneeLoginName: row.assignee?.loginName ?? null,
          posDelta: row.posDelta,
          msisdn: row.msisdn,
          packageName: pkg?.name ?? '',
          companyName: pkg?.company?.name ?? '',
          // The provider is the branch's business (rule 3.4): a lower layer sees the package and its company.
          providerName: actor.layer === 'branch' ? pkg?.provider?.name ?? '' : '',
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

  /** The packages a list filter names, or null when it names none. */
  private async packagesMatching(filter: { packageCode: string; company: string; provider: string }) {
    if (!filter.packageCode && !filter.company && !filter.provider) return null;
    return this.repo.packageIdsMatching({
      ...(filter.packageCode ? { code: filter.packageCode } : {}),
      ...(filter.company ? { company: { name: filter.company } } : {}),
      ...(filter.provider ? { provider: { name: filter.provider } } : {}),
    });
  }

  /**
   * The SIM a task's detail shows: its serial, whether it is an eSIM, and its code.
   *
   * An open task that replaces the line's SIM shows the new one, never the one it replaces. A SIM change (`sim`)
   * carries the new serial, kind and code; a new eSIM (`esim`) has no code until it is completed, so none is
   * shown. The line's old code is not read at all, so one that no longer opens does not close the screen of the
   * task that repairs it.
   *
   * Every other task, and a replacing task once it is closed, shows the line's SIM once there is a line (a code
   * the task carried and did not put on the line is not shown); until then the one the task carries. A code that cannot be opened refuses the request, it is never answered as
   * «no code» (lines/esim-code.ts); that holds for the new code of an open task too.
   */
  private shownSim(row: { id: string; action: string; iccid: string | null; esim: boolean; esimQr: string | null; line: { id: string; iccid: string | null; esim: boolean; esimQr: string | null } | null }, open: boolean, entitled: boolean) {
    // The code goes to the point of sale, its path and the branch (D17). Any other reader of the task gets the
    // serial and the kind, and no code: it is not opened for them, so a code that does not open refuses nothing.
    const code = (stored: string | null, where: string) => (entitled ? esimCodeOrFail(stored, where) : null);
    const own = () => code(row.esimQr, `task ${row.id}`);
    if (open && row.line && row.action === 'sim') return { iccid: row.iccid, esim: row.esim, esimQr: own() };
    if (open && row.line && row.action === 'esim') return { iccid: row.line.iccid, esim: row.line.esim, esimQr: own() };
    // With a line, all three come from the line: a closed task's unused code is not shown beside the line's SIM.
    if (row.line) return { iccid: row.line.iccid, esim: row.line.esim, esimQr: code(row.line.esimQr, `line ${row.line.id}`) };
    return { iccid: row.iccid, esim: row.esim, esimQr: own() };
  }

  async detail(actor: Actor, id: string) {
    const handler = canHandleTasks(actor);
    const row = await this.repo.taskDetail(id, actor.layer === 'branch' ? {} : { internal: false });
    if (!row) fail(404, 'NOT_FOUND');
    const accounts = await this.tree.accounts();
    if (!taskReaders(row, accounts).has(actor.id)) fail(404, 'NOT_FOUND');
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const pkg =
      row.line?.package ??
      (await this.repo.packageOfTask(row.packageId));
    const resultNote = row.status === 'pending' && !handler ? null : row.resultNote;
    const events = taskEvents(row, handler ? row.log : '', resultNote);
    const open = row.status === 'pending' || row.status === 'working';
    return {
      task: {
        id: row.id,
        action: row.action,
        status: row.status,
        posLoginName: byId.get(row.posId)?.loginName ?? '',
        submitterLoginName: row.submitter.loginName,
        assigneeLoginName: row.assignee?.loginName ?? null,
        posDelta: row.posDelta,
        msisdn: row.line?.msisdn ?? row.msisdn,
        ...this.shownSim(row, open, esimCodeReaders(row.posId, accounts).has(actor.id)),
        sim: simRulesOf(pkg?.company ?? null),
        lineStatus: row.line?.status ?? null,
        packageName: pkg?.name ?? '',
        companyName: pkg?.company?.name ?? '',
        providerName: actor.layer === 'branch' ? pkg?.provider?.name ?? '' : '',
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
    const current = await this.repo.task(id);
    if (!current) fail(404, 'NOT_FOUND');
    if (!taskReaders(current, await this.tree.accounts()).has(actor.id)) fail(404, 'NOT_FOUND');
    if (current.status !== 'pending' && current.status !== 'working') fail(400, 'INVALID');
    const written = await this.uow.runTx(async (tx) => {
      await this.repo.addNote(tx, { taskId: id, authorId: actor.id, body: text, internal });
      return this.taskNotice(tx, 'note', current, actor, { authorName: actor.nickname, excerpt: excerpt(text) }, internal);
    });
    await this.uow.publishQuietly(written);
    return { ok: true };
  }

  async take(actor: Actor, id: string) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const current = await this.repo.task(id);
    // Taking is optional now (spec 2026-11-09, 2): it names who handles the open task.
    if (!current || current.status !== 'working' || current.assigneeId) fail(400, 'INVALID');
    const written = await this.uow.runTx(async (tx) => {
      const updated = await this.repo.takeTask(tx, id, actor.id, this.noteLog(current.log, `أخذها ${actor.nickname}`));
      if (updated.count !== 1) fail(400, 'INVALID');
      return this.taskNotice(tx, 'taken', { ...current, assigneeId: actor.id }, actor, { handlerName: actor.nickname });
    });
    await this.uow.publishQuietly(written);
    return { ok: true };
  }

  async release(actor: Actor, id: string) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const current = await this.repo.task(id);
    if (!current || current.status !== 'working' || current.assigneeId !== actor.id) fail(400, 'INVALID');
    const written = await this.uow.runTx(async (tx) => {
      const updated = await this.repo.releaseTask(tx, id, actor.id, this.noteLog(current.log, `أرجعها ${actor.nickname}`));
      if (updated.count !== 1) fail(400, 'INVALID');
      return this.taskNotice(tx, 'released', { ...current, assigneeId: null }, actor);
    });
    await this.uow.publishQuietly(written);
    return { ok: true };
  }

  async reject(actor: Actor, id: string, body: unknown) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const { reason } = parseInput(TaskRejectBody, body);
    const task = await this.repo.task(id);
    if (!task || task.status !== 'working') fail(400, 'INVALID');
    const written = await this.uow.runTx(async (tx) => {
      const updated = await this.repo.rejectTask(tx, id, reason, actor.id);
      if (updated.count !== 1) fail(400, 'INVALID');
      await this.ledger.release(tx, task.posId, task.held ?? 0, actor.operatorId, reason);
      return this.taskNotice(tx, 'rejected', task, actor, { reason, handlerName: actor.nickname });
    });
    await this.uow.publishQuietly(written);
    return { ok: true };
  }

  async cancel(actor: Actor, id: string) {
    const task = await this.repo.task(id);
    if (!task || task.submitterId !== actor.id || (task.status !== 'pending' && task.status !== 'working')) fail(400, 'INVALID');
    const written = await this.uow.runTx(async (tx) => {
      const updated = await this.repo.cancelTask(tx, id, actor.id);
      if (updated.count !== 1) fail(400, 'INVALID');
      await this.ledger.release(tx, task.posId, task.held ?? 0, actor.operatorId, '');
      return this.taskNotice(tx, 'cancelled', task, actor);
    });
    await this.uow.publishQuietly(written);
    return { ok: true };
  }

  /** The task a request key opened, for the request it was first sent with; 400 when the key came with another. */
  async openedBy(request: TaskRequest): Promise<{ id: string } | null> {
    const first = await this.repo.taskByRequestKey(this.uow.prisma, request.key);
    if (first && !sameRequest(first, request)) fail(400, 'INVALID');
    return first ? { id: first.id } : null;
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
    /** The request's stored key and fingerprint (ADR 0019, D14): one task per key, for as long as the row exists. */
    request?: TaskRequest;
  }): Promise<{ id: string; replayed: boolean }> {
    const { request } = input;
    const { task, written } = await this.uow.runTx(async (tx) => {
      /** The task this request's key already opened: answered again, or refused when the key came with another request. */
      const firstAnswer = async () => {
        const first = request ? await this.repo.taskByRequestKey(tx, request.key) : null;
        if (first && request && !sameRequest(first, request)) fail(400, 'INVALID');
        return first ? { task: { id: first.id, replayed: true }, written: [] as WrittenNotice[] } : null;
      };
      // One open task per number and operation (rule 2.3). The line's row serialises two requests for it.
      if (input.lineId && input.action !== 'addon') {
        await lockLine(tx, input.lineId);
        const open = await this.repo.openTaskOn(tx, input.lineId, input.action);
        if (open) fail(409, 'DUPLICATE_REQUEST');
      }
      // An activation reserves its serial and its number (ADR 0019, D5): refused here, under their locks, when a
      // line holds one of them or another open activation has reserved it. Before the task and before any money.
      const claim = input.action === 'activate' ? { iccid: input.iccid, msisdn: input.msisdn } : {};
      // A repeated request is answered before the reservation is judged, or it would be refused by its own first
      // task. The keys are locked first: a repeat sent at the same moment waits here for the first to commit.
      await lockClaim(tx, claim);
      const before = await firstAnswer();
      if (before) return before;
      await assertClaimFree(tx, claim);
      // The task is written first, the hold second: a request the database refuses has held nothing.
      const price = input.posDelta < 0 ? -input.posDelta : 0;
      const created = await this.repo.insertTask(tx, {
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
        held: price,
        unitPrice: input.unitPrice ?? null,
        requestKey: request?.key ?? null,
        requestHash: request?.hash ?? null,
      });
      if (!created) {
        // The request key refused it: the same request, sent at the same moment with no serial or number to wait
        // on, committed first. Nothing was held and nothing is recorded for this one.
        const raced = await firstAnswer();
        if (raced) return raced;
        // The reservation indexes refused it although the check above passed: someone wrote past the locks. The
        // check says which of the two it was; if it finds neither, the request is still a duplicate.
        await assertClaimFree(tx, claim);
        fail(409, 'DUPLICATE_REQUEST');
      }
      // A task that will charge holds its price (roadmap N6): refused, and the task with it, when the wallet
      // cannot cover it; released when the task closes.
      if (price > 0) {
        await this.ledger.hold(tx, input.posId, price, input.actor.operatorId, input.note, input.msisdn ? { msisdn: input.msisdn, lineId: input.lineId ?? '', companyName: '', packageName: '', packagePrice: price } : undefined);
      }
      const named = await this.repo.packageName(tx, input.nextPackageId ?? input.packageId);
      const notices = await this.taskNotice(tx, 'opened', created, input.actor, {
        packageName: named?.name ?? '',
        amount: input.posDelta,
      });
      return { task: { id: created.id, replayed: false }, written: notices };
    });
    await this.uow.publishQuietly(written);
    return task;
  }

  /** Branch users who may take a task: the owner and anyone holding the handling grant. */
  private async handlerIds(db: Prisma.TransactionClient): Promise<string[]> {
    const users = await this.repo.branchUsers(db);
    const ids: string[] = [];
    for (const user of users) {
      if (user.isBranchOwner || (await this.actors.grantsFor(user, db)).includes('tasks')) ids.push(user.id);
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
      const branch = new Set((await this.tree.accounts(tx)).filter((account) => account.layer === 'branch').map((account) => account.id));
      audience = audience.filter((id) => branch.has(id));
    }
    const payload: TaskNoticePayload = { taskId: task.id, action: task.action, msisdn: task.msisdn, ...extra };
    return this.uow.notice.write(tx, audience, actor, { kind: `task.${event}`, payload });
  }

  noteLog(current: string, line: string) {
    return stampTaskLog(current, line);
  }
}
