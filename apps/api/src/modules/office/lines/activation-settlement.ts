import type { OfficeTask, Prisma, ProviderOperation } from '../../../generated/prisma/client';
import { errorCode, logger } from '../../shared/log';
import { OfficeFailure } from '../../shared/office-failure';
import { open } from '../../shared/secret-box';
import type { UnitOfWork } from '../kernel/unit-of-work';
import type { Actor } from '../kernel/types';
import type { WrittenNotice } from '../notices/notice.service';
import type { TaskNoticePayload } from '../notices/notice-kinds';
import type { OperationStatus } from '../providers/operations/provider-operation.rules';
import type { ProviderOperationsService } from '../providers/operations/provider-operations.service';
import { PROVIDER_EXCEPTION_NOTES, PROVIDER_FAILED_NOTE, PROVIDER_UNKNOWN_NOTE, SYSTEM_SENDER_NAME } from '../stored-text';
import { lockedTask, lockedTaskOperation } from '../tasks/task-operation';
import type { TasksService } from '../tasks/tasks.service';
import { DECISION_GRANT, applyErrorOf, settlementOf, type ApplyError } from './activation-settlement.rules';
import { storableEsimCode } from './esim-code';
import { lockClaim } from './line-state';
import type { LinesRepository } from './lines.repository';
import { renderActivationCode } from './office-esim';
import { settlementClaim } from './reservation.rules';
import type { TaskCompletion } from './task-completion';

const log = logger('ActivationSettlement');

/**
 * What acting on an operation's verdict came to:
 * - `applied`: the line exists, the hold was captured, the task is done (T5).
 * - `exception`: the provider confirmed and the line could not be created; recorded, nothing else changed (T5′).
 * - `handed-to-branch`: the provider did not run it; the task is the branch's (T6).
 * - `awaiting-decision`: the answer is not known; the accounts that may decide were told (T7).
 * - `skipped`: there was nothing to do, or somebody else had done it.
 */
export type Settled = 'applied' | 'exception' | 'handed-to-branch' | 'awaiting-decision' | 'skipped';

/** Raised inside T5 when the task or the operation is no longer what the settlement read: roll back, do nothing. */
class NothingToApply extends Error {}

type TaskRow = OfficeTask;
type OperationRow = ProviderOperation;

/**
 * Acts on what a provider operation came to (ADR 0019, D8 to D12 and D16): the verdict is already stored (T4,
 * `ProviderOperationsService.settle`), and each method here is its own transaction, started by the
 * `provider-operation.settled` message or by the sweeper. It never calls a provider and never sends anything.
 *
 * A message may come twice, from several workers at once, or after a person or another worker acted: every
 * write here is guarded, and the second caller finds nothing to do.
 *
 * Who is named (D12): the entry and every notice written here name the task's submitter as the actor and
 * «النظام» as the handler. The submitter did not do it, so a notice in the submitter's name reaches the submitter
 * too when the submitter is in its audience (`tellActor`): a point of sale is told that its own activation is done.
 */
export class ActivationSettlement {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly completion: TaskCompletion,
    private readonly tasks: TasksService,
    private readonly lines: LinesRepository,
    private readonly operations: ProviderOperationsService,
  ) {}

  /** Acts on one operation's verdict, whatever it is. Safe to call any number of times. */
  async apply(operationId: string): Promise<Settled> {
    const operation = await this.operations.stored(operationId);
    if (!operation?.taskId) return 'skipped';
    const task = await this.lines.task(operation.taskId);
    if (!task) return 'skipped';
    const step = settlementOf({ status: operation.status as OperationStatus, appliedAt: operation.appliedAt, applyError: operation.applyError });
    if (step !== 'apply' && step !== 'hand-to-branch' && !(step === 'await-decision' && operation.status === 'unknown')) return 'skipped';
    const submitter = await this.submitterOf(task);
    if (step === 'apply') return this.applySucceeded(operation, task, submitter);
    if (step === 'hand-to-branch') return this.handToBranch(operation, task, submitter);
    return this.tellUnknown(operation, task, submitter);
  }

  /**
   * The sweeper (D8): acts on every operation whose verdict was recorded and not acted on, a batch at a time, so
   * a lost message or a worker that died loses nothing. One that fails for a technical reason is logged by its
   * code and met again on the next round. Answers how many it changed.
   */
  async applyPending(limit = 100): Promise<number> {
    let changed = 0;
    // What can be applied or handed over, then the unknown ones: each of those is announced once, so a lost or
    // failed message does not leave an unknown answer unsaid.
    const ids = [...(await this.operations.unsettled(limit)), ...(await this.operations.awaitingAnswer(limit))];
    for (const id of ids) {
      try {
        if ((await this.apply(id)) !== 'skipped') changed += 1;
      } catch (error) {
        log.error(`operation ${id}: the settlement failed and will be tried again (${errorCode(error)})`);
      }
    }
    return changed;
  }

  // ── T5: the provider confirmed ──────────────────────────────────────────────────────────────────────────

  private async applySucceeded(operation: OperationRow, task: TaskRow, submitter: Actor): Promise<Settled> {
    // An eSIM line is not made without its activation code (D16, `esim-code-missing`): the provider handed none
    // back and the task carries none. Nothing was tried, so there is nothing to roll back: the exception is written.
    if (task.esim && !operation.resultEsimCode && !task.esimQr) return this.recordException(operation, task, submitter, 'esim-code-missing');
    // Prepared before the transaction: the eSIM code as the line will carry it. A code that cannot be opened or
    // sealed is a technical fault: it throws here, nothing is written, and the sweeper comes back to it.
    const handedQr = await this.lineCode(operation, task);
    const result = { iccid: operation.resultIccid, msisdn: operation.resultMsisdn };
    let written: WrittenNotice[];
    try {
      written = await this.uow.runTx(async (tx) => {
        // 1. The task, claimed: `working → done`, guarded. A task somebody closed meanwhile is not ours.
        const claimed = await this.lines.claimTask(tx, task.id, null);
        if (claimed.count !== 1) throw new NothingToApply();
        // 2. The serial and the number the line will take, locked before the operation and the wallet.
        const wanted = settlementClaim(task, result);
        const claim = wanted.msisdn ? wanted : { ...wanted, msisdn: await this.completion.freshNumber(tx) };
        await lockClaim(tx, claim);
        // 3. The operation, locked (the one lock order) and stamped by compare-and-set: only while it is still
        //    succeeded, not applied, without an exception, and carries the very result that was read above.
        const { operation: locked } = await lockedTaskOperation(tx, task.id);
        if (locked?.id !== operation.id) throw new NothingToApply();
        if (!(await this.operations.stampApplied(tx, operation.id, operation, new Date()))) throw new NothingToApply();
        // 4. The line, the capture of the hold, the ledger's record and the task's result: the same code the
        //    branch's completion by hand runs.
        const handed = { ...(result.iccid ? { iccid: result.iccid } : {}), ...(result.msisdn ? { msisdn: result.msisdn } : {}) };
        const { sale, amount } = await this.completion.applyClaimed({ tx, task, actor: submitter, note: '', line: null, handed, handedQr, claim });
        return this.tasks.taskNotice(tx, 'done', task, submitter, { packageName: sale?.packageName ?? '', amount, handlerName: SYSTEM_SENDER_NAME }, false, true);
      });
    } catch (error) {
      if (error instanceof NothingToApply) return 'skipped';
      // A business refusal becomes the exception of D16; everything else is technical and is thrown on.
      const refused = error instanceof OfficeFailure ? applyErrorOf(error) : null;
      if (!refused) throw error;
      return this.recordException(operation, task, submitter, refused);
    }
    await this.uow.publishQuietly(written);
    log.log(`operation ${operation.id}: applied to task ${task.id}`);
    return 'applied';
  }

  /** The submitter as the actor of the entry (D12). A submitter that is gone is a target that is missing. */
  private async submitterOf(task: TaskRow): Promise<Actor> {
    const user = await this.lines.userById(task.submitterId);
    if (!user) throw new OfficeFailure(404, 'NOT_FOUND');
    return { id: user.id, loginName: user.loginName, nickname: user.nickname, layer: user.layer, isBranchOwner: user.isBranchOwner, grants: [], operatorId: user.id, impersonating: false };
  }

  /**
   * The eSIM code the line will carry, sealed: the provider's code as a QR picture when it handed one back, else
   * the code the task has carried; null for a line that is not an eSIM. Nothing of it is logged.
   */
  private async lineCode(operation: OperationRow, task: TaskRow): Promise<string | null> {
    if (!task.esim) return null;
    if (!operation.resultEsimCode) return storableEsimCode(task.esimQr, `task ${task.id}`);
    const picture = await renderActivationCode(open(operation.resultEsimCode));
    return storableEsimCode(picture, `operation ${operation.id}`);
  }

  // ── T5′: the provider confirmed and the line cannot be created ──────────────────────────────────────────

  /**
   * Its own transaction, after T5 rolled back: only the operation is written (`applyError`, `applyFailedAt`), once.
   * The status stays `succeeded` with its result; the task stays `working` with its hold and its reservation;
   * nothing is released and nothing is sent. The accounts that may decide are told.
   */
  private async recordException(operation: OperationRow, task: TaskRow, submitter: Actor, reason: ApplyError): Promise<Settled> {
    const written = await this.uow.runTx(async (tx) => {
      if (!(await this.operations.stampApplyError(tx, operation.id, reason, new Date()))) return null;
      return this.tellDeciders(tx, task, submitter, PROVIDER_EXCEPTION_NOTES[reason]);
    });
    if (!written) return 'skipped';
    await this.uow.publishQuietly(written);
    log.warn(`operation ${operation.id}: succeeded at the provider and could not be applied to task ${task.id} (${reason}); the hold is kept`);
    return 'exception';
  }

  // ── T6: the provider did not run it ─────────────────────────────────────────────────────────────────────

  /**
   * The task becomes an ordinary branch task noted as a provider failure, once (`appliedAt` marks it). The hold
   * stays: the branch completes it by hand or rejects it. Nothing is refunded and nothing is sent again.
   */
  private async handToBranch(operation: OperationRow, task: TaskRow, submitter: Actor): Promise<Settled> {
    const written = await this.uow.runTx(async (tx) => {
      const current = await lockedTask(tx, task.id);
      const { operation: locked } = await lockedTaskOperation(tx, task.id);
      if (!current || !locked || locked.id !== operation.id || settlementOf(locked) !== 'hand-to-branch') return null;
      if (!(await this.operations.stampHandedOver(tx, operation.id, new Date()))) return null;
      // A task its submitter cancelled meanwhile is closed already: only the mark is written.
      if (current.status !== 'working') return [];
      await this.lines.noteTask(tx, task.id, PROVIDER_FAILED_NOTE);
      const named = await this.lines.packageName(tx, task.packageId);
      return this.tasks.taskNotice(tx, 'opened', task, submitter, { packageName: named?.name ?? '', amount: task.posDelta, handlerName: SYSTEM_SENDER_NAME }, false, true);
    });
    if (!written) return 'skipped';
    await this.uow.publishQuietly(written);
    log.warn(`operation ${operation.id}: failed at the provider; task ${task.id} is the branch's`);
    return 'handed-to-branch';
  }

  // ── T7: the answer is not known ─────────────────────────────────────────────────────────────────────────

  /**
   * Tells the accounts that may decide, once per task. Nothing else is written: the task stays frozen with its
   * hold, no line is made and no money moves. A late answer of the provider closes it through `settle`.
   */
  private async tellUnknown(operation: OperationRow, task: TaskRow, submitter: Actor): Promise<Settled> {
    const written = await this.uow.runTx(async (tx) => {
      const current = await lockedTask(tx, task.id);
      const { operation: locked } = await lockedTaskOperation(tx, task.id);
      if (!current || current.status !== 'working' || !locked || locked.id !== operation.id || locked.status !== 'unknown') return null;
      // There is no column to mark it by, so the notice itself is the mark: read under the operation's lock.
      if (await this.lines.taskNoteSent(tx, task.id, PROVIDER_UNKNOWN_NOTE)) return null;
      const told = await this.tellDeciders(tx, task, submitter, PROVIDER_UNKNOWN_NOTE);
      // Nobody to tell (no account may decide yet): nothing was said, and the next round asks again.
      return told.length > 0 ? told : null;
    });
    if (!written) return 'skipped';
    await this.uow.publishQuietly(written);
    log.warn(`operation ${operation.id}: its answer is not known; task ${task.id} waits for a decision`);
    return 'awaiting-decision';
  }

  private tellDeciders(tx: Prisma.TransactionClient, task: TaskRow, submitter: Actor, text: string): Promise<WrittenNotice[]> {
    return tellDeciders(this.uow, this.tasks, tx, task, submitter, text, true);
  }
}

/**
 * A note to the branch accounts that may decide on a provider operation (the owner and the holders of the
 * decision grant), and to nobody else. Its author is «النظام»; it names the task and says what happened in fixed
 * words: never a serial or a code. Written by the settlement in the submitter's name (D12, `tellActor`), and by a
 * person's decision in that person's name, who is then not told what they did themselves.
 */
export async function tellDeciders(uow: UnitOfWork, tasks: TasksService, tx: Prisma.TransactionClient, task: OfficeTask, actor: Actor, text: string, tellActor: boolean): Promise<WrittenNotice[]> {
  const audience = await tasks.branchAccountsWith(tx, DECISION_GRANT);
  const payload: TaskNoticePayload = { taskId: task.id, action: task.action, msisdn: task.msisdn, authorName: SYSTEM_SENDER_NAME, handlerName: SYSTEM_SENDER_NAME, excerpt: text };
  return uow.notice.write(tx, audience, actor, { kind: 'task.note', payload }, tellActor ? { tellActor: true } : {});
}
