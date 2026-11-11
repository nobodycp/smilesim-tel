import { assertCanSealEsimCode, storableEsimCode } from './esim-code';
import { LinesRepository } from './lines.repository';
import { LineAccess } from './line-access';
import { PriceLadder } from '../terms/price-ladder';
import { WalletLedger } from '../wallets/wallet-ledger';
import { AccountTree } from '../kernel/account-tree';
import { UnitOfWork } from '../kernel/unit-of-work';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/office-failure';
import { lineTermsOf } from '../kernel/line-terms';
import { saleOf } from '../kernel/sale';
import type { Action, Actor } from '../kernel/types';
import { renderEsimQr } from './office-esim';
import { periodEnd, renewOnto, renewStay, switchOnto, windowMonthsOf } from '../rules/periods';
import { activationProviderCost, captureTerms, esimPriceOf, providerBranchCost } from '../rules/prices';
import { activateInputs, refreshMode } from '../rules/run-modes';
import { issueSerial, simRefusal, simRulesOf } from '../rules/sim-rules';
import { packageTermsOf } from '../rules/office-terms';
import { NOT_CONNECTED, PROVIDER_GATEWAY, type ProviderGateway } from '../providers/gateway/provider-gateway';
import { BRANCH_TASK_NOTE, PROVIDER_FAILED_NOTE } from '../stored-text';
import { TasksService } from '../tasks/tasks.service';
import { deniedOpsFor, visibleTo } from '../rules/user-terms';
import { periodOf, readQr } from './line-input';
import { assertRunnable, canActivateFor, runsNow, type RunnablePackage } from './line-ops';
import { LinePricing } from './line-pricing';
import { ActivateBody, AddonBody, ExtendBody, OutcomeBody, RenameLineBody, SwapSimBody, SwitchPackageBody } from './lines.schemas';
import { assertClaimFree, assertSimFree, lockUnchanged, moveLineStatus, numberTaken } from './line-state';
import { TaskCompletion } from './task-completion';

type VisibleLine = Awaited<ReturnType<LineAccess['visibleLine']>>;
type OpenTask = Parameters<TasksService['openTask']>[0];
/** How an operation goes: applied at the provider now, or left to the branch as a task with this note. */
type Route = { now: true } | { now: false; note: string };
type RoutedPackage = RunnablePackage & { code: string; providerProductCode?: string | null; provider: { code: string } | null };


/**
 * Operations on numbers: activation and everything done to a live number (charge, freeze, disconnect, switch,
 * extend, reactivate, refresh, rename, SIM swap, eSIM request, add-on). Each one either runs now at the provider
 * and is written in one transaction on the locked line, or opens a branch task that applies it later
 * (task-completion.ts).
 */
@Injectable()
export class LinesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tree: AccountTree,
    private readonly ledger: WalletLedger,
    private readonly ladder: PriceLadder,
    private readonly lineAccess: LineAccess,
    private readonly tasks: TasksService,
    private readonly pricing: LinePricing,
    private readonly completion: TaskCompletion,
    @Inject(PROVIDER_GATEWAY) private readonly gateway: ProviderGateway,
    private readonly repo: LinesRepository,
  ) {}

  /**
   * Decides how an operation goes. A package that runs it by hand never reaches the provider; one that runs it
   * automatically asks the gateway, and a refusal becomes a branch task marked as a provider failure. A gateway
   * that reaches no provider is not a failure: the task is a plain branch task. The request's hint counts only
   * while the gateway simulates, never in production.
   */
  private async route(action: Action, pkg: RoutedPackage, automatic: boolean, hint: unknown, target: { msisdn: string | null; iccid?: string | null }): Promise<Route> {
    if (!automatic) return { now: false, note: this.gateway.simulated && hint === 'fail' ? PROVIDER_FAILED_NOTE : BRANCH_TASK_NOTE };
    const answer = await this.gateway.run({ action, providerCode: pkg.provider?.code ?? '', packageCode: pkg.providerProductCode ?? pkg.code, hint, msisdn: target.msisdn, iccid: target.iccid });
    if (answer.ok) return { now: true };
    return { now: false, note: answer.reason === NOT_CONNECTED ? BRANCH_TASK_NOTE : PROVIDER_FAILED_NOTE };
  }

  private async defer(actor: Actor, line: VisibleLine, task: Omit<OpenTask, 'actor' | 'posId' | 'packageId' | 'lineId'>) {
    const opened = await this.tasks.openTask({ actor, posId: line.posId, packageId: line.packageId, lineId: line.id, ...task });
    return { applied: false as const, taskId: opened.id };
  }

  async activate(actor: Actor, body: unknown) {
    const input = parseInput(ActivateBody, body);
    this.gateway.accept(input.outcome);
    const { esim, iccid, packageCode, posLoginName, msisdn: requested, currentDetails } = input;
    const accounts = await this.tree.accounts();
    const pos = accounts.find((account) => account.loginName === posLoginName && account.layer === 'pos');
    if (!pos || !canActivateFor(actor, pos, accounts)) fail(403, 'FORBIDDEN');
    const posPath = this.tree.pathOf(pos.id, accounts);
    const pkg = await this.sellablePackage(packageCode);
    // Visibility first, then the user's stop, then the package mode.
    if (!visibleTo(posPath, (await this.ladder.termsFor(pkg.id)).terms, pkg)) fail(400, 'PACKAGE_HIDDEN');
    assertRunnable(pkg, 'activate', deniedOpsFor(posPath));
    const inputs = activateInputs(pkg.provider.code);
    const sim = this.checkedSim(pkg, inputs, { esim, iccid, requested, currentDetails });
    const unit = await this.pricing.resolveBuyPrice(pos.id, pkg, 'subscription', posPath);
    const esimFee = esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).price;
    const posDelta = -(unit + (esim ? esimFee : 0));
    const msisdn = inputs === 'number-and-sim' ? requested : requested || (await this.pricing.freshMsisdn());
    if (requested && (await this.repo.lineByMsisdn(msisdn))) fail(409, 'NUMBER_TAKEN');
    // A generated eSIM has no serial yet: the provider (or the branch, through a task) issues it.
    // Providers that take the serial from the seller keep it; the line is still an eSIM and still pays the fee.
    const generatesEsim = inputs === 'generated' && esim;
    const storedIccid = generatesEsim ? null : iccid || null;
    // The eSIM's code exists only after the provider has answered, so the ability to seal it is checked first:
    // a sale is never sent to the provider when its code could not be stored (ADR 0019, D17; S.5b).
    if (generatesEsim) assertCanSealEsimCode();
    const route = await this.route('activate', pkg, runsNow(pkg, 'activate'), input.outcome, { msisdn, iccid: storedIccid });
    if (!route.now) {
      const task = await this.tasks.openTask({
        action: 'activate', actor, posId: pos.id, packageId: pkg.id, posDelta, msisdn, iccid: storedIccid, esim, unitPrice: unit,
        note: route.note === BRANCH_TASK_NOTE ? currentDetails || BRANCH_TASK_NOTE : route.note,
      });
      return { applied: false, taskId: task.id };
    }
    // Immediate activation: the provider hands the eSIM profile back now, so the line carries it from the start.
    const issuedIccid = generatesEsim ? issueSerial(sim) : storedIccid;
    const issuedQr = generatesEsim && issuedIccid ? await renderEsimQr(msisdn, issuedIccid) : null;
    // Sealed, and read back, before the transaction: a fault here refuses the sale before any money moves.
    const storedQr = storableEsimCode(issuedQr, 'a new line');
    const pkgTerms = packageTermsOf(pkg);
    // The line carries the renewal price its point of sale pays today, not the layer column.
    const terms = await this.pricing.stampFor(captureTerms(pkgTerms, pkg.renewals.map((renewal) => packageTermsOf(renewal.target))), pos.id, posPath);
    const created = await this.uow.runTx(async (tx) => {
      // The serial and the number, under their locks: not on a line, and not reserved by an open activation task.
      await assertClaimFree(tx, { iccid: issuedIccid, msisdn });
      const line = await this.repo
        .createLine(tx, { msisdn, iccid: issuedIccid, esim, esimQr: storedQr, status: 'active', packageId: pkg.id, posId: pos.id, terms: terms as unknown as Prisma.InputJsonValue, endsAt: periodEnd(new Date(), pkg.months) })
        .catch(numberTaken);
      await this.ledger.move(tx, pos.id, posDelta, actor.operatorId, 'activate', '', {
        msisdn,
        lineId: line.id,
        companyName: pkg.company.name,
        packageName: pkg.name,
        packagePrice: unit,
        providerCost: activationProviderCost(pkgTerms.subscription.branchCost, esim, esimFee),
        ...(esim ? { esimPrice: esimFee } : {}),
        period: periodOf(pkg.months, line.endsAt),
      });
      return line;
    });
    // The money is taken and the line exists: nothing after this point may fail, or the caller would see an error
    // for a sale that happened and might send it again. So the code answered is the one issued above, in memory,
    // never the stored value read back (which may be sealed and may not open). ADR 0019, D17.
    return {
      applied: true,
      debited: posDelta < 0,
      line: { id: created.id, msisdn: created.msisdn, iccid: created.iccid, esim: created.esim, esimQr: issuedQr },
    };
  }

  /** A package that can be sold: it exists, and it and every renewal target have a company and a provider. */
  private async sellablePackage(code: string) {
    const pkg = await this.repo.packageWithRenewals(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    const { company, provider } = pkg;
    if (!company || !provider) fail(400, 'INVALID');
    if (pkg.renewals.some((renewal) => !renewal.target.company || !renewal.target.provider)) fail(400, 'INVALID');
    return { ...pkg, company, provider };
  }

  /** What the provider needs for an activation is there, and the SIM fits the company and the package. */
  private checkedSim(
    pkg: Awaited<ReturnType<LinesService['sellablePackage']>>,
    inputs: ReturnType<typeof activateInputs>,
    given: { esim: boolean; iccid: string; requested: string; currentDetails: string },
  ) {
    const { esim, iccid, requested, currentDetails } = given;
    if (inputs === 'generated' && !esim && !iccid) fail(400, 'INVALID');
    if (inputs === 'current-details' && (!currentDetails || iccid.length < 8)) fail(400, 'INVALID');
    if (inputs === 'number-and-sim' && (!requested || iccid.length < 8)) fail(400, 'INVALID');
    const sim = simRulesOf(pkg.company, pkg);
    // The company refusing eSIM keeps its own answer; a package switched off says so (spec 2026-11-09, 5).
    if (esim && !simRulesOf(pkg.company).esim) fail(400, 'ESIM_UNSUPPORTED');
    if (esim && !sim.esim) fail(400, 'ESIM_PACKAGE_OFF');
    if (!(inputs === 'generated' && esim)) {
      const refusal = simRefusal(sim, iccid);
      if (refusal) fail(400, refusal);
    }
    return sim;
  }

  async operate(actor: Actor, lineId: string, action: 'charge' | 'disconnect' | 'freeze' | 'unfreeze', body: unknown) {
    const input = parseInput(OutcomeBody, body);
    this.gateway.accept(input.outcome);
    const line = await this.lineAccess.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (action === 'charge') return this.restartDisconnected(actor, line, input.outcome);
    assertRunnable(line.package, action, line.denied);
    if (line.status === 'disconnected') fail(400, 'INVALID');
    if ((action === 'disconnect' || action === 'freeze') && line.status !== 'active') fail(400, 'INVALID');
    if (action === 'unfreeze' && line.status !== 'frozen') fail(400, 'INVALID');
    const route = await this.route(action, line.package, runsNow(line.package, action), input.outcome, line);
    if (!route.now) return this.defer(actor, line, { action, posDelta: 0, msisdn: line.msisdn, note: route.note });
    if (action === 'disconnect') return this.disconnectNow(actor, line);
    await this.uow.runTx(async (tx) => {
      await lockUnchanged(tx, line);
      if (action === 'freeze') await moveLineStatus(tx, line.id, ['active'], 'frozen');
      else await moveLineStatus(tx, line.id, ['frozen'], 'active');
      await this.ledger.recordOp(tx, line.posId, actor.operatorId, action, saleOf(line));
    });
    return { applied: true, debited: false };
  }

  private async disconnectNow(actor: Actor, line: VisibleLine) {
    await this.uow.runTx(async (tx) => {
      await lockUnchanged(tx, line);
      const settled = await this.pricing.disconnectSettlementFor(tx, line, new Date());
      const sale = {
        msisdn: line.msisdn,
        lineId: line.id,
        companyName: line.package.company?.name ?? '',
        packageName: line.package.name,
        packagePrice: settled?.posPrice ?? line.package.posPrice,
        providerCost: settled?.providerCost,
      };
      await moveLineStatus(tx, line.id, ['active'], 'disconnected');
      if (settled) await this.ledger.move(tx, line.posId, settled.amount, actor.operatorId, 'disconnect', '', sale);
      else await this.ledger.recordOp(tx, line.posId, actor.operatorId, 'disconnect', sale);
    });
    return { applied: true, debited: false };
  }

  /** The amount a disconnect would credit now, by the same rule as the disconnect itself. Moves nothing. */
  async disconnectQuote(actor: Actor, lineId: string) {
    const line = await this.lineAccess.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    assertRunnable(line.package, 'disconnect', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    const settled = await this.pricing.disconnectSettlementFor(this.uow.prisma, line, new Date());
    return { amount: settled?.amount ?? 0, runsNow: runsNow(line.package, 'disconnect') };
  }

  async switchPackage(actor: Actor, lineId: string, body: unknown) {
    const input = parseInput(SwitchPackageBody, body);
    this.gateway.accept(input.outcome);
    const { packageCode } = input;
    const line = await this.lineAccess.visibleLine(actor, lineId);
    if (!line.opsLocked && line.status !== 'active') fail(400, 'INVALID');
    assertRunnable(line.package, 'switch', line.denied);
    const [next, allowed] = await Promise.all([
      this.repo.packageByCode(packageCode),
      this.repo.switchesOf(line.packageId),
    ]);
    if (!next || !next.company || !next.provider) fail(400, 'INVALID');
    const switched = switchOnto(lineTermsOf(line.terms, line.package), packageTermsOf(line.package), packageTermsOf(next), allowed.map((item) => item.target.code));
    if ('error' in switched) fail(400, 'INVALID');
    if (!(await this.pricing.visibleFor(line.posId, next, line.posPath))) fail(400, 'PACKAGE_HIDDEN');
    assertRunnable(next, 'switch', line.denied);
    const route = await this.route('switch', line.package, runsNow(line.package, 'switch'), input.outcome, line);
    if (!route.now) {
      const quote = await this.pricing.switchQuote(this.uow.prisma, line, next, new Date());
      return this.defer(actor, line, { action: 'switch', nextPackageId: next.id, posDelta: -quote.difference, msisdn: line.msisdn, note: route.note });
    }
    let debited = false;
    // The line carries the renewal price its point of sale would pay for the new package today.
    const stamped = await this.pricing.stampFor(switched.terms, line.posId, line.posPath);
    await this.uow.runTx(async (tx) => {
      await lockUnchanged(tx, line);
      const quote = await this.pricing.switchQuote(tx, line, next, new Date());
      const posDelta = -quote.difference;
      debited = posDelta < 0;
      const sale = { ...saleOf(line, next, quote.newPrice), providerCost: quote.providerCost, period: periodOf(next.months, null) };
      if (posDelta !== 0) await this.ledger.move(tx, line.posId, posDelta, actor.operatorId, 'switch', '', sale);
      else await this.ledger.recordOp(tx, line.posId, actor.operatorId, 'switch', sale);
      await this.repo.switchLine(tx, line.id, stamped as unknown as Prisma.InputJsonValue, next.id);
    });
    return { applied: true, debited };
  }

  async extend(actor: Actor, lineId: string, body: unknown) {
    const input = parseInput(ExtendBody, body);
    this.gateway.accept(input.outcome);
    const { targetCode } = input;
    const line = await this.lineAccess.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active' || line.endsAt.getTime() <= Date.now()) fail(400, 'INVALID');
    assertRunnable(line.package, 'extend', line.denied);
    const terms = lineTermsOf(line.terms, line.package);
    const base = line.endsAt > new Date() ? line.endsAt : new Date();
    const target = targetCode
      ? await this.repo.packageByCode(targetCode)
      : null;
    if (targetCode && (!target || !target.company || !target.provider)) fail(400, 'INVALID');
    const renewal = target ? renewOnto(terms, packageTermsOf(target), base) : renewStay(terms, base);
    if ('error' in renewal) fail(400, 'INVALID');
    // A number pays the renewal price its own terms carry, stay or target entry; no account row is read.
    const posDelta = -renewal.debit;
    const route = await this.route('extend', line.package, runsNow(line.package, 'extend'), input.outcome, line);
    if (!route.now) return this.defer(actor, line, { action: 'extend', nextPackageId: target?.id, posDelta, msisdn: line.msisdn, note: route.note });
    await this.uow.runTx(async (tx) => {
      await lockUnchanged(tx, line);
      await this.ledger.move(tx, line.posId, posDelta, actor.operatorId, 'extend', '', {
        ...saleOf(line, target ?? undefined, -posDelta),
        // What the provider charges for this period, kept on the entry (rule 1.6).
        providerCost: providerBranchCost('extend', renewal.terms, target ?? line.package),
        period: periodOf(windowMonthsOf(renewal.terms), renewal.endsAt),
      });
      await this.repo.extendLine(tx, line.id, { endsAt: renewal.endsAt, terms: renewal.terms as unknown as Prisma.InputJsonValue, ...(target ? { packageId: target.id } : {}) });
    });
    return { applied: true, debited: posDelta < 0 };
  }

  async reactivate(actor: Actor, lineId: string, body: unknown) {
    const input = parseInput(OutcomeBody, body);
    this.gateway.accept(input.outcome);
    const line = await this.lineAccess.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    return this.restartDisconnected(actor, line, input.outcome);
  }

  async refresh(actor: Actor, lineId: string, body: unknown) {
    const input = parseInput(OutcomeBody, body);
    this.gateway.accept(input.outcome);
    const line = await this.lineAccess.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active') fail(400, 'INVALID');
    const mode = refreshMode(line.package.actionModes);
    if (mode === 'off') fail(400, 'OPERATION_DISABLED');
    const route = await this.route('refresh', line.package, mode === 'auto', input.outcome, line);
    if (!route.now) return this.defer(actor, line, { action: 'refresh', posDelta: 0, msisdn: line.msisdn, note: route.note });
    await this.uow.runTx(async (tx) => {
      await this.ledger.recordOp(tx, line.posId, actor.operatorId, 'refresh', saleOf(line));
    });
    return { applied: true, debited: false };
  }

  /** The new number may be unknown until the branch has it: a task takes it at completion. */
  async rename(actor: Actor, lineId: string, body: unknown) {
    const input = parseInput(RenameLineBody, body);
    this.gateway.accept(input.outcome);
    const { msisdn } = input;
    const line = await this.lineAccess.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    assertRunnable(line.package, 'rename', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    if (msisdn === line.msisdn) fail(400, 'INVALID');
    if (msisdn && (await this.repo.lineByMsisdn(msisdn))) fail(409, 'NUMBER_TAKEN');
    const route = await this.route('rename', line.package, runsNow(line.package, 'rename'), input.outcome, { msisdn: msisdn || null });
    if (!route.now) return this.defer(actor, line, { action: 'rename', posDelta: 0, msisdn: msisdn || null, note: route.note });
    if (!msisdn) fail(400, 'INVALID');
    await this.uow.runTx(async (tx) => {
      await lockUnchanged(tx, line);
      // The new number may be one an open activation task has reserved.
      await assertClaimFree(tx, { msisdn }, { exceptLineId: line.id });
      await this.repo.renameLine(tx, line.id, msisdn).catch(numberTaken);
      await this.ledger.recordOp(tx, line.posId, actor.operatorId, 'rename', saleOf({ ...line, msisdn }));
    });
    return { applied: true, debited: false };
  }

  /** A SIM the branch already holds, physical or eSIM. Free. A new eSIM is `requestEsim`. */
  async swapSim(actor: Actor, lineId: string, body: unknown) {
    const input = parseInput(SwapSimBody, body);
    this.gateway.accept(input.outcome);
    const { iccid, esim } = input;
    const qr = esim ? readQr(input.qr) ?? null : null;
    if (iccid.length < 8) fail(400, 'INVALID');
    const line = await this.lineAccess.visibleLine(actor, lineId);
    // Sealed before the provider is asked and before the task or the line is written (ADR 0019, D17; S.5b).
    const storedQr = storableEsimCode(qr, `line ${line.id}`);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    assertRunnable(line.package, 'sim', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    const rules = simRulesOf(line.package.company, line.package);
    if (esim && !rules.esim) fail(400, 'ESIM_UNSUPPORTED');
    const refusal = simRefusal(rules, iccid);
    if (refusal) fail(400, refusal);
    const route = await this.route('sim', line.package, runsNow(line.package, 'sim'), input.outcome, { msisdn: line.msisdn, iccid });
    if (!route.now) return this.defer(actor, line, { action: 'sim', posDelta: 0, msisdn: line.msisdn, iccid, esim, esimQr: storedQr, note: route.note });
    await this.uow.runTx(async (tx) => {
      await lockUnchanged(tx, line);
      await assertSimFree(tx, iccid, line.id);
      await this.repo.setLineSim(tx, line.id, { iccid, esim, esimQr: storedQr });
      await this.ledger.recordOp(tx, line.posId, actor.operatorId, 'sim', saleOf(line));
    });
    return { applied: true, debited: false };
  }

  /**
   * An extra operation of the line's package (spec 2026-11-09, 3): always a manual branch task that holds the
   * add-on's price, charged when the task is done and released if it is closed.
   */
  async requestAddon(actor: Actor, lineId: string, body: unknown) {
    const line = await this.lineAccess.visibleLine(actor, lineId);
    const { addonId } = parseInput(AddonBody, body);
    const addon = await this.repo.addon(addonId);
    if (!addon || addon.packageId !== line.packageId || !addon.active) fail(400, 'INVALID');
    if (line.status === 'disconnected') fail(400, 'INVALID');
    return this.defer(actor, line, { action: 'addon', posDelta: -addon.price, msisdn: line.msisdn, iccid: null, note: addon.name });
  }

  /** The customer wants an eSIM issued (lost SIM, or plastic to eSIM). Always a branch task; the employee attaches the serial and the QR. */
  async requestEsim(actor: Actor, lineId: string) {
    const line = await this.lineAccess.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active') fail(400, 'INVALID');
    if (line.denied.has('esim')) fail(403, 'OPERATION_DENIED');
    if (!simRulesOf(line.package.company).esim) fail(400, 'ESIM_UNSUPPORTED');
    if (!simRulesOf(line.package.company, line.package).esim) fail(400, 'ESIM_PACKAGE_OFF');
    const { price } = esimPriceOf({ pkg: line.package, provider: line.package.provider, company: line.package.company });
    return this.defer(actor, line, { action: 'esim', posDelta: -price, msisdn: line.msisdn, iccid: null, esim: true, note: BRANCH_TASK_NOTE });
  }

  /** Closing a branch task applies the operation it deferred (task-completion.ts). */
  completeTask(actor: Actor, id: string, body: unknown) {
    return this.completion.complete(actor, id, body);
  }

  /** A disconnected number starts again at today's subscription price, for a new period. */
  private async restartDisconnected(actor: Actor, line: VisibleLine, hint: unknown) {
    if (line.status !== 'disconnected') fail(400, 'INVALID');
    assertRunnable(line.package, 'charge', line.denied);
    const charged = await this.pricing.resolveBuyPrice(line.posId, line.package, 'subscription', line.posPath);
    const posDelta = -charged;
    const route = await this.route('charge', line.package, runsNow(line.package, 'charge'), hint, line);
    if (!route.now) return this.defer(actor, line, { action: 'charge', posDelta, msisdn: line.msisdn, note: route.note });
    await this.uow.runTx(async (tx) => {
      await lockUnchanged(tx, line);
      const endsAt = periodEnd(new Date(), line.package.months);
      await this.ledger.move(tx, line.posId, posDelta, actor.operatorId, 'charge', '', {
        ...saleOf(line, undefined, charged),
        providerCost: providerBranchCost('charge', lineTermsOf(line.terms, line.package), line.package),
        period: periodOf(line.package.months, endsAt),
      });
      await moveLineStatus(tx, line.id, ['disconnected'], 'active', {
        endsAt,
        terms: { ...lineTermsOf(line.terms, line.package), windowMonths: line.package.months } as unknown as Prisma.InputJsonValue,
      });
    });
    return { applied: true, debited: posDelta < 0 };
  }

  /** A carrier switch has no fields yet, so every request is refused. */
  companySwitch(): never {
    fail(400, 'INVALID');
  }
}
