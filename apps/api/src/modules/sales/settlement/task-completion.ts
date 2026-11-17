import { assertOperationAllows, canHandleTasks, TasksService } from '../../tasks';
import { esimCodeOrFail, storableEsimCode, UnitOfWork, parseInput, fail } from '../../platform';
import { LinesRepository } from '../lines.repository';
import { WalletLedger, saleOf } from '../../wallets';
import { assertBranch } from '../../access';
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { Task, Prisma } from '../../../generated/prisma/client';
import { lineTermsOf, activationProviderCost, captureTerms, providerBranchCost, packageTermsOf } from '../../pricing';
import type { Actor, PathNode } from '../../access';
import type { Action } from '../../catalog';
import type { Sale } from '../../wallets';
import { daysOf, periodEnd, renewOnto, renewStay, switchOnto, windowMonthsOf } from '../rules/periods';
import { esimPriceOf, simRefusal, simRulesOf } from '../../catalog';
import { LinePricing } from '../line-pricing';
import { assertClaimFree, lockClaim, lockedTaskLine, moveLineStatus, numberTaken } from '../line-state';
import { completionClaim, type Claim } from '../reservation.rules';
import { keepsHoldForHandler, requotedSettlement, taskCharge } from './task-charge.rules';
import { MSISDN, periodOf, readQr } from '../line-input';
import { CompleteTaskBody } from '../lines.schemas';

type TaskLine = Awaited<ReturnType<typeof lockedTaskLine>>;

/** What a handler is given: the claimed task, its locked line, and what the branch handed back with it. */
export type Completion = {
  tx: Prisma.TransactionClient;
  task: Task;
  actor: Actor;
  note: string;
  line: TaskLine | null;
  handed: { iccid?: string; msisdn?: string };
  handedQr: string | null;
  /** The serial and the number this completion puts on a line, locked before the wallet. */
  claim: Claim;
  /**
   * The task's point of sale's path, read before the transaction (`pathOf`). Prices and the ladder are built on it
   * once it is confirmed by its accounts' rows; the whole tree is not read in the transaction (DB.9, ADR 0023).
   * Without it the path is read up by id.
   */
  posPath?: PathNode[];
};

/**
 * What a handler did: the sale to record, whether it already wrote its wallet entry, and the amount it moved.
 * `postedCost`: the provider cost of a sale that names none (a plain activation: the subscription's branch cost on
 * the line's new terms). Stored whether the task's charge posts it or the task charged nothing (spec DB.5 P.7: an
 * activation priced 0 stores the package's real cost, marked `priced_zero`; before P.7 it stored 0).
 */
type Applied = { sale?: Sale; posted?: boolean; amount?: number; postedCost?: number };

/**
 * Closing a branch task applies the operation it deferred. One handler per action; each runs inside the
 * transaction that claimed the task, on a line that is locked and still in a state the action applies to
 * (line-state.ts), so a stale task is refused instead of applied.
 */
@Injectable()
export class TaskCompletion {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ledger: WalletLedger,
    private readonly tasks: TasksService,
    private readonly pricing: LinePricing,
    private readonly repo: LinesRepository,
  ) {}

  private readonly handlers: Record<Action, (job: Completion) => Promise<Applied>> = {
    activate: (job) => this.activate(job),
    disconnect: (job) => this.disconnect(job),
    freeze: (job) => this.setStatus(job, 'active', 'frozen'),
    unfreeze: (job) => this.setStatus(job, 'frozen', 'active'),
    extend: (job) => this.renew(job),
    charge: (job) => this.renew(job),
    reactivate: (job) => this.renew(job),
    switch: (job) => this.switch(job),
    rename: (job) => this.rename(job),
    sim: (job) => this.swapSim(job),
    esim: (job) => this.issueEsim(job),
    refresh: async () => ({}),
    addon: async () => ({}),
  };

  /** Closing a task may carry what the provider handed back: an eSIM serial and QR, or the new number. */
  async complete(actor: Actor, id: string, body: unknown) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const input = parseInput(CompleteTaskBody, body);
    const { note } = input;
    const task = await this.repo.task(id);
    // Any branch account that handles tasks may finish an open one (spec 2026-11-09, 2); the claim below makes sure
    // only one of two at the same moment does.
    if (!task || task.status !== 'working') fail(400, 'INVALID');
    const { handed, handedQr } = await this.handedBack(task, input);
    const posPath = await this.pathOf(task.posId);
    const written = await this.uow.runTx(async (tx) => {
      // Claim the task first: a second handler finishing it at the same moment waits on this row, then finds it done.
      const claimed = await this.repo.claimTask(tx, id, actor.id);
      if (claimed.count !== 1) fail(400, 'INVALID');
      // The line before any wallet (rule 1.4), and only if it is still where the task expects it.
      const line = task.lineId ? await lockedTaskLine(tx, task.action as Action, task.lineId) : null;
      // What the handler will put on a line is locked now: the keys come before any wallet (ADR 0019, lock order),
      // and an activation with no number yet is given one here for the same reason.
      const wanted = completionClaim(task, handed);
      const claim = task.action === 'activate' && !wanted.msisdn ? { ...wanted, msisdn: await this.pricing.freshMsisdn(tx) } : wanted;
      await lockClaim(tx, claim);
      // The task's provider operation, locked after the keys and before any wallet: a completion by hand goes on
      // only with none or a failed one (ADR 0019, D6; T8). Refused, the transaction rolls back and nothing moved.
      await assertOperationAllows(tx, id, 'complete');
      // A hold that the charge will be settled against stays until then: a fixed debit is captured after the
      // handler, a switch settles its re-quoted amount inside its handler (ADR 0019, D10). Any other hold gives way
      // now, before the handler moves money of its own (roadmap N6).
      if (!keepsHoldForHandler(task)) await this.ledger.release(tx, task.posId, task.held ?? 0, actor.operatorId, note);
      const { sale, amount } = await this.applyClaimed({ tx, task, actor, note, line, handed, handedQr, claim, posPath });
      return this.tasks.taskNotice(tx, 'done', task, actor, { packageName: sale?.packageName ?? '', amount, handlerName: actor.nickname });
    });
    await this.uow.publishQuietly(written);
    return { ok: true };
  }

  /** A point of sale's path up the tree, read before a transaction that completes its task (`Completion.posPath`). */
  pathOf(posId: string): Promise<PathNode[]> {
    return this.pricing.pathOf(posId);
  }

  /**
   * Records the activation a provider ran whose money was given back to the point of sale (spec DB.5 P.7): an
   * operation moving 0 on the task's point of sale's wallet, with the sale's provider and cost, marked `given_back`.
   * Called by the approval of a release after the provider's success, after the hold's release, in its transaction.
   */
  recordGivenBack(tx: Prisma.TransactionClient, task: Pick<Task, 'posId' | 'action'>, actor: Actor, sale: Sale & { providerLoss: 'given_back' }, note: string): Promise<void> {
    return this.ledger.recordOp(tx, task.posId, actor.operatorId, task.action, sale, note);
  }

  /** A number for an activation that has none yet, as the branch's completion gives one. */
  freshNumber(tx: Prisma.TransactionClient): Promise<string> {
    return this.pricing.freshMsisdn(tx);
  }

  /**
   * Applies a task that the caller's transaction has claimed, with its claim keys locked: the action's handler
   * (for an activation, the line), the charge (a fixed debit is captured from the task's hold), the ledger's
   * record and the task's result. The one place this is written: the branch's completion by hand uses it, and so
   * does the settlement of a provider's confirmed activation (`activation-settlement.ts`, ADR 0019 T5), so both
   * create the same line at the same price. Answers the sale and the amount the task moved.
   */
  async applyClaimed(job: Completion): Promise<{ sale: Sale | undefined; amount: number }> {
    const { tx, task, actor, note, handed } = job;
    const applied = await this.handlers[task.action as Action](job);
    const sale = applied.sale ?? (await this.plainSale(job));
    const charged = sale && sale.providerCost === undefined && applied.postedCost !== undefined ? { ...sale, providerCost: applied.postedCost } : sale;
    const posted = (await this.charge(job, charged)) || applied.posted === true;
    // A task that charged nothing records the operation with the cost a charged one stores (P.7: an activation priced
    // 0 is a purchase the branch pays and the point of sale does not; the ledger marks it `priced_zero`).
    if (!posted && charged) await this.ledger.recordOp(tx, task.posId, actor.operatorId, task.action, charged);
    await this.repo.recordTaskResult(tx, task.id, {
      resultNote: note || null,
      ...(handed.iccid ? { iccid: handed.iccid } : {}),
      ...(handed.msisdn ? { msisdn: handed.msisdn } : {}),
      ...(applied.amount !== undefined ? { posDelta: applied.amount } : {}),
    });
    return { sale, amount: applied.amount ?? task.posDelta };
  }

  /** Checks what the branch attached to the completion: the new number of a rename, the serial and QR of an eSIM. */
  private async handedBack(task: Task, given: z.output<typeof CompleteTaskBody>) {
    const { iccid: givenIccid, msisdn: givenMsisdn } = given;
    const givenQr = readQr(given.qr) ?? null;
    const handed: { iccid?: string; msisdn?: string } = {};
    if (task.action === 'esim' && (!givenIccid || !givenQr)) fail(400, 'INVALID');
    if (task.action === 'rename') {
      if (!MSISDN.test(givenMsisdn)) fail(400, 'INVALID');
      const taken = await this.repo.lineByMsisdn(givenMsisdn);
      if (taken && taken.id !== task.lineId) fail(409, 'NUMBER_TAKEN');
      handed.msisdn = givenMsisdn;
    }
    if (givenIccid && (task.action === 'esim' || (task.esim && (task.action === 'activate' || task.action === 'sim')))) {
      const taskPkg = await this.repo.packageWithCompany(task.packageId);
      const refusal = simRefusal(simRulesOf(taskPkg?.company ?? null), givenIccid);
      if (refusal) fail(400, refusal);
      handed.iccid = givenIccid;
    }
    const handsCode = task.action === 'esim' || task.esim;
    // The code the task has carried since it opened is about to be put on the line as it is stored. One that does
    // not open is refused here, before anything is written or charged; a code given now takes its place.
    if (handsCode && !givenQr) esimCodeOrFail(task.esimQr, `task ${task.id}`);
    // What goes on the line is sealed here, before the transaction (S.5b): a code given now is sealed; the task's
    // stored one is handed on as it is when it is sealed already (never sealed twice), and sealed now when it was
    // stored before sealing.
    const handedQr = handsCode ? storableEsimCode(givenQr ?? task.esimQr, `task ${task.id}`) : null;
    return { handed, handedQr };
  }

  /**
   * The amount the task carried since it opened. A disconnect and a switch post their own. A debit the task's hold
   * covers exactly is captured: the hold becomes the charge without a second ceiling check.
   */
  private async charge({ tx, task, actor, note, posPath }: Completion, given: Sale | undefined): Promise<boolean> {
    const how = taskCharge(task);
    if (how === 'requote' || how === 'own' || how === 'none') return false;
    // An add-on's wallet entry carries its name when the handler wrote no note.
    const entryNote = task.action === 'addon' ? note || task.note || '' : note;
    const sale = given && posPath ? { ...given, path: posPath } : given;
    if (how === 'capture') await this.ledger.capture(tx, task.posId, task.held, task.posDelta, actor.operatorId, task.action, entryNote, sale);
    else await this.ledger.move(tx, task.posId, task.posDelta, actor.operatorId, task.action, entryNote, sale);
    return true;
  }

  /** The sale of an operation that sells nothing new: the line as it stands after the handler ran. */
  private async plainSale({ tx, task }: Completion): Promise<Sale | undefined> {
    if (!task.lineId) return undefined;
    const current = await this.repo.lineWithCompany(tx, task.lineId);
    if (!current) return undefined;
    // An eSIM request's debit is the eSIM fee, and that fee is what the provider charges for it.
    return task.action === 'esim' ? { ...saleOf(current), providerCost: -task.posDelta, esimPrice: -task.posDelta } : saleOf(current);
  }

  private async activate({ tx, task, handedQr, claim, posPath }: Completion): Promise<Applied> {
    const pkg = await this.repo.packageWithRenewalsById(tx, task.packageId);
    if (!pkg) fail(404, 'NOT_FOUND');
    if (!pkg.company || !pkg.provider) fail(400, 'INVALID');
    if (pkg.renewals.some((renewal) => !renewal.target.company || !renewal.target.provider)) fail(400, 'INVALID');
    const pkgTerms = packageTermsOf(pkg);
    const terms = await this.pricing.stampFor(captureTerms(pkgTerms, pkg.renewals.map((renewal) => packageTermsOf(renewal.target))), task.posId, posPath, tx);
    // The task is claimed, so its own reservation is over: what it takes must be free of lines and of other tasks.
    const iccid = claim.iccid ?? null;
    await assertClaimFree(tx, claim);
    const created = await this.repo.createLine(tx, {
      msisdn: claim.msisdn as string,
      iccid,
      esim: task.esim,
      esimQr: task.esim ? handedQr : null,
      status: 'active',
      packageId: task.packageId,
      posId: task.posId,
      terms: terms as unknown as Prisma.InputJsonValue,
      endsAt: periodEnd(new Date(), daysOf(pkg.months)),
    });
    // The price the task was opened at is the price charged, so it is the price recorded (rule 1.5). Tasks opened
    // before the price was stored fall back to today's.
    const packagePrice = task.unitPrice ?? (await this.pricing.resolveBuyPrice(task.posId, pkg, 'subscription', posPath, tx));
    return {
      sale: {
        msisdn: created.msisdn,
        lineId: created.id,
        companyName: pkg.company?.name ?? '',
        packageName: pkg.name,
        packagePrice,
        providerId: pkg.providerId,
        providerCost: activationProviderCost(pkgTerms.subscription.branchCost, task.esim, esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).price),
        // The fee folded into the task's debit when it was opened: what the row's amount holds beyond the package price.
        ...(task.esim ? { esimPrice: Math.max(0, -task.posDelta - packagePrice) } : {}),
        period: periodOf(daysOf(pkg.months), created.endsAt),
        periodCost: pkgTerms.subscription.branchCost,
      },
      postedCost: providerBranchCost('activate', terms, pkg),
    };
  }

  private async disconnect({ tx, task, actor, note, line }: Completion): Promise<Applied> {
    if (!line) return {};
    const settled = await this.pricing.disconnectSettlementFor(tx, line, new Date());
    await moveLineStatus(tx, line.id, ['active'], 'disconnected');
    if (!settled) return {};
    const sale: Sale = {
      msisdn: line.msisdn,
      lineId: line.id,
      companyName: line.package.company?.name ?? '',
      packageName: line.package.name,
      packagePrice: settled.posPrice,
      providerId: line.package.providerId,
      providerCost: settled.providerCost,
    };
    // The task may have waited until the unused days are worth no more than the fee. The number is disconnected
    // at the provider by now, so the task still closes: it moves no money, and the entry keeps the provider's cost.
    if (!settled.refundable) return { sale };
    await this.ledger.move(tx, task.posId, settled.amount, actor.operatorId, 'disconnect', note, sale);
    return { posted: true, amount: settled.amount };
  }

  private async setStatus({ tx, line }: Completion, from: 'active' | 'frozen', to: 'active' | 'frozen'): Promise<Applied> {
    if (line) await moveLineStatus(tx, line.id, [from], to);
    return {};
  }

  /** An extension adds a period to a live line; a charge or reactivation starts a disconnected one again. */
  private async renew({ tx, task, line }: Completion): Promise<Applied> {
    if (!line) return {};
    if (!line.package.company || !line.package.provider) fail(400, 'INVALID');
    const extending = task.action === 'extend';
    const base = extending && line.endsAt > new Date() ? line.endsAt : new Date();
    const target = extending && task.nextPackageId
      ? await this.repo.packageById(tx, task.nextPackageId)
      : null;
    if (extending && task.nextPackageId && (!target || !target.company || !target.provider)) fail(400, 'INVALID');
    const lineTerms = lineTermsOf(line.terms, line.package);
    const renewal = extending ? (target ? renewOnto(lineTerms, packageTermsOf(target), base) : renewStay(lineTerms, base)) : null;
    if (renewal && 'error' in renewal) fail(400, 'INVALID');
    const terms = renewal ? renewal.terms : { ...lineTerms, windowMonths: line.package.months };
    const endsAt = renewal?.endsAt ?? periodEnd(base, daysOf(line.package.months));
    const data = { endsAt, terms: terms as unknown as Prisma.InputJsonValue, ...(target ? { packageId: target.id } : {}) };
    if (extending) await this.repo.extendLine(tx, line.id, data);
    else await moveLineStatus(tx, line.id, ['disconnected'], 'active', data);
    // What the provider charges for this period, kept on the entry (rule 1.6).
    const periodCost = providerBranchCost(task.action, terms, target ?? line.package);
    return {
      sale: {
        ...saleOf(line, target ?? undefined, -task.posDelta),
        providerCost: periodCost,
        period: periodOf(daysOf(windowMonthsOf(terms)), endsAt),
        periodCost,
      },
    };
  }

  private async switch({ tx, task, actor, note, line, posPath }: Completion): Promise<Applied> {
    if (!line || !task.nextPackageId) {
      // Nothing to switch: the hold was kept for this handler, so it is given back here.
      await this.ledger.release(tx, task.posId, task.held ?? 0, actor.operatorId, note);
      return {};
    }
    const [source, target] = await Promise.all([
      this.repo.packageWithSwitches(tx, task.packageId),
      this.repo.packageById(tx, task.nextPackageId),
    ]);
    const whole = (pkg: { company: unknown; provider: unknown } | null) => Boolean(pkg && pkg.company && pkg.provider);
    if (!whole(line.package) || !source || !whole(source) || !target || !whole(target)) fail(400, 'INVALID');
    const switched = switchOnto(lineTermsOf(line.terms, line.package), packageTermsOf(source), packageTermsOf(target), source.switches.map((item) => item.target.code));
    if ('error' in switched) fail(400, 'INVALID');
    // The line is priced on its own point of sale's path: the task's, read before the transaction, when the line is
    // still that point of sale's; otherwise read up by id (DB.9).
    const linePath = line.posId === task.posId ? posPath : undefined;
    const quote = await this.pricing.switchQuote(tx, line, target, new Date(), linePath);
    const amount = -quote.difference;
    const sale: Sale = {
      msisdn: line.msisdn,
      lineId: line.id,
      companyName: target.company?.name ?? '',
      packageName: target.name,
      packagePrice: quote.newPrice,
      providerId: target.providerId,
      providerCost: quote.providerCost,
      period: periodOf(daysOf(target.months), null),
      periodCost: quote.periodCost,
      ...(posPath ? { path: posPath } : {}),
    };
    // The difference is the one of today, not of the day the task opened: the days left are fewer now. It is
    // settled against the hold taken then. If the wallet cannot cover what the hold does not, this throws and the
    // whole completion rolls back: the line and the task stay as they were.
    const settlement = requotedSettlement(task.held, amount);
    if (settlement.by === 'capture') {
      await this.ledger.capture(tx, task.posId, settlement.held, settlement.amount, actor.operatorId, 'switch', note, sale);
    } else {
      await this.ledger.release(tx, task.posId, settlement.held, actor.operatorId, note);
      if (settlement.credit > 0) await this.ledger.move(tx, task.posId, settlement.credit, actor.operatorId, 'switch', note, sale);
      else await this.ledger.recordOp(tx, task.posId, actor.operatorId, 'switch', sale);
    }
    // Same as an immediate switch: the line carries the renewal price its point of sale pays today.
    const stamped = await this.pricing.stampFor(switched.terms, line.posId, linePath, tx);
    await this.repo.switchLine(tx, line.id, stamped as unknown as Prisma.InputJsonValue, target.id);
    return { sale, posted: true, amount };
  }

  private async rename({ tx, line, handed }: Completion): Promise<Applied> {
    if (!line || !handed.msisdn) return {};
    await assertClaimFree(tx, { msisdn: handed.msisdn }, { exceptLineId: line.id });
    await this.repo.renameLine(tx, line.id, handed.msisdn).catch(numberTaken);
    return {};
  }

  private async swapSim({ tx, task, line, handedQr }: Completion): Promise<Applied> {
    if (!line || !task.iccid) return {};
    await assertClaimFree(tx, { iccid: task.iccid }, { exceptLineId: line.id });
    await this.repo.setLineSim(tx, line.id, { iccid: task.iccid, esim: task.esim, esimQr: task.esim ? handedQr : null });
    return {};
  }

  private async issueEsim({ tx, line, handed, handedQr }: Completion): Promise<Applied> {
    if (!line || !handed.iccid) return {};
    await assertClaimFree(tx, { iccid: handed.iccid }, { exceptLineId: line.id });
    await this.repo.setLineSim(tx, line.id, { iccid: handed.iccid, esim: true, esimQr: handedQr });
    return {};
  }
}
