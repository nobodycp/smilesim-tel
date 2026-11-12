import { Injectable } from '@nestjs/common';
import type { OfficeTask, Prisma, ProviderOperation } from '../../../generated/prisma/client';
import type { ErrorCode } from '../../../errors';
import { parseInput } from '../../shared/input';
import { capList } from '../../shared/paging';
import { logger } from '../../shared/log';
import { OfficeFailure, fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { UnitOfWork } from '../kernel/unit-of-work';
import type { WrittenNotice } from '../notices/notice.service';
import { refuseEntered, requireGrant } from '../policy';
import type { OperationStatus } from '../providers/operations/provider-operation.rules';
import { ProviderOperationsService } from '../providers/operations/provider-operations.service';
import { simRefusal, simRulesOf } from '../rules/sim-rules';
import { PROVIDER_EXCEPTION_NOTES, PROVIDER_RELEASED_NOTE } from '../stored-text';
import { lockedTask, lockedTaskOperation } from '../tasks/task-operation';
import { TasksService } from '../tasks/tasks.service';
import { applyAsSettlement, submitterOf, tellDeciders } from './activation-settlement';
import { DECISION_GRANT, applyErrorOf, decisionChoices, decisionStep, needsSecondAccount, openProposal, shownPhase, type ApplyError, type Decision, type DecisionEvent, type DecisionEvidence, type DecisionRefusal, type DecisionRequest, type DecisionStep, type TaskOperation } from './activation-settlement.rules';
import { esimCodeOrFail, storableEsimCode } from './esim-code';
import { lockClaim } from './line-state';
import { LinesRepository } from './lines.repository';
import { ProviderDecisionApprovalBody, ProviderDecisionBody } from './lines.schemas';
import { isActivationCode, renderActivationCode } from './office-esim';
import type { Claim } from './reservation.rules';
import { TaskCompletion } from './task-completion';

const log = logger('ProviderDecisions');

/** How each refusal of the rules is answered. The rules say why; this table only says it over HTTP. */
const REFUSALS: Record<DecisionRefusal, [status: number, code: ErrorCode]> = {
  'entered-session': [403, 'FORBIDDEN'],
  'not-authorised': [403, 'FORBIDDEN'],
  'own-task': [403, 'DECISION_OWN_TASK'],
  'own-proposal': [403, 'DECISION_OWN_PROPOSAL'],
  'not-applicable': [409, 'DECISION_NOT_APPLICABLE'],
  'proposal-open': [409, 'DECISION_PROPOSAL_OPEN'],
  'no-proposal': [409, 'DECISION_NO_PROPOSAL'],
  'evidence-missing': [400, 'DECISION_EVIDENCE_REQUIRED'],
  'note-too-short': [400, 'DECISION_NOTE_SHORT'],
  'reference-missing': [400, 'DECISION_REFERENCE_REQUIRED'],
};

type Allowed = Extract<DecisionStep, { ok: true }>;
type Asked = DecisionRequest extends infer R ? (R extends unknown ? Omit<R, 'operation' | 'submitterId'> : never) : never;

/** What the person says the provider handed back: read only by the two decisions that make the line. */
type Given = { msisdn: string | null; iccid: string | null; esimCode: string | null };

/** How many waiting operations one read of the queue answers. */
const WAITING_CAP = 200;

type StoredRecord = Awaited<ReturnType<ProviderOperationsService['decisionRecords']>>[number];

/** One step of a decision as a screen shows it: who, what, on which evidence, when. Never an eSIM code. */
export type DecisionRecord = {
  sequence: number;
  type: string;
  decision: string;
  accountLoginName: string;
  evidenceKind: string | null;
  providerRef: string | null;
  note: string;
  suppliedEsimCode: boolean;
  at: string;
};

function recordOf(row: StoredRecord): DecisionRecord {
  return { sequence: row.sequence, type: row.type, decision: row.decision, accountLoginName: row.accountLoginName, evidenceKind: row.evidenceKind, providerRef: row.providerRef, note: row.note, suppliedEsimCode: row.suppliedEsimCode, at: row.createdAt.toISOString() };
}

type Standing = {
  phase: ReturnType<typeof shownPhase>;
  reason: string | null;
  held: number;
  proposal: DecisionRecord | null;
  decisions: Decision[];
  canApprove: boolean;
  canRefuse: boolean;
  blocked: DecisionRefusal | null;
};
export type DecisionView = Standing & { needs: { number: boolean; esimCode: boolean }; history: DecisionRecord[] };
export type WaitingDecision = Standing & { taskId: string; action: string; msisdn: string | null; packageName: string; posLoginName: string; submitterLoginName: string; waitingSince: string };

/** What a decision came to. `exception`: the success is on record and the line could not be made (D16). */
export type DecisionOutcome = { ok: true; outcome: 'applied' | 'proposed' } | { ok: true; outcome: 'exception'; reason: ApplyError };
export type ApprovalOutcome = { ok: true; outcome: 'approved' | 'refused' };

/**
 * Decisions by people on a task's provider operation (ADR 0019, D15 and D16; transactions T10 and T11).
 *
 * Who may decide, on what, with which evidence, and what the next step is, are the rules' (`decisionStep`): this
 * service asks them twice, once before it takes any lock (so a refusal costs nothing) and once more under the
 * operation's row lock, where the answer is the one that counts. It then writes that step's event and applies its
 * effect in the same transaction. It never calls a provider and never sends anything again.
 *
 * - *Confirm success* and *apply corrected* make the line through the code the settlement and the branch's
 *   completion run, through the settlement's own last step (`applyAsSettlement`), under the same three guards: the
 *   task claimed, the operation stamped once, the serial and the number locked. One account. The entry and the
 *   notice name the task's submitter as the actor and «النظام» as the handler (D12); the account that decided is
 *   named in the decision event and on the activity record only.
 * - *Declare failure* and *release after success* are a proposal that writes its event and nothing else; the
 *   effect belongs to the approval by another account (T11).
 *
 * Locks, in the one order: task → keys → operation → wallet.
 */
@Injectable()
export class ProviderDecisions {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly completion: TaskCompletion,
    private readonly tasks: TasksService,
    private readonly lines: LinesRepository,
    private readonly operations: ProviderOperationsService,
  ) {}

  /** T10: states a decision. It is applied at once, or stands as a proposal for another account. */
  async decide(actor: Actor, taskId: string, body: unknown): Promise<DecisionOutcome> {
    this.assertMayDecide(actor);
    const input = parseInput(ProviderDecisionBody, body);
    const { task, operation } = await this.subject(taskId);
    const evidence: DecisionEvidence = { kind: input.evidenceKind || null, note: input.note, providerRef: input.providerRef || null };
    const asked: Asked = { act: 'decide', decision: input.decision, evidence };
    // Asked first without a lock: a refusal takes none and writes nothing.
    this.stepOrFail(operation ? await this.operations.decisionEvents(this.uow.prisma, operation.id) : [], actor, asked, operation, task);
    if (!operation) fail(409, 'DECISION_NOT_APPLICABLE');
    if (needsSecondAccount(input.decision)) return this.propose(actor, task, asked, evidence);
    // A code is read for an eSIM only: a plain SIM has none, and one sent with it is dropped, not stored.
    const given: Given = { msisdn: input.msisdn || null, iccid: input.iccid || null, esimCode: (task.esim && input.esimCode) || null };
    return this.applyNow(actor, task, operation, input.decision, asked, evidence, given);
  }

  /** T11: another account answers the proposal that is open. Approving applies it; refusing closes it. */
  async answer(actor: Actor, taskId: string, body: unknown): Promise<ApprovalOutcome> {
    this.assertMayDecide(actor);
    const { approve } = parseInput(ProviderDecisionApprovalBody, body);
    const { task, operation } = await this.subject(taskId);
    const asked: Asked = { act: approve ? 'approve' : 'refuse' };
    this.stepOrFail(operation ? await this.operations.decisionEvents(this.uow.prisma, operation.id) : [], actor, asked, operation, task);
    const { outcome, written } = await this.uow.runTx(async (tx) => {
      // The task's row, then the operation's: the approval that releases the hold closes the task in this transaction.
      const current = await lockedTask(tx, task.id);
      const { step, locked } = await this.lockedStep(tx, actor, asked, task);
      await this.operations.recordDecision(tx, this.eventOf(step, locked.id, actor, null, false));
      if (step.effect === 'none') return { outcome: 'refused' as const, written: [] as WrittenNotice[] };
      if (current?.status !== 'working') fail(409, 'DECISION_NOT_APPLICABLE');
      if (step.effect === 'declare-failure') {
        // `unknown → failed`: the task is the branch's from this commit on. Its hold stays; the settlement notes
        // the task and tells the handlers (T6), as for any operation the provider did not run.
        if (!(await this.operations.declareFailed(tx, locked.id))) fail(409, 'DECISION_NOT_APPLICABLE');
        return { outcome: 'approved' as const, written: [] as WrittenNotice[] };
      }
      if (step.effect !== 'release-after-success') fail(409, 'DECISION_NOT_APPLICABLE');
      // The task is rejected and its hold given back, once. The operation keeps `succeeded`, what the provider
      // handed back and its exception: the record that the provider did run it. Nothing is sent again.
      return { outcome: 'approved' as const, written: await this.tasks.rejectByDecision(tx, task, actor, PROVIDER_RELEASED_NOTE) };
    });
    await this.uow.publishQuietly(written);
    if (outcome === 'approved') log.warn(`task ${task.id}: a proposed decision on its provider operation was approved by a second account`);
    return { ok: true, outcome };
  }

  // ── What a screen reads (O6) ────────────────────────────────────────────────────────────────────────────

  /**
   * One task's operation as an account that may decide reads it: where it stands, what this account may do about
   * it now (asked of the rules, so the screen offers what the routes will accept), what the form must ask for,
   * the proposal that is open and the record so far. Refused like a decision for anyone else, so the evidence and
   * the notes of a decision are read only by the accounts that could have written them. It reads no eSIM code:
   * the record has none, and the operation's own is not selected for it.
   */
  async view(actor: Actor, taskId: string): Promise<DecisionView> {
    this.assertMayDecide(actor);
    const { task, operation } = await this.subject(taskId);
    if (!operation) fail(404, 'NOT_FOUND');
    const records = await this.operations.decisionRecords([operation.id]);
    const state: TaskOperation = { status: operation.status as OperationStatus, appliedAt: operation.appliedAt, applyError: operation.applyError };
    return {
      ...this.standing(actor, state, task, records),
      needs: {
        number: !(operation.resultMsisdn ?? task.msisdn),
        esimCode: task.esim && !operation.resultEsimCode && !task.esimQr,
      },
      history: records.map(recordOf),
    };
  }

  /**
   * The operations that wait for a person, oldest first: the ones with a proposal to answer, and the ones nobody
   * has decided on yet. The same gate as a decision; the list never carries what a provider handed back.
   */
  async waiting(actor: Actor): Promise<{ items: WaitingDecision[]; capped: boolean }> {
    this.assertMayDecide(actor);
    const { rows, capped } = capList(await this.operations.awaitingDecision(WAITING_CAP + 1), WAITING_CAP);
    const records = await this.operations.decisionRecords(rows.map((row) => row.id));
    const items = rows.flatMap((row) => {
      if (!row.task) return [];
      const state: TaskOperation = { status: row.status as OperationStatus, appliedAt: row.appliedAt, applyError: row.applyError };
      const standing = this.standing(actor, state, row.task, records.filter((record) => record.operationId === row.id));
      return [{
        taskId: row.task.id,
        action: row.task.action,
        msisdn: row.task.msisdn,
        packageName: row.task.package.name,
        posLoginName: row.task.pos.loginName,
        submitterLoginName: row.task.submitter.loginName,
        waitingSince: row.updatedAt.toISOString(),
        ...standing,
      }];
    });
    return { items, capped };
  }

  /** What both reads say of one operation: its state, the money, the open proposal and what this account may do. */
  private standing(actor: Actor, operation: TaskOperation, task: { submitterId: string; held: number | null; posDelta: number }, records: StoredRecord[]) {
    const events = records as unknown as DecisionEvent[];
    const open = openProposal(events);
    const choices = decisionChoices(events, actor, operation, task.submitterId);
    const proposal = open ? records.find((record) => record.sequence === open.sequence) : undefined;
    return {
      phase: shownPhase(operation),
      reason: operation?.applyError ?? null,
      held: task.held ?? 0,
      proposal: proposal ? recordOf(proposal) : null,
      decisions: choices.decisions,
      canApprove: choices.approve,
      canRefuse: choices.refuse,
      blocked: choices.blocked,
    };
  }

  // ── Who, and on what ────────────────────────────────────────────────────────────────────────────────────

  /**
   * Refused before anything is read: an entered session, and any account that is not the branch owner or a
   * branch account holding the decision grant. The rules say the same again with the task in hand.
   */
  private assertMayDecide(actor: Actor): void {
    refuseEntered(actor);
    requireGrant(actor, DECISION_GRANT);
  }

  private async subject(taskId: string): Promise<{ task: OfficeTask; operation: ProviderOperation | null }> {
    const task = await this.lines.task(taskId);
    if (!task) fail(404, 'NOT_FOUND');
    return { task, operation: await this.operations.ofTask(task.id) };
  }

  /** The rules' answer, or the refusal as the route answers it. */
  private stepOrFail(events: readonly { sequence: number; type: string; decision: string; accountId: string }[], actor: Actor, asked: Asked, operation: TaskOperation | { status: string; appliedAt: Date | null; applyError: string | null }, task: OfficeTask): Allowed {
    const request = { ...asked, operation: operation as TaskOperation, submitterId: task.submitterId } as DecisionRequest;
    const step = decisionStep(events as DecisionEvent[], actor, request);
    if (!step.ok) fail(...REFUSALS[step.refusal]);
    return step;
  }

  /** The rules asked again where the answer counts: under the operation's row lock, on the events as they stand. */
  private async lockedStep(tx: Prisma.TransactionClient, actor: Actor, asked: Asked, task: OfficeTask) {
    const { operation: locked } = await lockedTaskOperation(tx, task.id);
    if (!locked) fail(409, 'DECISION_NOT_APPLICABLE');
    const step = this.stepOrFail(await this.operations.decisionEvents(tx, locked.id), actor, asked, locked, task);
    return { step, locked };
  }

  /** One row of the permanent record. An eSIM code is never part of it: only that one was supplied. */
  private eventOf(step: Allowed, operationId: string, actor: Actor, evidence: DecisionEvidence | null, suppliedEsimCode: boolean) {
    return {
      operationId,
      sequence: step.event.sequence,
      type: step.event.type,
      decision: step.event.decision,
      evidenceKind: evidence?.kind ?? null,
      providerRef: evidence?.providerRef?.trim() || null,
      note: evidence?.note.trim() ?? '',
      suppliedEsimCode,
      accountId: actor.id,
      accountLoginName: actor.loginName,
    };
  }

  // ── T10, a proposal ─────────────────────────────────────────────────────────────────────────────────────

  /** Only the event is written, under the operation's lock: the operation, the task and the hold stay as they are. */
  private async propose(actor: Actor, task: OfficeTask, asked: Asked, evidence: DecisionEvidence): Promise<DecisionOutcome> {
    await this.uow.runTx(async (tx) => {
      const { step, locked } = await this.lockedStep(tx, actor, asked, task);
      await this.operations.recordDecision(tx, this.eventOf(step, locked.id, actor, evidence, false));
    });
    return { ok: true, outcome: 'proposed' };
  }

  // ── T10, a decision by one account ──────────────────────────────────────────────────────────────────────

  private async applyNow(actor: Actor, task: OfficeTask, operation: ProviderOperation, decision: Decision, asked: Asked, evidence: DecisionEvidence, given: Given): Promise<DecisionOutcome> {
    await this.assertSerial(task, given.iccid);
    // A code that is given must be an activation code: anything else is refused before it is sealed or stored.
    if (given.esimCode && !isActivationCode(given.esimCode)) fail(400, 'ESIM_CODE_REQUIRED');
    // The sale is its submitter's, whoever decides (D12): the entry and the notices are written in that name.
    const submitter = await submitterOf(this.lines, task);
    // What goes on the line: what the person gave, else what the provider handed back, else what the task named.
    const claim: Claim = { iccid: given.iccid ?? operation.resultIccid ?? task.iccid, msisdn: given.msisdn ?? operation.resultMsisdn ?? task.msisdn };
    // A person who says the provider activated a line says which number: none is made up here.
    if (!claim.msisdn) fail(400, 'DECISION_NUMBER_REQUIRED');
    // An eSIM line is not made without its code (D16): without one nothing is written and the exception stays.
    if (task.esim && !given.esimCode && !operation.resultEsimCode && !task.esimQr) fail(400, 'ESIM_CODE_REQUIRED');
    // Sealed before any transaction: the code as the line carries it, and as the operation keeps it.
    const handedQr = await this.lineCode(task, operation, given.esimCode);
    const columns = decision === 'confirm-success' ? this.operations.storableResult(given) : null;
    const suppliedEsimCode = Boolean(given.esimCode);
    const handed = { ...(claim.iccid && claim.iccid !== task.iccid ? { iccid: claim.iccid } : {}), ...(claim.msisdn !== task.msisdn ? { msisdn: claim.msisdn } : {}) };
    let written: WrittenNotice[];
    try {
      written = await this.uow.runTx(async (tx) => {
        // 1. The task, claimed: `working → done`, guarded.
        const claimed = await this.lines.claimTask(tx, task.id, null);
        if (claimed.count !== 1) fail(409, 'DECISION_NOT_APPLICABLE');
        // 2. The serial and the number, locked before the operation and the wallet.
        await lockClaim(tx, claim);
        // 3. The operation, locked; the rules asked again; the event; the guarded move and the stamp, once.
        const { step, locked } = await this.lockedStep(tx, actor, asked, task);
        await this.operations.recordDecision(tx, this.eventOf(step, locked.id, actor, evidence, suppliedEsimCode));
        const now = new Date();
        const stamped = decision === 'confirm-success'
          ? (await this.operations.confirmUnknown(tx, locked.id, evidence.providerRef, columns)) &&
            (await this.operations.stampApplied(tx, locked.id, { resultMsisdn: columns?.msisdn ?? null, resultIccid: columns?.iccid ?? null, resultEsimCode: columns?.sealedEsimCode ?? null }, now))
          : await this.operations.stampAppliedCorrected(tx, locked.id, now);
        if (!stamped) fail(409, 'DECISION_NOT_APPLICABLE');
        // 4. The line, the capture of the hold, the ledger's record and the task's result: the settlement's code.
        //    Written in the submitter's name with «النظام» as the handler (D12): the sale stays the submitter's. The
        //    account that decided is in the decision event above and on the activity record, and nowhere else.
        return applyAsSettlement(this.completion, this.tasks, tx, task, submitter, { handed, handedQr, claim });
      });
    } catch (error) {
      // The line could not be made for a business reason: the transaction rolled back whole. A confirmation is
      // still true (the provider ran it), so it is recorded with the exception of D16. A correction that does not
      // fit either changes nothing: the exception and the hold stay, and the refusal says what was taken.
      const reason = error instanceof OfficeFailure ? applyErrorOf(error) : null;
      if (!reason || decision !== 'confirm-success') throw error;
      return this.confirmAsException(actor, submitter, task, asked, evidence, columns, suppliedEsimCode, reason);
    }
    await this.uow.publishQuietly(written);
    log.log(`task ${task.id}: its provider operation was applied by a person's decision (${decision})`);
    return { ok: true, outcome: 'applied' };
  }

  /**
   * A confirmed success whose line cannot be made (D16): the event, `unknown → succeeded` with what the provider
   * handed back, and the reason, in one transaction. The task stays `working` with its hold and its reservation;
   * *apply corrected* or the approved release closes it.
   */
  private async confirmAsException(actor: Actor, submitter: Actor, task: OfficeTask, asked: Asked, evidence: DecisionEvidence, columns: ReturnType<ProviderOperationsService['storableResult']>, suppliedEsimCode: boolean, reason: ApplyError): Promise<DecisionOutcome> {
    const written = await this.uow.runTx(async (tx) => {
      const { step, locked } = await this.lockedStep(tx, actor, asked, task);
      await this.operations.recordDecision(tx, this.eventOf(step, locked.id, actor, evidence, suppliedEsimCode));
      const recorded = (await this.operations.confirmUnknown(tx, locked.id, evidence.providerRef, columns)) && (await this.operations.stampApplyError(tx, locked.id, reason, new Date()));
      if (!recorded) fail(409, 'DECISION_NOT_APPLICABLE');
      // As T5′ of the settlement: from «النظام», in the submitter's name, to every account that may decide.
      return tellDeciders(this.uow, this.tasks, tx, task, submitter, PROVIDER_EXCEPTION_NOTES[reason], true);
    });
    await this.uow.publishQuietly(written);
    log.warn(`task ${task.id}: a person confirmed the provider's success and the line could not be made (${reason}); the hold is kept`);
    return { ok: true, outcome: 'exception', reason };
  }

  /** A serial the person gave is held to the company's rules, as one the branch hands back with a completion. */
  private async assertSerial(task: OfficeTask, iccid: string | null): Promise<void> {
    if (!iccid) return;
    const pkg = await this.lines.packageWithCompany(task.packageId);
    const refusal = simRefusal(simRulesOf(pkg?.company ?? null), iccid);
    if (refusal) fail(400, refusal);
  }

  /**
   * The eSIM code the line will carry, sealed: the code the person gave, else the provider's, each as a QR
   * picture; else the one the task has carried. Null for a line that is not an eSIM. Nothing of it is logged.
   */
  private async lineCode(task: OfficeTask, operation: ProviderOperation, given: string | null): Promise<string | null> {
    if (!task.esim) return null;
    const code = given ?? esimCodeOrFail(operation.resultEsimCode, `operation ${operation.id}`);
    if (code) return storableEsimCode(await renderActivationCode(code), `task ${task.id}`);
    return storableEsimCode(task.esimQr, `task ${task.id}`);
  }
}
