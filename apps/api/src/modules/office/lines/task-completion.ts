import { Injectable } from '@nestjs/common';
import type { OfficeTask, Prisma } from '../../../generated/prisma/client';
import { fail } from '../../shared/office-failure';
import { lineTermsOf } from '../kernel/line-terms';
import { assertBranch, OfficeKernel } from '../kernel/office-kernel';
import { saleOf } from '../kernel/sale';
import type { Action, Actor, Sale } from '../kernel/types';
import { activationProviderCost, captureTerms, esimPriceOf, periodEnd, providerBranchCost, renewOnto, renewStay, simRefusal, simRulesOf, switchOnto, windowMonthsOf } from '../office-rules';
import { packageTermsOf } from '../office-terms';
import { canHandleTasks } from '../task-access';
import { TasksService } from '../tasks/tasks.service';
import { LinePricing } from './line-pricing';
import { assertSimFree, lockedTaskLine, moveLineStatus } from './line-state';
import { MSISDN, periodOf, readQr } from './line-input';

type TaskLine = Awaited<ReturnType<typeof lockedTaskLine>>;

/** What a handler is given: the claimed task, its locked line, and what the branch handed back with it. */
type Completion = {
  tx: Prisma.TransactionClient;
  task: OfficeTask;
  actor: Actor;
  note: string;
  line: TaskLine | null;
  handed: { iccid?: string; msisdn?: string };
  handedQr: string | null;
};

/** What a handler did: the sale to record, whether it already wrote its wallet entry, and the amount it moved. */
type Applied = { sale?: Sale; posted?: boolean; amount?: number };

/**
 * Closing a branch task applies the operation it deferred. One handler per action; each runs inside the
 * transaction that claimed the task, on a line that is locked and still in a state the action applies to
 * (line-state.ts), so a stale task is refused instead of applied.
 */
@Injectable()
export class TaskCompletion {
  constructor(
    private readonly kernel: OfficeKernel,
    private readonly tasks: TasksService,
    private readonly pricing: LinePricing,
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
  async complete(actor: Actor, id: string, body: { note?: unknown; iccid?: unknown; qr?: unknown; msisdn?: unknown }) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const task = await this.kernel.prisma.officeTask.findUnique({ where: { id } });
    // Any branch account that handles tasks may finish an open one (spec 2026-11-09, 2); the claim below makes sure
    // only one of two at the same moment does.
    if (!task || task.status !== 'working') fail(400, 'INVALID');
    const { handed, handedQr } = await this.handedBack(task, body);
    const written = await this.kernel.runTx(async (tx) => {
      // Claim the task first: a second handler finishing it at the same moment waits on this row, then finds it done.
      const claimed = await tx.officeTask.updateMany({ where: { id, status: 'working' }, data: { status: 'done', assigneeId: actor.id } });
      if (claimed.count !== 1) fail(400, 'INVALID');
      // The line before any wallet (rule 1.4), and only if it is still where the task expects it.
      const line = task.lineId ? await lockedTaskLine(tx, task.action as Action, task.lineId) : null;
      // The hold made when the task opened gives way to the charge itself (roadmap N6), before any money moves.
      await this.kernel.release(tx, task.posId, task.held ?? 0, actor.operatorId, note);
      const job: Completion = { tx, task, actor, note, line, handed, handedQr };
      const applied = await this.handlers[task.action as Action](job);
      const sale = applied.sale ?? (await this.plainSale(job));
      const posted = (await this.charge(job, sale)) || applied.posted === true;
      if (!posted && sale) await this.kernel.recordOp(tx, task.posId, actor.operatorId, task.action, sale);
      await tx.officeTask.update({
        where: { id },
        data: {
          resultNote: note || null,
          ...(handed.iccid ? { iccid: handed.iccid } : {}),
          ...(handed.msisdn ? { msisdn: handed.msisdn } : {}),
          ...(applied.amount !== undefined ? { posDelta: applied.amount } : {}),
        },
      });
      return this.tasks.taskNotice(tx, 'done', task, actor, {
        packageName: sale?.packageName ?? '',
        amount: applied.amount ?? task.posDelta,
        handlerName: actor.nickname,
      });
    });
    await this.kernel.publishQuietly(written);
    return { ok: true };
  }

  /** Checks what the branch attached to the completion: the new number of a rename, the serial and QR of an eSIM. */
  private async handedBack(task: OfficeTask, body: { iccid?: unknown; qr?: unknown; msisdn?: unknown }) {
    const givenIccid = typeof body.iccid === 'string' ? body.iccid.trim() : '';
    const givenQr = readQr(body.qr) ?? null;
    const givenMsisdn = typeof body.msisdn === 'string' ? body.msisdn.trim() : '';
    const handed: { iccid?: string; msisdn?: string } = {};
    if (task.action === 'esim' && (!givenIccid || !givenQr)) fail(400, 'INVALID');
    if (task.action === 'rename') {
      if (!MSISDN.test(givenMsisdn)) fail(400, 'INVALID');
      const taken = await this.kernel.prisma.line.findUnique({ where: { msisdn: givenMsisdn } });
      if (taken && taken.id !== task.lineId) fail(409, 'NUMBER_TAKEN');
      handed.msisdn = givenMsisdn;
    }
    if (givenIccid && (task.action === 'esim' || (task.esim && (task.action === 'activate' || task.action === 'sim')))) {
      const taskPkg = await this.kernel.prisma.package.findUnique({ where: { id: task.packageId }, include: { company: true } });
      const refusal = simRefusal(simRulesOf(taskPkg?.company ?? null), givenIccid);
      if (refusal) fail(400, refusal);
      handed.iccid = givenIccid;
    }
    const handedQr = task.action === 'esim' || task.esim ? givenQr ?? task.esimQr : null;
    return { handed, handedQr };
  }

  /** The debit the task carried since it opened. A disconnect and a switch post their own amount. */
  private async charge({ tx, task, actor, note }: Completion, sale: Sale | undefined): Promise<boolean> {
    if (task.action === 'disconnect' || task.action === 'switch' || task.posDelta === 0) return false;
    // An add-on's wallet entry carries its name when the handler wrote no note.
    await this.kernel.move(tx, task.posId, task.posDelta, actor.operatorId, task.action, task.action === 'addon' ? note || task.note || '' : note, sale);
    return true;
  }

  /** The sale of an operation that sells nothing new: the line as it stands after the handler ran. */
  private async plainSale({ tx, task }: Completion): Promise<Sale | undefined> {
    if (!task.lineId) return undefined;
    const current = await tx.line.findUnique({ where: { id: task.lineId }, include: { package: { include: { company: true } } } });
    if (!current) return undefined;
    // An eSIM request's debit is the eSIM fee, and that fee is what the provider charges for it.
    return task.action === 'esim' ? { ...saleOf(current), providerCost: -task.posDelta, esimPrice: -task.posDelta } : saleOf(current);
  }

  private async activate({ tx, task, handed, handedQr }: Completion): Promise<Applied> {
    const pkg = await tx.package.findUnique({
      where: { id: task.packageId },
      include: { company: true, provider: true, renewals: { include: { target: { include: { company: true, provider: true } } } } },
    });
    if (!pkg) fail(404, 'NOT_FOUND');
    if (!pkg.company || !pkg.provider) fail(400, 'INVALID');
    if (pkg.renewals.some((renewal) => !renewal.target.company || !renewal.target.provider)) fail(400, 'INVALID');
    const pkgTerms = packageTermsOf(pkg);
    const terms = await this.pricing.stampFor(captureTerms(pkgTerms, pkg.renewals.map((renewal) => packageTermsOf(renewal.target))), task.posId, undefined, tx);
    const iccid = task.esim ? handed.iccid ?? null : task.iccid;
    if (iccid) await assertSimFree(tx, iccid);
    const created = await tx.line.create({
      data: {
        msisdn: task.msisdn || (await this.pricing.freshMsisdn(tx)),
        iccid,
        esim: task.esim,
        esimQr: task.esim ? handedQr : null,
        status: 'active',
        packageId: task.packageId,
        posId: task.posId,
        terms: terms as unknown as Prisma.InputJsonValue,
        endsAt: periodEnd(new Date(), pkg.months),
      },
    });
    // The price the task was opened at is the price charged, so it is the price recorded (rule 1.5). Tasks opened
    // before the price was stored fall back to today's.
    const packagePrice = task.unitPrice ?? (await this.pricing.resolveBuyPrice(task.posId, pkg, 'subscription', undefined, tx));
    return {
      sale: {
        msisdn: created.msisdn,
        lineId: created.id,
        companyName: pkg.company?.name ?? '',
        packageName: pkg.name,
        packagePrice,
        providerCost: activationProviderCost(pkgTerms.subscription.branchCost, task.esim, esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).price),
        // The fee folded into the task's debit when it was opened: what the row's amount holds beyond the package price.
        ...(task.esim ? { esimPrice: Math.max(0, -task.posDelta - packagePrice) } : {}),
        period: periodOf(pkg.months, created.endsAt),
      },
    };
  }

  private async disconnect({ tx, task, actor, note, line }: Completion): Promise<Applied> {
    if (!line) return {};
    const settled = await this.pricing.disconnectSettlementFor(tx, line, new Date());
    await moveLineStatus(tx, line.id, ['active'], 'disconnected');
    if (!settled) return {};
    await this.kernel.move(tx, task.posId, settled.amount, actor.operatorId, 'disconnect', note, {
      msisdn: line.msisdn,
      lineId: line.id,
      companyName: line.package.company?.name ?? '',
      packageName: line.package.name,
      packagePrice: settled.posPrice,
      providerCost: settled.providerCost,
    });
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
      ? await tx.package.findUnique({ where: { id: task.nextPackageId }, include: { company: true, provider: true } })
      : null;
    if (extending && task.nextPackageId && (!target || !target.company || !target.provider)) fail(400, 'INVALID');
    const lineTerms = lineTermsOf(line.terms, line.package);
    const renewal = extending ? (target ? renewOnto(lineTerms, packageTermsOf(target), base) : renewStay(lineTerms, base)) : null;
    if (renewal && 'error' in renewal) fail(400, 'INVALID');
    const terms = renewal ? renewal.terms : { ...lineTerms, windowMonths: line.package.months };
    const endsAt = renewal?.endsAt ?? periodEnd(base, line.package.months);
    const data = { endsAt, terms: terms as unknown as Prisma.InputJsonValue, ...(target ? { packageId: target.id } : {}) };
    if (extending) await tx.line.update({ where: { id: line.id }, data });
    else await moveLineStatus(tx, line.id, ['disconnected'], 'active', data);
    return {
      sale: {
        ...saleOf(line, target ?? undefined, -task.posDelta),
        // What the provider charges for this period, kept on the entry (rule 1.6).
        providerCost: providerBranchCost(task.action, terms, target ?? line.package),
        period: periodOf(windowMonthsOf(terms), endsAt),
      },
    };
  }

  private async switch({ tx, task, actor, note, line }: Completion): Promise<Applied> {
    if (!line || !task.nextPackageId) return {};
    const [source, target] = await Promise.all([
      tx.package.findUnique({ where: { id: task.packageId }, include: { company: true, provider: true, switches: { include: { target: { select: { code: true } } } } } }),
      tx.package.findUnique({ where: { id: task.nextPackageId }, include: { company: true, provider: true } }),
    ]);
    const whole = (pkg: { company: unknown; provider: unknown } | null) => Boolean(pkg && pkg.company && pkg.provider);
    if (!whole(line.package) || !source || !whole(source) || !target || !whole(target)) fail(400, 'INVALID');
    const switched = switchOnto(lineTermsOf(line.terms, line.package), packageTermsOf(source), packageTermsOf(target), source.switches.map((item) => item.target.code));
    if ('error' in switched) fail(400, 'INVALID');
    const quote = await this.pricing.switchQuote(tx, line, target, new Date());
    const amount = -quote.difference;
    const sale: Sale = {
      msisdn: line.msisdn,
      lineId: line.id,
      companyName: target.company?.name ?? '',
      packageName: target.name,
      packagePrice: quote.newPrice,
      providerCost: quote.providerCost,
      period: periodOf(target.months, null),
    };
    if (amount !== 0) await this.kernel.move(tx, task.posId, amount, actor.operatorId, 'switch', note, sale);
    else await this.kernel.recordOp(tx, task.posId, actor.operatorId, 'switch', sale);
    // Same as an immediate switch: the line carries the renewal price its point of sale pays today.
    const stamped = await this.pricing.stampFor(switched.terms, line.posId, undefined, tx);
    await tx.line.update({ where: { id: line.id }, data: { terms: stamped as unknown as Prisma.InputJsonValue, packageId: target.id, opsLocked: false } });
    return { sale, posted: true, amount };
  }

  private async rename({ tx, line, handed }: Completion): Promise<Applied> {
    if (line && handed.msisdn) await tx.line.update({ where: { id: line.id }, data: { msisdn: handed.msisdn } });
    return {};
  }

  private async swapSim({ tx, task, line, handedQr }: Completion): Promise<Applied> {
    if (!line || !task.iccid) return {};
    await assertSimFree(tx, task.iccid, line.id);
    await tx.line.update({ where: { id: line.id }, data: { iccid: task.iccid, esim: task.esim, esimQr: task.esim ? handedQr : null } });
    return {};
  }

  private async issueEsim({ tx, line, handed, handedQr }: Completion): Promise<Applied> {
    if (!line || !handed.iccid) return {};
    await assertSimFree(tx, handed.iccid, line.id);
    await tx.line.update({ where: { id: line.id }, data: { iccid: handed.iccid, esim: true, esimQr: handedQr } });
    return {};
  }
}
