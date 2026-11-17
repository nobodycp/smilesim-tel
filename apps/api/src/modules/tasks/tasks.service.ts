import { TasksQuery, TaskNoteBody, TaskRejectBody } from './tasks.schemas';
import { TasksRepository } from './tasks.repository';
import { WalletLedger } from '../wallets';
import { ActorResolver, AccountTree, assertBranch } from '../access';
import { UnitOfWork, esimCodeOrFail, parseInput, fail, after, cursorPosition, page, searchTerms, TASKS_PAGE, HANDLER_FROZEN_NOTE } from '../platform';
import { taskEvents } from './task-events';
import { holdOf, mayDecide, sameRequest, shownPhase, taskActions, type TaskOperation, type TaskRequest } from './task-operation.rules';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { Actor } from '../access';
import type { Action } from '../catalog';
import type { WrittenNotice } from '../notifications';
import { excerpt, type TaskNoticePayload } from '../notifications';
import { taskCountsOf, taskStatusOf, type TaskCounts } from './task-status';
import { simRulesOf } from '../catalog';
import { canHandleTasks, esimCodeReaders, taskAudience, taskReaders, taskWhereFor, type TaskEvent } from './task-access';
import { stampTaskLog } from './task-log';
import { assertOperationAllows, withdrawOperation } from './task-operation';
import { ProviderOperationsService } from '../providers';

/**
 * What opening a task locks and checks on what it names, provided by sales (slice R.4: tasks knows no line, no
 * serial and no number). `openTask` calls them at the same points as before, in the one lock order: the line's
 * row, then the claim keys, then the reservation's check, all before the task's row and any wallet.
 */
export type OpeningLocks = {
  lockLine: (tx: Prisma.TransactionClient, lineId: string) => Promise<void>;
  lockClaim: (tx: Prisma.TransactionClient, claim: { iccid?: string | null; msisdn?: string | null }) => Promise<void>;
  assertClaimFree: (tx: Prisma.TransactionClient, claim: { iccid?: string | null; msisdn?: string | null }) => Promise<void>;
};

/**
 * Branch tasks: the inbox and one task, inspection notes, take and release, reject and cancel, plus the helpers
 * the line operations use to open a task and tell its audience. Closing a task (`completeTask`) applies a line
 * operation, so it lives in LinesService (`completeTask`).
 */
@Injectable()
export class TasksService {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree, private readonly actors: ActorResolver, private readonly ledger: WalletLedger, private readonly repo: TasksRepository, private readonly operations: ProviderOperationsService) {}

  async list(actor: Actor, input: TasksQuery = {}) {
    const query = parseInput(TasksQuery, input);
    const handler = canHandleTasks(actor);
    const accounts = await this.tree.accounts();
    const status = taskStatusOf(query.status);
    const action = typeof query.action === 'string' ? query.action.trim() : '';
    const packageCode = typeof query.packageCode === 'string' ? query.packageCode.trim() : '';
    const company = typeof query.company === 'string' ? query.company.trim() : '';
    const provider = typeof query.provider === 'string' ? query.provider.trim() : '';
    // A part of the number as typed (search, plan DB.6): Arabic-Indic digits as ASCII, no spaces, dashes or leading `+`.
    const digits = searchTerms(typeof query.q === 'string' ? query.q : '')?.number ?? '';
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
    const packages = await this.repo.packageNames();
    const byPackage = new Map(packages.map((row) => [row.id, row]));
    return {
      items: rows.map((row) => {
        const pkg = byPackage.get(row.packageId);
        const open = row.status === 'pending' || row.status === 'working';
        const operation = row.providerOperation as TaskOperation;
        // What the task's provider operation allows by hand (ADR 0019, D6): the routes refuse the rest.
        const allowed = taskActions(operation);
        return {
          id: row.id,
          action: row.action,
          // `port` or `convert` for an activation that is one; null otherwise.
          activationKind: row.activationKind,
          status: row.status,
          operationPhase: shownPhase(operation),
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
          canTake: handler && row.status === 'working' && !row.assigneeId && allowed.complete,
          canWork: handler && row.status === 'working' && allowed.complete,
          canCancel: row.submitterId === actor.id && open && allowed.cancel !== 'refused',
        };
      }),
      nextCursor,
      total,
    };
  }

  /**
   * The tasks screen's status tabs: how many tasks the actor may read hold each status, over the whole list with no
   * filter. The same visibility as `list` (`taskWhereFor`), so each number is that status's list total.
   */
  async counts(actor: Actor): Promise<TaskCounts> {
    const accounts = await this.tree.accounts();
    return taskCountsOf(await this.repo.countByStatus(taskWhereFor(actor, accounts)));
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
   * «no code» (platform/esim-code.ts); that holds for the new code of an open task too.
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
    const operation = row.providerOperation as TaskOperation;
    const allowed = taskActions(operation);
    const phase = shownPhase(operation);
    return {
      task: {
        id: row.id,
        action: row.action,
        activationKind: row.activationKind,
        status: row.status,
        // The task's provider operation as a screen shows it (ADR 0019, O6); null for a task that never went to
        // a provider. Why an exception could not be applied is the branch's business, as the provider is.
        operation: phase
          ? { phase, reason: actor.layer === 'branch' ? operation?.applyError ?? null : null, decisions: mayDecide(actor) && !actor.impersonating }
          : null,
        hold: holdOf(row),
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
        canTake: handler && row.status === 'working' && !row.assigneeId && allowed.complete,
        canWork: handler && row.status === 'working' && allowed.complete,
        canNote: open,
        canNoteInternal: open && actor.layer === 'branch',
        canCancel: row.submitterId === actor.id && open && allowed.cancel !== 'refused',
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
      // The task's provider operation, locked after the task and before the wallet: a reject goes on only with
      // none or a failed one (ADR 0019, D6). Refused, the transaction rolls back: the task and its hold stay.
      await assertOperationAllows(tx, id, 'reject');
      await this.ledger.release(tx, task.posId, task.held ?? 0, actor.operatorId, reason);
      return this.taskNotice(tx, 'rejected', task, actor, { reason, handlerName: actor.nickname });
    });
    await this.uow.publishQuietly(written);
    return { ok: true };
  }

  /**
   * Rejects a task by an approved decision on its provider operation (ADR 0019, D15, T11): the caller holds the
   * task's row and the operation's, and the rules allowed it. The task is closed and its hold given back, once.
   */
  async rejectByDecision(tx: Prisma.TransactionClient, task: { id: string; action: string; msisdn: string | null; submitterId: string; posId: string; assigneeId: string | null; held: number | null }, actor: Actor, reason: string): Promise<WrittenNotice[]> {
    const updated = await this.repo.rejectTask(tx, task.id, reason, actor.id);
    if (updated.count !== 1) fail(409, 'DUPLICATE_REQUEST');
    await this.ledger.release(tx, task.posId, task.held ?? 0, actor.operatorId, reason);
    return this.taskNotice(tx, 'rejected', task, actor, { reason, handlerName: actor.nickname });
  }

  async cancel(actor: Actor, id: string) {
    const task = await this.repo.task(id);
    if (!task || task.submitterId !== actor.id || (task.status !== 'pending' && task.status !== 'working')) fail(400, 'INVALID');
    const written = await this.uow.runTx(async (tx) => {
      const updated = await this.repo.cancelTask(tx, id, actor.id);
      if (updated.count !== 1) fail(400, 'INVALID');
      // T9 (ADR 0019, D7): an operation nothing has left for is closed as abandoned in this same transaction; one
      // the dispatcher has, or whose answer is not known or not applied yet, refuses the cancel and nothing changes.
      await withdrawOperation(tx, id, this.operations);
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
    /** For an activation that is a porting or a card-to-bill conversion (spec 2026-11-16-package-page, P.5). */
    activationKind?: 'port' | 'convert';
    note: string;
    /** The price of what the task sells, fixed now so completion charges and records the same number (rule 1.5). */
    unitPrice?: number;
    /** The request's stored key and fingerprint (ADR 0019, D14): one task per key, for as long as the row exists. */
    request?: TaskRequest;
    /**
     * What else belongs to this opening and must commit or roll back with it (ADR 0019, T1): run inside the
     * transaction once the task's row exists, before the hold and the notices. Never run for a repeated request.
     */
    alongside?: (tx: Prisma.TransactionClient, task: { id: string }) => Promise<void>;
    /**
     * `false` for a task the branch has nothing to do with yet (an activation that went to a provider, ADR 0019):
     * `task.opened` tells the branch's handlers there is a task to take, which would be untrue. They are told when
     * it becomes theirs (the settlement's T6), and the accounts that decide when it needs a decision (T7, T5′).
     */
    announce?: boolean;
    /** The locks on what the task names and the reservation's check: sales provides them (`OpeningLocks`). */
    locks: OpeningLocks;
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
        await input.locks.lockLine(tx, input.lineId);
        const open = await this.repo.openTaskOn(tx, input.lineId, input.action);
        if (open) fail(409, 'DUPLICATE_REQUEST');
      }
      // An activation reserves its serial and its number (ADR 0019, D5): refused here, under their locks, when a
      // line holds one of them or another open activation has reserved it. Before the task and before any money.
      const claim = input.action === 'activate' ? { iccid: input.iccid, msisdn: input.msisdn } : {};
      // A repeated request is answered before the reservation is judged, or it would be refused by its own first
      // task. The keys are locked first: a repeat sent at the same moment waits here for the first to commit.
      await input.locks.lockClaim(tx, claim);
      const before = await firstAnswer();
      if (before) return before;
      await input.locks.assertClaimFree(tx, claim);
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
        activationKind: input.activationKind ?? null,
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
        await input.locks.assertClaimFree(tx, claim);
        fail(409, 'DUPLICATE_REQUEST');
      }
      // What the opening records beside the task (an activation's provider operation and its outbox message):
      // after the task, which it names, and before the wallet (the one lock order).
      await input.alongside?.(tx, created);
      // A task that will charge holds its price (roadmap N6): refused, and the task with it, when the wallet
      // cannot cover it; released when the task closes.
      if (price > 0) {
        await this.ledger.hold(tx, input.posId, price, input.actor.operatorId, input.note, input.msisdn ? { msisdn: input.msisdn, lineId: input.lineId ?? '', companyName: '', packageName: '', packagePrice: price } : undefined);
      }
      if (input.announce === false) return { task: { id: created.id, replayed: false }, written: [] as WrittenNotice[] };
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
  private handlerIds(db: Prisma.TransactionClient): Promise<string[]> {
    return this.branchAccountsWith(db, 'tasks');
  }

  /** The enabled branch accounts that hold a grant: the owner, and anyone whose roles and own grants give it. */
  async branchAccountsWith(db: Prisma.TransactionClient, grant: string): Promise<string[]> {
    const users = await this.repo.branchUsers(db);
    const ids: string[] = [];
    for (const user of users) {
      if (user.isBranchOwner || (await this.actors.grantsFor(user, db)).includes(grant)) ids.push(user.id);
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
    /** Only for a notice written in the actor's name by the system (ADR 0019, D12): the actor is told too. */
    tellActor = false,
  ): Promise<WrittenNotice[]> {
    const handlers = await this.handlerIds(tx);
    let audience = taskAudience(event, task, handlers, { id: actor.id, handler: canHandleTasks(actor) });
    if (branchOnly) {
      const branch = new Set((await this.tree.accounts(tx)).filter((account) => account.layer === 'branch').map((account) => account.id));
      audience = audience.filter((id) => branch.has(id));
    }
    const payload: TaskNoticePayload = { taskId: task.id, action: task.action, msisdn: task.msisdn, ...extra };
    return this.uow.notice.write(tx, audience, actor, { kind: `task.${event}`, payload }, tellActor ? { tellActor: true } : {});
  }

  noteLog(current: string, line: string) {
    return stampTaskLog(current, line);
  }

  /**
   * Hands back to the pool every task this account is working on, its account having been frozen: still open,
   * nobody's (rule 2.4). One guarded write a task, so a task finished at this moment is left as it is. Slice R.8:
   * from `AccountsService.setFrozen`, unchanged; access reaches it through the `AccountTasks` port.
   */
  async releaseHandledBy(userId: string): Promise<void> {
    const handled = await this.repo.openTasksHandledBy(userId);
    for (const task of handled) {
      // The same guarded statement the accounts' repository ran (its copy is gone), on the root client as before.
      await this.repo.releaseTask(this.uow.prisma, task.id, userId, stampTaskLog(task.log, HANDLER_FROZEN_NOTE));
    }
  }
}
