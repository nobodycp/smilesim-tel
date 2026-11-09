import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { assertBranch, OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { TasksService } from '../tasks/tasks.service';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { lineTermsOf } from '../kernel/line-terms';
import { saleOf } from '../kernel/sale';
import type { Action, Sale } from '../kernel/types';
import { renderEsimQr } from '../office-esim';
import { PROVIDER_FAILED_NOTE } from '../providers/provider-health';
import { LINES_PAGE, NEWEST_FIRST, idCursorArgs, isSuspended, linesWhere, pageOf, type LineFilter } from '../office-paging';
import { activateInputs, activationProviderCost, captureTerms, esimPriceOf, issueSerial, lastWindow, offeredOperations, openPeriods, periodEnd, refreshMode, renewOnto, renewStay, resolvePackageMode, revalue, settleDisconnect, simRefusal, simRulesOf, switchOnto, switchOver, visibleAccountIds, windowMonthsOf, type ActionKey, type LineTerms } from '../office-rules';
import { packageTermsOf, type PackagePriceRow } from '../office-terms';
import { canHandleTasks } from '../task-access';
import { buyPriceFor, deniedOpsFor, visibleTo, type LayerPrices, type OpKey, type PathNode, type PriceKind } from '../user-terms';
import { OfficeFailure } from '../../shared/office-failure';
import type { Account } from '../kernel/types';
import { PERIOD_DAYS } from '../office-rules';
import { isOpKey } from '../user-terms';

export const PREPAID_KINDS = ['activate', 'charge', 'extend', 'reactivate', 'switch'];
/** Entries that put time on a line: the newest one is the last recharge shown on the card. */
export const RECHARGE_KINDS = ['activate', 'charge', 'extend', 'reactivate'];
export function periodOf(months: number, endsAt: Date | null) {
  return { days: PERIOD_DAYS * Math.max(1, months), endsAt };
}

/** A QR picture as a data URL. `undefined` when absent, `null` when cleared, otherwise the checked URL. */
export function readQr(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > QR_LIMIT || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) fail(400, 'QR_INVALID');
  return value;
}

export function asOutcome(value: unknown): 'success' | 'fail' | null {
  if (value === 'success' || value === 'fail') return value;
  return null;
}

/** The stop key an operation answers to. `unfreeze` follows `freeze`; a restart is a `charge`. */
export function opKeyOf(action: string): OpKey | null {
  if (action === 'unfreeze') return 'freeze';
  if (action === 'reactivate') return 'charge';
  return isOpKey(action) ? action : null;
}

export function canActivateFor(actor: Actor, pos: Account, accounts: Account[]): boolean {
  if (!visibleAccountIds(actor.id, actor.layer, accounts).has(pos.id)) return false;
  if (actor.layer === 'pos') return actor.id === pos.id;
  return true;
}
/** The largest QR data URL stored on a line. The client shrinks to about 300 KB first. */
export const QR_LIMIT = 400_000;

/** Numbers (lines): the paged list and one number's card, activation, every operation on a live number (charge, freeze, disconnect, switch, extend, reactivate, refresh, rename, SIM swap, eSIM request), and closing the branch task that applies a deferred operation. */
@Injectable()
export class LinesService {
  constructor(private readonly kernel: OfficeKernel, private readonly tasks: TasksService) {}

  /** The suspension periods the packages use, so the suspended filter has one cut-off per period. */
  async suspendPeriods(): Promise<number[]> {
    const rows = await this.kernel.prisma.package.findMany({ distinct: ['suspendAfterDays'], select: { suspendAfterDays: true } });
    return rows.map((row) => row.suspendAfterDays);
  }

  async list(actor: Actor, query: LineFilter & { cursor?: string; account?: string } = {}) {
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    // `account` narrows to one account's numbers: its own if it is a point of sale, else every point of sale below
    // it (the user page's «الأرقام»). An account outside the viewer's tree gives nothing.
    const target = query.account ? accounts.find((account) => account.loginName === query.account) : undefined;
    const within = query.account ? (target && visible.has(target.id) ? visibleAccountIds(target.id, target.layer === 'branch' ? 'none' : target.layer, accounts) : new Set<string>()) : visible;
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id) && within.has(account.id)).map((account) => account.id);
    const periods = query.status === 'suspended' ? await this.suspendPeriods() : [];
    const where = linesWhere(posIds, query, periods);
    const [rows, total] = await Promise.all([
      this.kernel.prisma.line.findMany({
        where,
        include: { package: { include: { company: true } }, pos: true },
        orderBy: [...NEWEST_FIRST],
        ...idCursorArgs(query.cursor || undefined, LINES_PAGE),
      }),
      this.kernel.prisma.line.count({ where }),
    ]);
    const { page, nextCursor } = pageOf(rows, LINES_PAGE);
    return {
      total,
      lines: page.map((row) => ({
        id: row.id,
        msisdn: row.msisdn,
        iccid: row.iccid,
        esim: row.esim,
        esimQr: row.esimQr,
        status: row.status,
        /** The subscription ended at least the package's period ago (spec 2026-11-08-overview-and-reports-nav, I). */
        suspended: isSuspended(row, row.package.suspendAfterDays),
        packageCode: row.package.code,
        packageName: row.package.name,
        companyName: row.package.company?.name ?? '',
        posLogin: row.pos.loginName,
        posPrice: row.package.posPrice,
        createdAt: row.createdAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        operations: this.operationsFor({ ...row, denied: deniedOpsFor(this.kernel.pathOf(row.posId, accounts)) }),
      })),
      nextCursor,
      poses: accounts
        .filter((account) => account.layer === 'pos' && visible.has(account.id) && canActivateFor(actor, account, accounts))
        .map((account) => ({ loginName: account.loginName, nickname: account.nickname })),
    };
  }

  async detail(actor: Actor, id: string) {
    const line = await this.kernel.prisma.line.findUnique({
      where: { id },
      include: { package: { include: { company: true, provider: true } }, pos: true },
    });
    if (!line) fail(404, 'NOT_FOUND');
    const accounts = await this.kernel.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(line.posId)) fail(403, 'FORBIDDEN');
    const posPath = this.kernel.pathOf(line.posId, accounts);
    const denied = deniedOpsFor(posPath);
    const [tasks, entries] = await Promise.all([
      this.kernel.prisma.officeTask.findMany({
        where: { lineId: line.id },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: {
          submitter: { select: { loginName: true, nickname: true } },
          assignee: { select: { loginName: true, nickname: true } },
        },
      }),
      this.kernel.prisma.walletEntry.findMany({
        where: { lineId: line.id },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { actor: { select: { loginName: true, nickname: true } } },
      }),
    ]);
    const packageIds = [...new Set(tasks.flatMap((task) => [task.packageId, task.nextPackageId].filter((id): id is string => !!id)))];
    const packages = packageIds.length
      ? await this.kernel.prisma.package.findMany({ where: { id: { in: packageIds } }, include: { company: true } })
      : [];
    const byPackage = new Map(packages.map((row) => [row.id, row]));
    const history = [
      ...entries.map((entry) => ({
        id: entry.id,
        action: entry.kind,
        at: entry.createdAt.toISOString(),
        msisdn: entry.msisdn ?? line.msisdn,
        companyName: entry.companyName ?? '',
        packageName: entry.packageName ?? '',
        actorName: entry.actor.nickname || entry.actor.loginName,
      })),
      ...tasks
        .filter((task) => {
          if (task.status !== 'done') return true;
          if (task.posDelta !== 0) return false;
          return !entries.some((entry) => entry.kind === task.action && Math.abs(entry.createdAt.getTime() - task.updatedAt.getTime()) < 5000);
        })
        .map((task) => {
          const pkg = byPackage.get(task.nextPackageId || task.packageId);
          const named = pkg?.company ? pkg : line.package;
          const who = task.status === 'done' && task.assignee ? task.assignee : task.submitter;
          return {
            id: task.id,
            action: task.action,
            at: task.createdAt.toISOString(),
            msisdn: task.msisdn ?? line.msisdn,
            companyName: named.company?.name ?? '',
            packageName: named.name,
            actorName: who.nickname || who.loginName,
          };
        }),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 40);
    const recharge = entries.find((entry) => RECHARGE_KINDS.includes(entry.kind))
      ?? (entries.length >= 40
        ? await this.kernel.prisma.walletEntry.findFirst({ where: { lineId: line.id, kind: { in: RECHARGE_KINDS } }, orderBy: { createdAt: 'desc' }, select: { kind: true, createdAt: true } })
        : null);
    return {
      line: {
        id: line.id,
        msisdn: line.msisdn,
        iccid: line.iccid,
        esim: line.esim,
        esimQr: line.esimQr,
        lastRechargeAt: recharge ? recharge.createdAt.toISOString() : null,
        esimPrice: esimPriceOf({ pkg: line.package, provider: line.package.provider, company: line.package.company }).price,
        status: line.status,
        packageCode: line.package.code,
        packageName: line.package.name,
        companyName: line.package.company?.name ?? '',
        posLogin: actor.layer === 'pos' ? '' : line.pos.loginName,
        posPrice: line.package.posPrice,
        dataGb: line.package.dataGb,
        subscriberPrice: line.package.subscriberPrice,
        companyImage: line.package.company?.image ?? '',
        sim: simRulesOf(line.package.company, line.package),
        switchTargets: await this.visibleSwitchTargets(line.packageId, posPath),
        opsLocked: line.opsLocked,
        createdAt: line.createdAt.toISOString(),
        endsAt: line.endsAt.toISOString(),
        operations: this.operationsFor({ ...line, denied }),
      },
      history,
    };
  }

  async activate(actor: Actor, body: Record<string, unknown>) {
    const outcome = asOutcome(body.outcome);
    const esim = body.esim === true;
    const iccid = typeof body.iccid === 'string' ? body.iccid.trim() : '';
    const packageCode = typeof body.packageCode === 'string' ? body.packageCode : '';
    const posLogin = typeof body.posLogin === 'string' ? body.posLogin : '';
    const requested = typeof body.msisdn === 'string' ? body.msisdn.trim() : '';
    const currentDetails = typeof body.currentDetails === 'string' ? body.currentDetails.trim() : '';
    if (!outcome || !packageCode || !posLogin) fail(400, 'INVALID');
    if (requested && !/^05\d{8}$/.test(requested)) fail(400, 'INVALID');
    const accounts = await this.kernel.accounts();
    const pos = accounts.find((account) => account.loginName === posLogin && account.layer === 'pos');
    if (!pos || !canActivateFor(actor, pos, accounts)) fail(403, 'FORBIDDEN');
    const posPath = this.kernel.pathOf(pos.id, accounts);
    const pkg = await this.kernel.prisma.package.findUnique({
      where: { code: packageCode },
      include: {
        company: true,
        provider: true,
        renewals: { include: { target: { include: { company: true, provider: true } } } },
      },
    });
    if (!pkg) fail(404, 'NOT_FOUND');
    if (!pkg.company || !pkg.provider) fail(400, 'INVALID');
    if (pkg.renewals.some((renewal) => !renewal.target.company || !renewal.target.provider)) fail(400, 'INVALID');
    // Visibility first, then the user's stop, then the package mode.
    if (!visibleTo(posPath, (await this.kernel.termsFor(pkg.id)).terms, pkg)) fail(400, 'PACKAGE_HIDDEN');
    this.assertRunnable(pkg, 'activate', deniedOpsFor(posPath));
    const inputs = activateInputs(pkg.provider.code);
    if (inputs === 'generated' && !esim && !iccid) fail(400, 'INVALID');
    if (inputs === 'current-details' && (!currentDetails || iccid.length < 8)) fail(400, 'INVALID');
    if (inputs === 'number-and-sim' && (!requested || iccid.length < 8)) fail(400, 'INVALID');
    const sim = simRulesOf(pkg.company, pkg);
    if (esim && !sim.esim) fail(400, 'ESIM_UNSUPPORTED');
    if (!(inputs === 'generated' && esim)) {
      const refusal = simRefusal(sim, iccid);
      if (refusal) fail(400, refusal);
    }
    const pkgTerms = packageTermsOf(pkg);
    const unit = await this.resolveBuyPrice(pos.id, pkg, 'subscription', posPath);
    const esimFee = esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).price;
    const posDelta = -(unit + (esim ? esimFee : 0));
    const msisdn = inputs === 'number-and-sim' ? requested : requested || (await this.freshMsisdn());
    if (requested) {
      const existing = await this.kernel.prisma.line.findUnique({ where: { msisdn } });
      if (existing) fail(400, 'NUMBER_TAKEN');
    }
    // A generated eSIM has no serial yet: the provider (or the branch, through a task) issues it.
    // Providers that take the serial from the seller keep it; the line is still an eSIM and still pays the fee.
    const generatesEsim = inputs === 'generated' && esim;
    const storedIccid = generatesEsim ? null : iccid || null;
    if (outcome === 'fail' || !this.runsNow(pkg, 'activate')) {
      const task = await this.tasks.openTask({
        action: 'activate', actor, posId: pos.id, packageId: pkg.id, posDelta, msisdn, iccid: storedIccid, esim,
        note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : currentDetails || 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    // Immediate activation: the provider hands the eSIM profile back now, so the line carries it from the start.
    const issuedIccid = generatesEsim ? issueSerial(sim) : storedIccid;
    const issuedQr = generatesEsim && issuedIccid ? await renderEsimQr(msisdn, issuedIccid) : null;
    // The line carries the renewal price its point of sale pays today, not the layer column.
    const terms = await this.stampFor(
      captureTerms(pkgTerms, pkg.renewals.map((renewal) => packageTermsOf(renewal.target))),
      pos.id,
      posPath,
    );
    const created = await this.kernel.runTx(async (tx) => {
      const created = await tx.line.create({
        data: {
          msisdn,
          iccid: issuedIccid,
          esim,
          esimQr: issuedQr,
          status: 'active',
          packageId: pkg.id,
          posId: pos.id,
          terms: terms as unknown as Prisma.InputJsonValue,
          endsAt: periodEnd(new Date(), pkg.months),
        },
      });
      await this.kernel.move(tx, pos.id, posDelta, actor.operatorId, 'activate', '', {
        msisdn,
        lineId: created.id,
        companyName: pkg.company?.name ?? '',
        packageName: pkg.name,
        packagePrice: unit,
        providerCost: activationProviderCost(pkgTerms.subscription.branchCost, esim, esimFee),
        ...(esim ? { esimPrice: esimFee } : {}),
        period: periodOf(pkg.months, created.endsAt),
      });
      return created;
    });
    return {
      applied: true,
      debited: posDelta < 0,
      line: { id: created.id, msisdn: created.msisdn, iccid: created.iccid, esim: created.esim, esimQr: created.esimQr },
    };
  }

  async operate(actor: Actor, lineId: string, action: Exclude<Action, 'activate' | 'switch' | 'reactivate' | 'refresh' | 'esim'>, body: { outcome?: unknown }) {
    const outcome = asOutcome(body.outcome);
    if (!outcome) fail(400, 'INVALID');
    const line = await this.kernel.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (action === 'charge') return this.restartDisconnected(actor, line, outcome);
    this.assertRunnable(line.package, action, line.denied);
    if (line.status === 'disconnected') fail(400, 'INVALID');
    if ((action === 'disconnect' || action === 'freeze') && line.status !== 'active') fail(400, 'INVALID');
    if (action === 'unfreeze' && line.status !== 'frozen') fail(400, 'INVALID');
    if (action === 'disconnect') {
      if (outcome === 'fail' || !this.runsNow(line.package, 'disconnect')) {
        const task = await this.tasks.openTask({
          action, actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: line.msisdn,
          note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : 'مهمة فرع',
        });
        return { applied: false, taskId: task.id };
      }
      await this.kernel.runTx(async (tx) => {
        const settled = await this.disconnectSettlementFor(tx, line, new Date());
        const sale = {
          msisdn: line.msisdn,
          lineId: line.id,
          companyName: line.package.company?.name ?? '',
          packageName: line.package.name,
          packagePrice: settled?.posPrice ?? line.package.posPrice,
          providerCost: settled?.providerCost,
        };
        if (settled) await this.kernel.move(tx, line.posId, settled.amount, actor.operatorId, 'disconnect', '', sale);
        else await this.kernel.recordOp(tx, line.posId, actor.operatorId, 'disconnect', sale);
        await tx.line.update({ where: { id: line.id }, data: { status: 'disconnected' } });
      });
      return { applied: true, debited: false };
    }
    const posDelta = 0;
    if (outcome === 'fail' || !this.runsNow(line.package, action)) {
      const task = await this.tasks.openTask({
        action, actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.kernel.runTx(async (tx) => {
      if (action === 'freeze') await tx.line.update({ where: { id: line.id }, data: { status: 'frozen' } });
      if (action === 'unfreeze') await tx.line.update({ where: { id: line.id }, data: { status: 'active' } });
      await this.kernel.recordOp(tx, line.posId, actor.operatorId, action, saleOf(line));
    });
    return { applied: true, debited: false };
  }

  /** The amount a disconnect would credit now, by the same rule as the disconnect itself. Moves nothing. */
  async disconnectQuote(actor: Actor, lineId: string) {
    const line = await this.kernel.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, 'disconnect', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    const settled = await this.disconnectSettlementFor(this.kernel.prisma, line, new Date());
    return { amount: settled?.amount ?? 0, runsNow: this.runsNow(line.package, 'disconnect') };
  }

  async switchPackage(actor: Actor, lineId: string, body: { packageCode?: unknown; outcome?: unknown }) {
    const outcome = asOutcome(body.outcome);
    const packageCode = typeof body.packageCode === 'string' ? body.packageCode : '';
    if (!outcome || !packageCode) fail(400, 'INVALID');
    const line = await this.kernel.visibleLine(actor, lineId);
    if (!line.opsLocked && line.status !== 'active') fail(400, 'INVALID');
    this.assertRunnable(line.package, 'switch', line.denied);
    const [next, allowed] = await Promise.all([
      this.kernel.prisma.package.findUnique({ where: { code: packageCode }, include: { company: true, provider: true } }),
      this.kernel.prisma.packageSwitch.findMany({
        where: { packageId: line.packageId },
        include: { target: { select: { code: true } } },
      }),
    ]);
    if (!next || !next.company || !next.provider) fail(400, 'INVALID');
    const switched = switchOnto(
      lineTermsOf(line.terms, line.package),
      packageTermsOf(line.package),
      packageTermsOf(next),
      allowed.map((item) => item.target.code),
    );
    if ('error' in switched) fail(400, 'INVALID');
    if (!(await this.visibleFor(line.posId, next, line.posPath))) fail(400, 'PACKAGE_HIDDEN');
    this.assertRunnable(next, 'switch', line.denied);
    if (outcome === 'fail' || !this.runsNow(line.package, 'switch')) {
      const quote = await this.switchQuote(this.kernel.prisma, line, next, new Date());
      const task = await this.tasks.openTask({
        action: 'switch', actor, posId: line.posId, packageId: line.packageId, nextPackageId: next.id, lineId: line.id,
        posDelta: -quote.difference, msisdn: line.msisdn, note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    let debited = false;
    // The line carries the renewal price its point of sale would pay for the new package today.
    const stamped = await this.stampFor(switched.terms, line.posId, line.posPath);
    await this.kernel.runTx(async (tx) => {
      const quote = await this.switchQuote(tx, line, next, new Date());
      const posDelta = -quote.difference;
      debited = posDelta < 0;
      const sale = { ...saleOf(line, next, quote.newPrice), providerCost: quote.providerCost, period: periodOf(next.months, null) };
      if (posDelta !== 0) await this.kernel.move(tx, line.posId, posDelta, actor.operatorId, 'switch', '', sale);
      else await this.kernel.recordOp(tx, line.posId, actor.operatorId, 'switch', sale);
      await tx.line.update({
        where: { id: line.id },
        data: {
          terms: stamped as unknown as Prisma.InputJsonValue,
          packageId: next.id,
          opsLocked: false,
        },
      });
    });
    return { applied: true, debited };
  }

  async extend(actor: Actor, lineId: string, body: { outcome?: unknown; targetCode?: unknown }) {
    const outcome = asOutcome(body.outcome);
    const targetCode = body.targetCode === undefined ? '' : typeof body.targetCode === 'string' ? body.targetCode : null;
    if (!outcome) fail(400, 'INVALID');
    if (targetCode === null) fail(400, 'INVALID');
    const line = await this.kernel.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active' || line.endsAt.getTime() <= Date.now()) fail(400, 'INVALID');
    this.assertRunnable(line.package, 'extend', line.denied);
    const terms = lineTermsOf(line.terms, line.package);
    const base = line.endsAt > new Date() ? line.endsAt : new Date();
    const target = targetCode
      ? await this.kernel.prisma.package.findUnique({ where: { code: targetCode }, include: { company: true, provider: true } })
      : null;
    if (targetCode && (!target || !target.company || !target.provider)) fail(400, 'INVALID');
    const renewal = target ? renewOnto(terms, packageTermsOf(target), base) : renewStay(terms, base);
    if ('error' in renewal) fail(400, 'INVALID');
    // A number pays the renewal price its own terms carry, stay or target entry; no account row is read.
    const posDelta = -renewal.debit;
    if (outcome === 'fail' || !this.runsNow(line.package, 'extend')) {
      const task = await this.tasks.openTask({
        action: 'extend', actor, posId: line.posId, packageId: line.packageId, nextPackageId: target?.id,
        lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.kernel.runTx(async (tx) => {
      await this.kernel.move(
        tx,
        line.posId,
        posDelta,
        actor.operatorId,
        'extend',
        '',
        { ...saleOf(line, target ?? undefined, -posDelta), period: periodOf(windowMonthsOf(renewal.terms), renewal.endsAt) },
      );
      await tx.line.update({
        where: { id: line.id },
        data: {
          endsAt: renewal.endsAt,
          terms: renewal.terms as unknown as Prisma.InputJsonValue,
          ...(target ? { packageId: target.id } : {}),
        },
      });
    });
    return { applied: true, debited: posDelta < 0 };
  }

  async reactivate(actor: Actor, lineId: string, body: { outcome?: unknown }) {
    const outcome = asOutcome(body.outcome);
    if (!outcome) fail(400, 'INVALID');
    const line = await this.kernel.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    return this.restartDisconnected(actor, line, outcome);
  }

  async refresh(actor: Actor, lineId: string, body: { outcome?: unknown }) {
    const outcome = asOutcome(body.outcome);
    if (!outcome) fail(400, 'INVALID');
    const line = await this.kernel.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active') fail(400, 'INVALID');
    const mode = refreshMode(line.package.actionModes);
    if (mode === 'off') fail(400, 'OPERATION_DISABLED');
    if (outcome === 'fail' || mode !== 'auto') {
      const task = await this.tasks.openTask({
        action: 'refresh', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: line.msisdn,
        note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.kernel.runTx(async (tx) => {
      await this.kernel.recordOp(tx, line.posId, actor.operatorId, 'refresh', saleOf(line));
    });
    return { applied: true, debited: false };
  }

  /** The new number may be unknown until the branch has it: a task takes it at completion. */
  async rename(actor: Actor, lineId: string, body: { msisdn?: unknown; outcome?: unknown }) {
    const outcome = asOutcome(body.outcome);
    const msisdn = typeof body.msisdn === 'string' ? body.msisdn.trim() : '';
    if (!outcome || (msisdn && !/^05\d{8}$/.test(msisdn))) fail(400, 'INVALID');
    const line = await this.kernel.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, 'rename', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    if (msisdn === line.msisdn) fail(400, 'INVALID');
    if (msisdn) {
      const taken = await this.kernel.prisma.line.findUnique({ where: { msisdn } });
      if (taken) fail(400, 'NUMBER_TAKEN');
    }
    if (outcome === 'success' && this.runsNow(line.package, 'rename')) {
      if (!msisdn) fail(400, 'INVALID');
      await this.kernel.runTx(async (tx) => {
        await tx.line.update({ where: { id: line.id }, data: { msisdn } });
        await this.kernel.recordOp(tx, line.posId, actor.operatorId, 'rename', saleOf({ ...line, msisdn }));
      });
      return { applied: true, debited: false };
    }
    const task = await this.tasks.openTask({
      action: 'rename', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: msisdn || null,
      note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : 'مهمة فرع',
    });
    return { applied: false, taskId: task.id };
  }

  /** A SIM the branch already holds, physical or eSIM. Free. A new eSIM is `requestEsim`. */
  async swapSim(actor: Actor, lineId: string, body: { iccid?: unknown; esim?: unknown; qr?: unknown; outcome?: unknown }) {
    const outcome = asOutcome(body.outcome);
    const iccid = typeof body.iccid === 'string' ? body.iccid.trim() : '';
    const esim = body.esim === true;
    const qr = esim ? readQr(body.qr) ?? null : null;
    if (!outcome || iccid.length < 8) fail(400, 'INVALID');
    const line = await this.kernel.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, 'sim', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    const rules = simRulesOf(line.package.company, line.package);
    if (esim && !rules.esim) fail(400, 'ESIM_UNSUPPORTED');
    const refusal = simRefusal(rules, iccid);
    if (refusal) fail(400, refusal);
    if (outcome === 'success' && this.runsNow(line.package, 'sim')) {
      await this.kernel.runTx(async (tx) => {
        await tx.line.update({ where: { id: line.id }, data: { iccid, esim, esimQr: qr } });
        await this.kernel.recordOp(tx, line.posId, actor.operatorId, 'sim', saleOf(line));
      });
      return { applied: true, debited: false };
    }
    const task = await this.tasks.openTask({
      action: 'sim', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: line.msisdn, iccid, esim, esimQr: qr,
      note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : 'مهمة فرع',
    });
    return { applied: false, taskId: task.id };
  }

  /** The customer wants an eSIM issued (lost SIM, or plastic to eSIM). Always a branch task; the employee attaches the serial and the QR. */
  async requestEsim(actor: Actor, lineId: string) {
    const line = await this.kernel.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active') fail(400, 'INVALID');
    if (line.denied.has('esim')) fail(403, 'OPERATION_DENIED');
    if (!simRulesOf(line.package.company, line.package).esim) fail(400, 'ESIM_UNSUPPORTED');
    const { price } = esimPriceOf({ pkg: line.package, provider: line.package.provider, company: line.package.company });
    const task = await this.tasks.openTask({
      action: 'esim', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: -price, msisdn: line.msisdn, iccid: null, esim: true,
      note: 'مهمة فرع',
    });
    return { applied: false, taskId: task.id };
  }

  /** Closing a task may carry what the provider handed back: an eSIM serial and QR, or the new number. */
  async completeTask(actor: Actor, id: string, body: { note?: unknown; iccid?: unknown; qr?: unknown; msisdn?: unknown }) {
    assertBranch(actor);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const givenIccid = typeof body.iccid === 'string' ? body.iccid.trim() : '';
    const givenQr = readQr(body.qr) ?? null;
    const givenMsisdn = typeof body.msisdn === 'string' ? body.msisdn.trim() : '';
    const task = await this.kernel.prisma.officeTask.findUnique({ where: { id } });
    if (!task || task.status !== 'working' || task.assigneeId !== actor.id) fail(400, 'INVALID');
    const handed: { iccid?: string; msisdn?: string } = {};
    if (task.action === 'esim') {
      if (!givenIccid || !givenQr) fail(400, 'INVALID');
    }
    if (task.action === 'rename') {
      if (!/^05\d{8}$/.test(givenMsisdn)) fail(400, 'INVALID');
      const taken = await this.kernel.prisma.line.findUnique({ where: { msisdn: givenMsisdn } });
      if (taken && taken.id !== task.lineId) fail(400, 'NUMBER_TAKEN');
      handed.msisdn = givenMsisdn;
    }
    if (givenIccid && (task.action === 'esim' || (task.esim && (task.action === 'activate' || task.action === 'sim')))) {
      const taskPkg = await this.kernel.prisma.package.findUnique({ where: { id: task.packageId }, include: { company: true } });
      const refusal = simRefusal(simRulesOf(taskPkg?.company ?? null), givenIccid);
      if (refusal) fail(400, refusal);
      handed.iccid = givenIccid;
    }
    const handedQr = task.action === 'esim' || task.esim ? givenQr ?? task.esimQr : null;
    const written = await this.kernel.runTx(async (tx) => {
      // The hold made when the task opened gives way to the charge itself (roadmap N6), before any money moves.
      await this.kernel.release(tx, task.posId, task.held ?? 0, actor.operatorId, note);
      let sale: Sale | undefined;
      let posted = false;
      if (task.action === 'activate') {
        const pkg = await tx.package.findUnique({
          where: { id: task.packageId },
          include: {
            company: true,
            provider: true,
            renewals: { include: { target: { include: { company: true, provider: true } } } },
          },
        });
        if (!pkg) fail(404, 'NOT_FOUND');
        if (!pkg.company || !pkg.provider) fail(400, 'INVALID');
        if (pkg.renewals.some((renewal) => !renewal.target.company || !renewal.target.provider)) fail(400, 'INVALID');
        const terms = await this.stampFor(
          captureTerms(
            packageTermsOf(pkg),
            pkg.renewals.map((renewal) => packageTermsOf(renewal.target)),
          ),
          task.posId,
          undefined,
          tx,
        );
        const created = await tx.line.create({
          data: {
            msisdn: task.msisdn || (await this.freshMsisdn()),
            iccid: task.esim ? handed.iccid ?? null : task.iccid,
            esim: task.esim,
            esimQr: task.esim ? handedQr : null,
            status: 'active',
            packageId: task.packageId,
            posId: task.posId,
            terms: terms as unknown as Prisma.InputJsonValue,
            endsAt: periodEnd(new Date(), pkg.months),
          },
        });
        const pkgTerms = packageTermsOf(pkg);
        const packagePrice = await this.resolveBuyPrice(task.posId, pkg, 'subscription');
        sale = {
          msisdn: created.msisdn,
          lineId: created.id,
          companyName: pkg.company?.name ?? '',
          packageName: pkg.name,
          packagePrice,
          providerCost: activationProviderCost(
            pkgTerms.subscription.branchCost,
            task.esim,
            esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).price,
          ),
          // The fee folded into the task's debit when it was opened: what the row's amount holds beyond the package price.
          ...(task.esim ? { esimPrice: Math.max(0, -task.posDelta - packagePrice) } : {}),
          period: periodOf(pkg.months, created.endsAt),
        };
      }
      let disconnectAmount: number | undefined;
      let switchAmount: number | undefined;
      if (task.lineId && task.action === 'disconnect') {
        const current = await tx.line.findUnique({
          where: { id: task.lineId },
          include: { package: { include: { company: true, provider: true } } },
        });
        if (current) {
          const settled = await this.disconnectSettlementFor(tx, current, new Date());
          await tx.line.update({ where: { id: current.id }, data: { status: 'disconnected' } });
          if (settled) {
            await this.kernel.move(tx, task.posId, settled.amount, actor.operatorId, 'disconnect', note, {
              msisdn: current.msisdn,
              lineId: current.id,
              companyName: current.package.company?.name ?? '',
              packageName: current.package.name,
              packagePrice: settled.posPrice,
              providerCost: settled.providerCost,
            });
            disconnectAmount = settled.amount;
            posted = true;
          }
        }
      }
      if (task.lineId && task.action === 'freeze') await tx.line.update({ where: { id: task.lineId }, data: { status: 'frozen' } });
      if (task.lineId && task.action === 'unfreeze') await tx.line.update({ where: { id: task.lineId }, data: { status: 'active' } });
      if (task.lineId && (task.action === 'extend' || task.action === 'reactivate' || task.action === 'charge')) {
        const current = await tx.line.findUnique({
          where: { id: task.lineId },
          include: { package: { include: { company: true, provider: true } } },
        });
        if (current) {
          if (!current.package.company || !current.package.provider) fail(400, 'INVALID');
          const base = task.action === 'extend' && current.endsAt > new Date() ? current.endsAt : new Date();
          const target = task.action === 'extend' && task.nextPackageId
            ? await tx.package.findUnique({
                where: { id: task.nextPackageId },
                include: { company: true, provider: true },
              })
            : null;
          if (task.action === 'extend' && task.nextPackageId && (!target || !target.company || !target.provider)) fail(400, 'INVALID');
          const renewal = task.action === 'extend'
            ? target
              ? renewOnto(lineTermsOf(current.terms, current.package), packageTermsOf(target), base)
              : renewStay(lineTermsOf(current.terms, current.package), base)
            : null;
          if (renewal && 'error' in renewal) fail(400, 'INVALID');
          const openedMonths = current.package.months;
          const openedTerms = renewal
            ? renewal.terms
            : { ...lineTermsOf(current.terms, current.package), windowMonths: openedMonths };
          const endsAt = renewal?.endsAt ?? periodEnd(base, openedMonths);
          await tx.line.update({
            where: { id: current.id },
            data: {
              status: task.action === 'reactivate' || task.action === 'charge' ? 'active' : current.status,
              endsAt,
              terms: openedTerms as unknown as Prisma.InputJsonValue,
              ...(target ? { packageId: target.id } : {}),
            },
          });
          sale = {
            ...saleOf(current, target ?? undefined, -task.posDelta),
            period: periodOf(windowMonthsOf(openedTerms), endsAt),
          };
        }
      }
      if (task.lineId && task.action === 'switch' && task.nextPackageId) {
        const [current, source, target] = await Promise.all([
          tx.line.findUnique({
            where: { id: task.lineId },
            include: { package: { include: { company: true, provider: true } } },
          }),
          tx.package.findUnique({
            where: { id: task.packageId },
            include: {
              company: true,
              provider: true,
              switches: { include: { target: { select: { code: true } } } },
            },
          }),
          tx.package.findUnique({
            where: { id: task.nextPackageId },
            include: { company: true, provider: true },
          }),
        ]);
        if (
          !current ||
          !current.package.company ||
          !current.package.provider ||
          !source ||
          !source.company ||
          !source.provider ||
          !target ||
          !target.company ||
          !target.provider
        ) fail(400, 'INVALID');
        const switched = switchOnto(
          lineTermsOf(current.terms, current.package),
          packageTermsOf(source),
          packageTermsOf(target),
          source.switches.map((item) => item.target.code),
        );
        if ('error' in switched) fail(400, 'INVALID');
        const quote = await this.switchQuote(tx, current, target, new Date());
        switchAmount = -quote.difference;
        sale = {
          msisdn: current.msisdn,
          lineId: current.id,
          companyName: target.company?.name ?? '',
          packageName: target.name,
          packagePrice: quote.newPrice,
          providerCost: quote.providerCost,
          period: periodOf(target.months, null),
        };
        if (switchAmount !== 0) await this.kernel.move(tx, task.posId, switchAmount, actor.operatorId, 'switch', note, sale);
        else await this.kernel.recordOp(tx, task.posId, actor.operatorId, 'switch', sale);
        posted = true;
        // Same as an immediate switch: the line carries the renewal price its point of sale pays today.
        const stamped = await this.stampFor(switched.terms, current.posId, undefined, tx);
        await tx.line.update({
          where: { id: current.id },
          data: {
            terms: stamped as unknown as Prisma.InputJsonValue,
            packageId: target.id,
            opsLocked: false,
          },
        });
      }
      if (task.lineId && task.action === 'rename' && handed.msisdn) {
        await tx.line.update({ where: { id: task.lineId }, data: { msisdn: handed.msisdn } });
      }
      if (task.lineId && task.action === 'sim' && task.iccid) {
        await tx.line.update({ where: { id: task.lineId }, data: { iccid: task.iccid, esim: task.esim, esimQr: task.esim ? handedQr : null } });
      }
      if (task.lineId && task.action === 'esim' && handed.iccid) {
        await tx.line.update({ where: { id: task.lineId }, data: { iccid: handed.iccid, esim: true, esimQr: handedQr } });
      }
      if (!sale && task.lineId) {
        const current = await tx.line.findUnique({ where: { id: task.lineId }, include: { package: { include: { company: true } } } });
        // An eSIM request's debit is the eSIM fee, and that fee is what the provider charges for it.
        if (current) sale = task.action === 'esim' ? { ...saleOf(current), providerCost: -task.posDelta, esimPrice: -task.posDelta } : saleOf(current);
      }
      if (task.action !== 'disconnect' && task.action !== 'switch' && task.posDelta !== 0) {
        await this.kernel.move(tx, task.posId, task.posDelta, actor.operatorId, task.action, note, sale);
        posted = true;
      }
      if (!posted && sale) await this.kernel.recordOp(tx, task.posId, actor.operatorId, task.action, sale);
      const postedAmount = switchAmount ?? disconnectAmount ?? task.posDelta;
      await tx.officeTask.update({
        where: { id },
        data: {
          status: 'done',
          resultNote: note || null,
          ...(handed.iccid ? { iccid: handed.iccid } : {}),
          ...(handed.msisdn ? { msisdn: handed.msisdn } : {}),
          ...(disconnectAmount !== undefined ? { posDelta: disconnectAmount } : {}),
          ...(switchAmount !== undefined ? { posDelta: switchAmount } : {}),
        },
      });
      return this.tasks.taskNotice(tx, 'done', task, actor, {
        packageName: sale?.packageName ?? '',
        amount: postedAmount,
        handlerName: actor.nickname,
      });
    });
    await this.kernel.publishQuietly(written);
    return { ok: true };
  }

  private runsNow(pkg: Parameters<LinesService['assertRunnable']>[0], action: ActionKey | 'unfreeze') {
    return resolvePackageMode(pkg.actionModes, pkg, action) === 'auto';
  }

  private operationsFor(line: {
    status: string;
    endsAt: Date;
    opsLocked?: boolean;
    package: Parameters<LinesService['assertRunnable']>[0] & { company?: { esim?: boolean } | null; esimAvailable?: boolean };
    denied?: ReadonlySet<OpKey>;
  }): string[] {
    const denied = line.denied ?? new Set<OpKey>();
    const keys: string[] = offeredOperations(
      { status: line.status, endsAt: line.endsAt, opsLocked: line.opsLocked ?? false },
      (action) => resolvePackageMode(line.package.actionModes, line.package, action),
    );
    // An eSIM request is always a branch task: the employee attaches the serial and the QR picture.
    if (line.status === 'active' && !line.opsLocked && simRulesOf(line.package.company ?? null, line.package).esim) keys.push('esim');
    // A refresh is a provider operation on a live subscription: active numbers only, like the rest.
    if (line.status === 'active' && !line.opsLocked && refreshMode(line.package.actionModes) !== 'off') keys.push('refresh');
    return keys.filter((key) => {
      const stop = opKeyOf(key);
      return !stop || !denied.has(stop);
    });
  }

  private async restartDisconnected(actor: Actor, line: Awaited<ReturnType<OfficeKernel['visibleLine']>>, outcome: 'success' | 'fail') {
    if (line.status !== 'disconnected') fail(400, 'INVALID');
    this.assertRunnable(line.package, 'charge', line.denied);
    const charged = await this.resolveBuyPrice(line.posId, line.package, 'subscription', line.posPath);
    const posDelta = -charged;
    if (outcome === 'fail' || !this.runsNow(line.package, 'charge')) {
      const task = await this.tasks.openTask({
        action: 'charge', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? PROVIDER_FAILED_NOTE : 'مهمة فرع',
      });
      return { applied: false as const, taskId: task.id };
    }
    await this.kernel.runTx(async (tx) => {
      const endsAt = periodEnd(new Date(), line.package.months);
      await this.kernel.move(tx, line.posId, posDelta, actor.operatorId, 'charge', '', {
        ...saleOf(line, undefined, charged),
        period: periodOf(line.package.months, endsAt),
      });
      await tx.line.update({
        where: { id: line.id },
        data: {
          status: 'active',
          endsAt,
          terms: {
            ...lineTermsOf(line.terms, line.package),
            windowMonths: line.package.months,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return { applied: true, debited: posDelta < 0 };
  }

  private assertRunnable(pkg: {
    enabled: boolean;
    allowActivate: boolean;
    allowCharge: boolean;
    allowDisconnect: boolean;
    allowFreeze: boolean;
    allowSwitch: boolean;
    allowExtend: boolean;
    allowRename: boolean;
    allowSim: boolean;
    actionModes?: unknown;
  }, action: string, denied: ReadonlySet<OpKey> = new Set()) {
    if (action === 'companySwitch') fail(400, 'INVALID');
    const stopKey = opKeyOf(action);
    if (stopKey && denied.has(stopKey)) fail(403, 'OPERATION_DENIED');
    const selling = action === 'activate' || action === 'charge' || action === 'extend' || action === 'reactivate' || action === 'switch';
    if (!pkg.enabled && selling) fail(400, 'PACKAGE_DISABLED');
    const mode = resolvePackageMode(pkg.actionModes, pkg, action as ActionKey | 'unfreeze');
    if (mode === 'off') fail(400, 'OPERATION_DISABLED');
  }

  private async visibleFor(userId: string, pkg: { id: string; enabled: boolean; forSale: boolean }, path?: PathNode[]): Promise<boolean> {
    const [known, { terms }] = await Promise.all([path ? Promise.resolve(path) : this.kernel.pathOf(userId, await this.kernel.accounts()), this.kernel.termsFor(pkg.id)]);
    return visibleTo(known, terms, pkg);
  }

  /** Switch targets saved on the package that the selling account may see. */
  private async visibleSwitchTargets(packageId: string, posPath: PathNode[]): Promise<string[]> {
    const saved = await this.kernel.prisma.packageSwitch.findMany({
      where: { packageId },
      select: { target: { select: { id: true, code: true, enabled: true, forSale: true } } },
    });
    if (saved.length === 0) return [];
    const terms = await this.kernel.prisma.userPackage.findMany({
      where: { packageId: { in: saved.map((item) => item.target.id) }, userId: { in: posPath.map((node) => node.id) } },
      select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
    });
    return saved
      .filter((item) => visibleTo(posPath, terms.filter((row) => row.packageId === item.target.id), item.target))
      .map((item) => item.target.code);
  }

  /**
   * What `userId` pays for this package today: its custom price, else its parent's sell price, else
   * the layer column. It is only ever asked what a new capture would carry or charge (an activation,
   * a restart, the target of a switch). A renewal never asks: it debits the price on the line.
   */
  private async resolveBuyPrice(
    userId: string,
    pkg: { id: string } & LayerPrices,
    kind: PriceKind,
    known?: PathNode[],
  ): Promise<number> {
    const [path, { terms, sells }] = await Promise.all([known ? Promise.resolve(known) : this.kernel.pathOf(userId, await this.kernel.accounts()), this.kernel.termsFor(pkg.id)]);
    if (path.length === 0) return buyPriceFor([{ id: userId, loginName: '', layer: 'pos', deniedOps: '' }], [], [], pkg, kind);
    return buyPriceFor(path, terms, sells, pkg, kind);
  }

  /**
   * Writes into terms about to be saved the renewal price the point of sale would pay today, for the
   * package and for each of its renewal targets: custom price, else the parent's sell price, else the
   * layer column. One read per table serves every package named in the terms. A point of sale that is
   * not in the tree leaves the terms as captured.
   */
  async stampFor(
    terms: LineTerms,
    posId: string,
    known?: PathNode[],
    db: Prisma.TransactionClient | PrismaClient = this.kernel.prisma,
  ): Promise<LineTerms> {
    const path = known ?? this.kernel.pathOf(posId, await this.kernel.accounts());
    if (path.length === 0) return terms;
    const codes = [...new Set([terms.packageCode, ...terms.renewalTargets.map((target) => target.code)])];
    return this.kernel.stampWith(terms, path, await this.kernel.ladderRows(codes, path.map((node) => node.id), db));
  }

  private async disconnectSettlementFor(
    tx: Prisma.TransactionClient | PrismaClient,
    line: {
      id: string;
      endsAt: Date;
      terms: Prisma.JsonValue;
      package: PackagePriceRow;
    },
    now: Date,
  ) {
    const { terms, periods, lastPrice } = await this.openPeriodsOf(tx, line, now);
    const settled = settleDisconnect(periods, (renewal) => (renewal ? terms.renewal.branchCost : terms.subscription.branchCost));
    return settled ? { ...settled, posPrice: lastPrice } : null;
  }

  /** The line's paid periods still open. Rows written before periods were stored fall back to the last window. */
  private async openPeriodsOf(
    db: Prisma.TransactionClient | PrismaClient,
    line: { id: string; endsAt: Date; terms: Prisma.JsonValue; package: PackagePriceRow },
    now: Date,
  ) {
    const terms = lineTermsOf(line.terms, line.package);
    const rows = await db.walletEntry.findMany({
      where: { lineId: line.id, kind: { in: PREPAID_KINDS } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { kind: true, packagePrice: true, periodDays: true, periodEndsAt: true },
    });
    const last = rows[0];
    const renewal = Boolean(last && (last.kind === 'charge' || last.kind === 'extend' || last.kind === 'reactivate'));
    const lastPrice = last?.packagePrice ?? (renewal ? terms.renewal.posPrice : terms.subscription.posPrice);
    const periods = openPeriods(now, rows) ?? lastWindow(now, line.endsAt, windowMonthsOf(terms), lastPrice, renewal);
    return { terms, periods, lastPrice };
  }

  private async switchQuote(
    db: Prisma.TransactionClient | PrismaClient,
    line: {
      id: string;
      endsAt: Date;
      terms: Prisma.JsonValue;
      posId: string;
      package: PackagePriceRow;
    },
    target: PackagePriceRow & { id: string },
    now: Date,
  ) {
    const { terms, periods } = await this.openPeriodsOf(db, line, now);
    const nextTerms = packageTermsOf(target);
    // The whole ladder, as `stampFor` resolves it: the quote and the price the switched line carries are one number.
    const newPrice = await this.resolveBuyPrice(line.posId, target, 'renewal');
    const money = switchOver(periods, newPrice, target.months);
    // The branch side: each open period's cost, chosen like a disconnect, against the target's subscription cost.
    const costs = revalue(periods, (period) => (period.renewal ? terms.renewal.branchCost : terms.subscription.branchCost));
    const cost = switchOver(costs, nextTerms.subscription.branchCost, target.months);
    return { ...money, newPrice, providerCost: cost.difference };
  }

  private async freshMsisdn(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const msisdn = `05${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
      const existing = await this.kernel.prisma.line.findUnique({ where: { msisdn } });
      if (!existing) return msisdn;
    }
    throw new OfficeFailure(400, 'INVALID');
  }

  /** A carrier switch has no fields yet, so every request is refused. */
  companySwitch(): never {
    fail(400, 'INVALID');
  }
}
