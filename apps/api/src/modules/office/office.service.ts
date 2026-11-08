import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AUTH_STORE, AuthStore } from '../auth/auth.store';
import { OfficeFailure, fail } from '../shared/office-failure';
import { catalog, companies, packageCode, packageName } from './office-catalog';
import {
  FEED_PAGE,
  LINES_PAGE,
  NEWEST_FIRST,
  afterFeed,
  idCursorArgs,
  linesWhere,
  mergeFeed,
  pageOf,
  type LineFilter,
} from './office-paging';
import {
  AGOROT,
  activationProviderCost,
  esimPriceOf,
  PERIOD_DAYS,
  captureTerms,
  activateInputs,
  lastWindow,
  normalizeActionModes,
  offeredOperations,
  openPeriods,
  packageFlagsFromModes,
  resolvePackageMode,
  periodEnd,
  renewOnto,
  refreshMode,
  renewStay,
  revalue,
  settleDisconnect,
  simRefusal,
  issueSerial,
  simRulesOf,
  switchOnto,
  switchOver,
  windowMonthsOf,
  visibleAccountIds,
  type ActionKey,
  type LineTerms,
} from './office-rules';
import { packageTermsOf, type PackagePriceRow } from './office-terms';
import { buyPriceFor, deniedOpsFor, isOpKey, visibleTo, type LayerPrices, type OpKey, type PathNode, type PriceKind } from './user-terms';
import { renderEsimQr } from './office-esim';
import { canHandleTasks, type TaskEvent } from './task-access';
import { NoticeService, type WrittenNotice } from './notice.service';
import { feedPosition } from './kernel/feed';
import { type LadderRows } from './kernel/office-kernel';
import { OfficeKernel } from './kernel/office-kernel';
import { TransfersService } from './transfers/transfers.service';
import { AccountsService } from './accounts/accounts.service';
import { DeskService } from './desk/desk.service';
import { RolesService } from './roles/roles.service';
import { TermsService, type LineTarget, type RepriceLine } from './terms/terms.service';
import { PackagesService } from './packages/packages.service';
import { CompaniesService } from './companies/companies.service';
import { ProvidersService } from './providers/providers.service';
import { WalletsService } from './wallets/wallets.service';
import { PROVIDER_OPERATION_KINDS } from './wallets/provider-cost';
import { AuditService } from './audit/audit.service';
import { TasksService } from './tasks/tasks.service';
import type { Account, Action, Actor, Gate, Sale } from './kernel/types';
import { type TaskNoticePayload } from './notice-kinds';
import { lineTermsOf } from './kernel/line-terms';
import { saleOf } from './kernel/sale';
import type { TransferAccountBody } from './transfers/transfers.service';

/** The price columns of a package that `LayerPrices` holds, as a `select`. */
/** What decides the prices points of sale pay for some packages: their price columns, the custom rows on them, and the sell prices of the accounts above. */

const PREPAID_KINDS = ['activate', 'charge', 'extend', 'reactivate', 'switch'];
/** Entries that put time on a line: the newest one is the last recharge shown on the card. */
const RECHARGE_KINDS = ['activate', 'charge', 'extend', 'reactivate'];
/** The largest QR data URL stored on a line. The client shrinks to about 300 KB first. */
const QR_LIMIT = 400_000;

function periodOf(months: number, endsAt: Date | null) {
  return { days: PERIOD_DAYS * Math.max(1, months), endsAt };
}

export { OfficeFailure };

@Injectable()
export class OfficeService implements OnModuleInit {
  /** Shared by every office domain: the client, the actor, accounts, transactions, wallet moves (kernel/office-kernel.ts). */
  private readonly kernel: OfficeKernel;

  // Specs replace the client through this property; it lives on the kernel so the domain services see the same one.
  private get prismaClient(): PrismaClient | null {
    return this.kernel.prismaClient;
  }

  private set prismaClient(client: PrismaClient | null) {
    this.kernel.prismaClient = client;
  }

  private get prisma(): PrismaClient {
    return this.kernel.prisma;
  }

  private get notice(): NoticeService {
    return this.kernel.notice;
  }

  private get auth(): AuthStore {
    return this.kernel.auth;
  }

  private auditService: AuditService | null = null;

  private get auditLog(): AuditService {
    this.auditService ??= new AuditService(this.kernel);
    return this.auditService;
  }

  private tasksService: TasksService | null = null;

  private get tasksDomain(): TasksService {
    this.tasksService ??= new TasksService(this.kernel);
    return this.tasksService;
  }

  private openTask(input: {
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
  }) {
    return this.tasksDomain.openTask(input);
  }

  private taskNotice(
    tx: Prisma.TransactionClient,
    event: TaskEvent,
    task: { id: string; action: string; msisdn: string | null; submitterId: string; posId: string; assigneeId: string | null },
    actor: Actor,
    extra: Partial<TaskNoticePayload> = {},
  ) {
    return this.tasksDomain.taskNotice(tx, event, task, actor, extra);
  }

  private noteLog(current: string, line: string) {
    return this.tasksDomain.noteLog(current, line);
  }

  constructor(
    @Inject(AUTH_STORE) auth: AuthStore,
    @Optional() notice?: NoticeService,
    @Optional() db?: PrismaService,
    @Optional() kernel?: OfficeKernel,
  ) {
    this.kernel = kernel ?? new OfficeKernel(auth, notice, db);
  }

  private walletDeskInstance: WalletsService | null = null;

  private get walletDesk(): WalletsService {
    this.walletDeskInstance ??= new WalletsService(this.kernel);
    return this.walletDeskInstance;
  }

  private providerDeskInstance: ProvidersService | null = null;

  private get providerDesk(): ProvidersService {
    this.providerDeskInstance ??= new ProvidersService(this.kernel);
    return this.providerDeskInstance;
  }

  private companyDeskInstance: CompaniesService | null = null;

  private get companyDesk(): CompaniesService {
    this.companyDeskInstance ??= new CompaniesService(this.kernel);
    return this.companyDeskInstance;
  }

  private packageDeskInstance: PackagesService | null = null;

  private get packageDesk(): PackagesService {
    this.packageDeskInstance ??= new PackagesService(this.kernel);
    return this.packageDeskInstance;
  }

  private termDeskInstance: TermsService | null = null;

  private get termDesk(): TermsService {
    this.termDeskInstance ??= new TermsService(this.kernel);
    return this.termDeskInstance;
  }

  private repriceLines(
    tx: Prisma.TransactionClient,
    lines: RepriceLine[],
    planFor: (line: RepriceLine) => LineTarget | null,
    accounts: Account[],
  ) {
    return this.termDesk.repriceLines(tx, lines, planFor, accounts);
  }
  private roleDeskInstance: RolesService | null = null;

  private get roleDesk(): RolesService {
    this.roleDeskInstance ??= new RolesService(this.kernel);
    return this.roleDeskInstance;
  }

  private deskDeskInstance: DeskService | null = null;

  private get deskDesk(): DeskService {
    this.deskDeskInstance ??= new DeskService(this.kernel);
    return this.deskDeskInstance;
  }

  private accountDeskInstance: AccountsService | null = null;

  private get accountDesk(): AccountsService {
    this.accountDeskInstance ??= new AccountsService(this.kernel);
    return this.accountDeskInstance;
  }

  private transferDeskInstance: TransfersService | null = null;

  private get transferDesk(): TransfersService {
    this.transferDeskInstance ??= new TransfersService(this.kernel, this.termDesk);
    return this.transferDeskInstance;
  }

  // One-line delegators: the methods still in this file call the kernel through the names they always used.
  private pathOf(userId: string, accounts: Account[]) {
    return this.kernel.pathOf(userId, accounts);
  }

  private termsFor(packageId: string) {
    return this.kernel.termsFor(packageId);
  }

  private ensureLayerRoles() {
    return this.kernel.ensureLayerRoles();
  }

  private visibleLine(actor: Actor, lineId: string) {
    return this.kernel.visibleLine(actor, lineId);
  }

  private ladderRows(codes: string[], pathIds: string[], db: Prisma.TransactionClient | PrismaClient) {
    return this.kernel.ladderRows(codes, pathIds, db);
  }

  private stampWith(terms: LineTerms, path: PathNode[], rows: LadderRows) {
    return this.kernel.stampWith(terms, path, rows);
  }

  private actor(gate: Gate) {
    return this.kernel.actor(gate);
  }

  private grantsFor(stored: {
    isBranchOwner?: boolean;
    liveGrants?: string | null;
    layer?: string;
    roleId?: string | null;
    extraGrants?: string | null;
    deniedGrants?: string | null;
    role?: { grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean } | null;
    extraRoles?: { role: { grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean } }[];
  } | null) {
    return this.kernel.grantsFor(stored);
  }

  private branchActor(gate: Gate) {
    return this.kernel.branchActor(gate);
  }

  private accounts() {
    return this.kernel.accounts();
  }

  private visibleAccount(actor: Actor, loginName: string) {
    return this.kernel.visibleAccount(actor, loginName);
  }

  private chainIds(actorId: string, accounts: Account[]) {
    return this.kernel.chainIds(actorId, accounts);
  }

  private queueNotices(tx: Prisma.TransactionClient, rows: WrittenNotice[]) {
    return this.kernel.queueNotices(tx, rows);
  }

  private runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.kernel.runTx(fn);
  }

  private publishQuietly(rows: WrittenNotice[]) {
    return this.kernel.publishQuietly(rows);
  }

  private actorName(id: string) {
    return this.kernel.actorName(id);
  }

  private move(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, kind: string, note: string, sale?: Sale) {
    return this.kernel.move(tx, userId, amount, actorId, kind, note, sale);
  }

  private recordOp(tx: Prisma.TransactionClient, userId: string, actorId: string, kind: string, sale: Sale) {
    return this.kernel.recordOp(tx, userId, actorId, kind, sale);
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) return;
    await this.ensureCatalog();
    await this.ensureLayerRoles();
  }

  // Facades (Phase 3): specs still call these; the routes live in desk/desk.controller.ts.
  async me(gate: Gate) {
    return this.deskDesk.me(await this.actor(gate));
  }

  async home(gate: Gate) {
    return this.deskDesk.home(await this.actor(gate));
  }

  async postAnnouncement(gate: Gate, body: { body?: unknown }) {
    return this.deskDesk.postAnnouncement(await this.actor(gate), body);
  }

  // Facades (Phase 3): specs still call these; the routes live in wallets/wallets.controller.ts.
  async wallets(gate: Gate) {
    return this.walletDesk.list(await this.actor(gate));
  }

  async fund(gate: Gate, loginName: string, body: unknown) {
    return this.walletDesk.fund(await this.actor(gate), loginName, body);
  }

  async setCeiling(gate: Gate, loginName: string, body: unknown) {
    return this.walletDesk.setCeiling(await this.actor(gate), loginName, body);
  }

  async ledger(gate: Gate, scope: string, query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string }) {
    return this.walletDesk.ledger(await this.actor(gate), scope, query);
  }

  async providerOperations(gate: Gate, query: { cursor?: string; kind?: string; provider?: string; q?: string; from?: string; to?: string } = {}) {
    return this.walletDesk.providerOperations(await this.actor(gate), query);
  }

  async finance(gate: Gate, query: { cursor?: string; kind?: string; layer?: string; q?: string; from?: string; to?: string } = {}) {
    return this.walletDesk.finance(await this.actor(gate), query);
  }

  // Facades (Phase 3): specs still call these; the routes live in packages/packages.controller.ts.
  async packages(gate: Gate) {
    return this.packageDesk.list(await this.actor(gate));
  }

  async setSellPrice(gate: Gate, code: string, body: { price?: unknown; renewalPrice?: unknown }) {
    return this.packageDesk.setSellPrice(await this.actor(gate), code, body);
  }

  async clearSellPrice(gate: Gate, code: string) {
    return this.packageDesk.clearSellPrice(await this.actor(gate), code);
  }

  async setPackageMode(gate: Gate, code: string, body: Record<string, unknown>) {
    return this.packageDesk.setMode(await this.actor(gate), code, body);
  }

  async packageSheet(gate: Gate, code: string) {
    return this.packageDesk.sheet(await this.actor(gate), code);
  }

  async setChain(gate: Gate, code: string, body: Record<string, unknown>) {
    return this.packageDesk.setChain(await this.actor(gate), code, body);
  }

  async setPackageTargets(gate: Gate, code: string, kind: 'renewals' | 'switches', body: { targets?: unknown }) {
    return this.packageDesk.setTargets(await this.actor(gate), code, kind, body);
  }

  // Facades (Phase 3): specs still call these; the routes live in companies/companies.controller.ts.
  async companiesShelf(gate: Gate) {
    return this.companyDesk.shelf(await this.actor(gate));
  }

  async setCompanySim(gate: Gate, code: string, body: { length?: unknown; prefix?: unknown; esim?: unknown; esimPrice?: unknown }) {
    return this.companyDesk.setSim(await this.actor(gate), code, body);
  }

  async setCompanyImage(gate: Gate, body: { name?: unknown; image?: unknown }) {
    return this.companyDesk.setImage(await this.actor(gate), body);
  }

  // Facades (Phase 3): specs still call these; the routes live in providers/providers.controller.ts.
  async providers(gate: Gate) {
    return this.providerDesk.list(await this.actor(gate));
  }

  async providerSettings(gate: Gate, code: string) {
    return this.providerDesk.settings(await this.actor(gate), code);
  }

  async setProviderEsimPrice(gate: Gate, code: string, body: { price?: unknown }) {
    return this.providerDesk.setEsimPrice(await this.actor(gate), code, body);
  }

  async setProviderMode(gate: Gate, code: string, body: Record<string, unknown>) {
    return this.providerDesk.setMode(await this.actor(gate), code, body);
  }

  async lines(gate: Gate, query: LineFilter & { cursor?: string } = {}) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const where = linesWhere(posIds, query);
    const [rows, total] = await Promise.all([
      this.prisma.line.findMany({
        where,
        include: { package: { include: { company: true } }, pos: true },
        orderBy: [...NEWEST_FIRST],
        ...idCursorArgs(query.cursor || undefined, LINES_PAGE),
      }),
      this.prisma.line.count({ where }),
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
        packageCode: row.package.code,
        packageName: row.package.name,
        companyName: row.package.company?.name ?? '',
        posLogin: row.pos.loginName,
        posPrice: row.package.posPrice,
        createdAt: row.createdAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        operations: this.operationsFor({ ...row, denied: deniedOpsFor(this.pathOf(row.posId, accounts)) }),
      })),
      nextCursor,
      poses: accounts
        .filter((account) => account.layer === 'pos' && visible.has(account.id) && canActivateFor(actor, account, accounts))
        .map((account) => ({ loginName: account.loginName, nickname: account.nickname })),
    };
  }

  async line(gate: Gate, id: string) {
    const actor = await this.actor(gate);
    const line = await this.prisma.line.findUnique({
      where: { id },
      include: { package: { include: { company: true, provider: true } }, pos: true },
    });
    if (!line) fail(404, 'NOT_FOUND');
    const accounts = await this.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(line.posId)) fail(403, 'FORBIDDEN');
    const posPath = this.pathOf(line.posId, accounts);
    const denied = deniedOpsFor(posPath);
    const [tasks, entries] = await Promise.all([
      this.prisma.officeTask.findMany({
        where: { lineId: line.id },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: {
          submitter: { select: { loginName: true, nickname: true } },
          assignee: { select: { loginName: true, nickname: true } },
        },
      }),
      this.prisma.walletEntry.findMany({
        where: { lineId: line.id },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { actor: { select: { loginName: true, nickname: true } } },
      }),
    ]);
    const packageIds = [...new Set(tasks.flatMap((task) => [task.packageId, task.nextPackageId].filter((id): id is string => !!id)))];
    const packages = packageIds.length
      ? await this.prisma.package.findMany({ where: { id: { in: packageIds } }, include: { company: true } })
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
        ? await this.prisma.walletEntry.findFirst({ where: { lineId: line.id, kind: { in: RECHARGE_KINDS } }, orderBy: { createdAt: 'desc' }, select: { kind: true, createdAt: true } })
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
        sim: simRulesOf(line.package.company),
        switchTargets: await this.visibleSwitchTargets(line.packageId, posPath),
        opsLocked: line.opsLocked,
        createdAt: line.createdAt.toISOString(),
        endsAt: line.endsAt.toISOString(),
        operations: this.operationsFor({ ...line, denied }),
      },
      history,
    };
  }

  async activate(gate: Gate, body: Record<string, unknown>) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const esim = body.esim === true;
    const iccid = typeof body.iccid === 'string' ? body.iccid.trim() : '';
    const packageCode = typeof body.packageCode === 'string' ? body.packageCode : '';
    const posLogin = typeof body.posLogin === 'string' ? body.posLogin : '';
    const requested = typeof body.msisdn === 'string' ? body.msisdn.trim() : '';
    const currentDetails = typeof body.currentDetails === 'string' ? body.currentDetails.trim() : '';
    if (!outcome || !packageCode || !posLogin) fail(400, 'INVALID');
    if (requested && !/^05\d{8}$/.test(requested)) fail(400, 'INVALID');
    const accounts = await this.accounts();
    const pos = accounts.find((account) => account.loginName === posLogin && account.layer === 'pos');
    if (!pos || !canActivateFor(actor, pos, accounts)) fail(403, 'FORBIDDEN');
    const posPath = this.pathOf(pos.id, accounts);
    const pkg = await this.prisma.package.findUnique({
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
    if (!visibleTo(posPath, (await this.termsFor(pkg.id)).terms, pkg)) fail(400, 'PACKAGE_HIDDEN');
    this.assertRunnable(pkg, 'activate', deniedOpsFor(posPath));
    const inputs = activateInputs(pkg.provider.code);
    if (inputs === 'generated' && !esim && !iccid) fail(400, 'INVALID');
    if (inputs === 'current-details' && (!currentDetails || iccid.length < 8)) fail(400, 'INVALID');
    if (inputs === 'number-and-sim' && (!requested || iccid.length < 8)) fail(400, 'INVALID');
    const sim = simRulesOf(pkg.company);
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
      const existing = await this.prisma.line.findUnique({ where: { msisdn } });
      if (existing) fail(400, 'NUMBER_TAKEN');
    }
    // A generated eSIM has no serial yet: the provider (or the branch, through a task) issues it.
    // Providers that take the serial from the seller keep it; the line is still an eSIM and still pays the fee.
    const generatesEsim = inputs === 'generated' && esim;
    const storedIccid = generatesEsim ? null : iccid || null;
    if (outcome === 'fail' || !this.runsNow(pkg, 'activate')) {
      const task = await this.openTask({
        action: 'activate', actor, posId: pos.id, packageId: pkg.id, posDelta, msisdn, iccid: storedIccid, esim,
        note: outcome === 'fail' ? 'فشل المزود' : currentDetails || 'مهمة فرع',
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
    const created = await this.runTx(async (tx) => {
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
      await this.move(tx, pos.id, posDelta, actor.operatorId, 'activate', '', {
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

  async operate(gate: Gate, lineId: string, action: Exclude<Action, 'activate' | 'switch' | 'reactivate' | 'refresh' | 'esim'>, body: { outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    if (!outcome) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (action === 'charge') return this.restartDisconnected(actor, line, outcome);
    this.assertRunnable(line.package, action, line.denied);
    if (line.status === 'disconnected') fail(400, 'INVALID');
    if ((action === 'disconnect' || action === 'freeze') && line.status !== 'active') fail(400, 'INVALID');
    if (action === 'unfreeze' && line.status !== 'frozen') fail(400, 'INVALID');
    if (action === 'disconnect') {
      if (outcome === 'fail' || !this.runsNow(line.package, 'disconnect')) {
        const task = await this.openTask({
          action, actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: line.msisdn,
          note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
        });
        return { applied: false, taskId: task.id };
      }
      await this.runTx(async (tx) => {
        const settled = await this.disconnectSettlementFor(tx, line, new Date());
        const sale = {
          msisdn: line.msisdn,
          lineId: line.id,
          companyName: line.package.company?.name ?? '',
          packageName: line.package.name,
          packagePrice: settled?.posPrice ?? line.package.posPrice,
          providerCost: settled?.providerCost,
        };
        if (settled) await this.move(tx, line.posId, settled.amount, actor.operatorId, 'disconnect', '', sale);
        else await this.recordOp(tx, line.posId, actor.operatorId, 'disconnect', sale);
        await tx.line.update({ where: { id: line.id }, data: { status: 'disconnected' } });
      });
      return { applied: true, debited: false };
    }
    const posDelta = 0;
    if (outcome === 'fail' || !this.runsNow(line.package, action)) {
      const task = await this.openTask({
        action, actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.runTx(async (tx) => {
      if (action === 'freeze') await tx.line.update({ where: { id: line.id }, data: { status: 'frozen' } });
      if (action === 'unfreeze') await tx.line.update({ where: { id: line.id }, data: { status: 'active' } });
      await this.recordOp(tx, line.posId, actor.operatorId, action, saleOf(line));
    });
    return { applied: true, debited: false };
  }

  /** The amount a disconnect would credit now, by the same rule as the disconnect itself. Moves nothing. */
  async disconnectQuote(gate: Gate, lineId: string) {
    const actor = await this.actor(gate);
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, 'disconnect', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    const settled = await this.disconnectSettlementFor(this.prisma, line, new Date());
    return { amount: settled?.amount ?? 0, runsNow: this.runsNow(line.package, 'disconnect') };
  }

  async switchPackage(gate: Gate, lineId: string, body: { packageCode?: unknown; outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const packageCode = typeof body.packageCode === 'string' ? body.packageCode : '';
    if (!outcome || !packageCode) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (!line.opsLocked && line.status !== 'active') fail(400, 'INVALID');
    this.assertRunnable(line.package, 'switch', line.denied);
    const [next, allowed] = await Promise.all([
      this.prisma.package.findUnique({ where: { code: packageCode }, include: { company: true, provider: true } }),
      this.prisma.packageSwitch.findMany({
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
      const quote = await this.switchQuote(this.prisma, line, next, new Date());
      const task = await this.openTask({
        action: 'switch', actor, posId: line.posId, packageId: line.packageId, nextPackageId: next.id, lineId: line.id,
        posDelta: -quote.difference, msisdn: line.msisdn, note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    let debited = false;
    // The line carries the renewal price its point of sale would pay for the new package today.
    const stamped = await this.stampFor(switched.terms, line.posId, line.posPath);
    await this.runTx(async (tx) => {
      const quote = await this.switchQuote(tx, line, next, new Date());
      const posDelta = -quote.difference;
      debited = posDelta < 0;
      const sale = { ...saleOf(line, next, quote.newPrice), providerCost: quote.providerCost, period: periodOf(next.months, null) };
      if (posDelta !== 0) await this.move(tx, line.posId, posDelta, actor.operatorId, 'switch', '', sale);
      else await this.recordOp(tx, line.posId, actor.operatorId, 'switch', sale);
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

  async extend(gate: Gate, lineId: string, body: { outcome?: unknown; targetCode?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const targetCode = body.targetCode === undefined ? '' : typeof body.targetCode === 'string' ? body.targetCode : null;
    if (!outcome) fail(400, 'INVALID');
    if (targetCode === null) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active' || line.endsAt.getTime() <= Date.now()) fail(400, 'INVALID');
    this.assertRunnable(line.package, 'extend', line.denied);
    const terms = lineTermsOf(line.terms, line.package);
    const base = line.endsAt > new Date() ? line.endsAt : new Date();
    const target = targetCode
      ? await this.prisma.package.findUnique({ where: { code: targetCode }, include: { company: true, provider: true } })
      : null;
    if (targetCode && (!target || !target.company || !target.provider)) fail(400, 'INVALID');
    const renewal = target ? renewOnto(terms, packageTermsOf(target), base) : renewStay(terms, base);
    if ('error' in renewal) fail(400, 'INVALID');
    // A number pays the renewal price its own terms carry, stay or target entry; no account row is read.
    const posDelta = -renewal.debit;
    if (outcome === 'fail' || !this.runsNow(line.package, 'extend')) {
      const task = await this.openTask({
        action: 'extend', actor, posId: line.posId, packageId: line.packageId, nextPackageId: target?.id,
        lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.runTx(async (tx) => {
      await this.move(
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

  async reactivate(gate: Gate, lineId: string, body: { outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    if (!outcome) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    return this.restartDisconnected(actor, line, outcome);
  }

  async refreshLine(gate: Gate, lineId: string, body: { outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    if (!outcome) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active') fail(400, 'INVALID');
    const mode = refreshMode(line.package.actionModes);
    if (mode === 'off') fail(400, 'OPERATION_DISABLED');
    if (outcome === 'fail' || mode !== 'auto') {
      const task = await this.openTask({
        action: 'refresh', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: line.msisdn,
        note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.runTx(async (tx) => {
      await this.recordOp(tx, line.posId, actor.operatorId, 'refresh', saleOf(line));
    });
    return { applied: true, debited: false };
  }

  /** The new number may be unknown until the branch has it: a task takes it at completion. */
  async renameLine(gate: Gate, lineId: string, body: { msisdn?: unknown; outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const msisdn = typeof body.msisdn === 'string' ? body.msisdn.trim() : '';
    if (!outcome || (msisdn && !/^05\d{8}$/.test(msisdn))) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, 'rename', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    if (msisdn === line.msisdn) fail(400, 'INVALID');
    if (msisdn) {
      const taken = await this.prisma.line.findUnique({ where: { msisdn } });
      if (taken) fail(400, 'NUMBER_TAKEN');
    }
    if (outcome === 'success' && this.runsNow(line.package, 'rename')) {
      if (!msisdn) fail(400, 'INVALID');
      await this.runTx(async (tx) => {
        await tx.line.update({ where: { id: line.id }, data: { msisdn } });
        await this.recordOp(tx, line.posId, actor.operatorId, 'rename', saleOf({ ...line, msisdn }));
      });
      return { applied: true, debited: false };
    }
    const task = await this.openTask({
      action: 'rename', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: msisdn || null,
      note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
    });
    return { applied: false, taskId: task.id };
  }

  /** A SIM the branch already holds, physical or eSIM. Free. A new eSIM is `requestEsim`. */
  async swapSim(gate: Gate, lineId: string, body: { iccid?: unknown; esim?: unknown; qr?: unknown; outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const iccid = typeof body.iccid === 'string' ? body.iccid.trim() : '';
    const esim = body.esim === true;
    const qr = esim ? readQr(body.qr) ?? null : null;
    if (!outcome || iccid.length < 8) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, 'sim', line.denied);
    if (line.status !== 'active') fail(400, 'INVALID');
    const rules = simRulesOf(line.package.company);
    if (esim && !rules.esim) fail(400, 'ESIM_UNSUPPORTED');
    const refusal = simRefusal(rules, iccid);
    if (refusal) fail(400, refusal);
    if (outcome === 'success' && this.runsNow(line.package, 'sim')) {
      await this.runTx(async (tx) => {
        await tx.line.update({ where: { id: line.id }, data: { iccid, esim, esimQr: qr } });
        await this.recordOp(tx, line.posId, actor.operatorId, 'sim', saleOf(line));
      });
      return { applied: true, debited: false };
    }
    const task = await this.openTask({
      action: 'sim', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: line.msisdn, iccid, esim, esimQr: qr,
      note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
    });
    return { applied: false, taskId: task.id };
  }

  /** The customer wants an eSIM issued (lost SIM, or plastic to eSIM). Always a branch task; the employee attaches the serial and the QR. */
  async requestEsim(gate: Gate, lineId: string) {
    const actor = await this.actor(gate);
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active') fail(400, 'INVALID');
    if (line.denied.has('esim')) fail(403, 'OPERATION_DENIED');
    if (!simRulesOf(line.package.company).esim) fail(400, 'ESIM_UNSUPPORTED');
    const { price } = esimPriceOf({ pkg: line.package, provider: line.package.provider, company: line.package.company });
    const task = await this.openTask({
      action: 'esim', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: -price, msisdn: line.msisdn, iccid: null, esim: true,
      note: 'مهمة فرع',
    });
    return { applied: false, taskId: task.id };
  }

  /** Closing a task may carry what the provider handed back: an eSIM serial and QR, or the new number. */
  async completeTask(gate: Gate, id: string, body: { note?: unknown; iccid?: unknown; qr?: unknown; msisdn?: unknown }) {
    const actor = await this.branchActor(gate);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const givenIccid = typeof body.iccid === 'string' ? body.iccid.trim() : '';
    const givenQr = readQr(body.qr) ?? null;
    const givenMsisdn = typeof body.msisdn === 'string' ? body.msisdn.trim() : '';
    const task = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!task || task.status !== 'working' || task.assigneeId !== actor.id) fail(400, 'INVALID');
    const handed: { iccid?: string; msisdn?: string } = {};
    if (task.action === 'esim') {
      if (!givenIccid || !givenQr) fail(400, 'INVALID');
    }
    if (task.action === 'rename') {
      if (!/^05\d{8}$/.test(givenMsisdn)) fail(400, 'INVALID');
      const taken = await this.prisma.line.findUnique({ where: { msisdn: givenMsisdn } });
      if (taken && taken.id !== task.lineId) fail(400, 'NUMBER_TAKEN');
      handed.msisdn = givenMsisdn;
    }
    if (givenIccid && (task.action === 'esim' || (task.esim && (task.action === 'activate' || task.action === 'sim')))) {
      const taskPkg = await this.prisma.package.findUnique({ where: { id: task.packageId }, include: { company: true } });
      const refusal = simRefusal(simRulesOf(taskPkg?.company ?? null), givenIccid);
      if (refusal) fail(400, refusal);
      handed.iccid = givenIccid;
    }
    const handedQr = task.action === 'esim' || task.esim ? givenQr ?? task.esimQr : null;
    const written = await this.runTx(async (tx) => {
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
            await this.move(tx, task.posId, settled.amount, actor.operatorId, 'disconnect', note, {
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
        if (switchAmount !== 0) await this.move(tx, task.posId, switchAmount, actor.operatorId, 'switch', note, sale);
        else await this.recordOp(tx, task.posId, actor.operatorId, 'switch', sale);
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
        await this.move(tx, task.posId, task.posDelta, actor.operatorId, task.action, note, sale);
        posted = true;
      }
      if (!posted && sale) await this.recordOp(tx, task.posId, actor.operatorId, task.action, sale);
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
      return this.taskNotice(tx, 'done', task, actor, {
        packageName: sale?.packageName ?? '',
        amount: postedAmount,
        handlerName: actor.nickname,
      });
    });
    await this.publishQuietly(written);
    return { ok: true };
  }

  // Facades (Phase 3): specs still call these; the routes live in tasks/tasks.controller.ts.
  async tasks(gate: Gate, query: {
      cursor?: string;
      q?: string;
      status?: string;
      action?: string;
      packageCode?: string;
      company?: string;
      provider?: string;
    } = {}) {
    return this.tasksDomain.list(await this.actor(gate), query);
  }

  async task(gate: Gate, id: string) {
    return this.tasksDomain.detail(await this.actor(gate), id);
  }

  async addTaskNote(gate: Gate, id: string, body: { text?: unknown }) {
    return this.tasksDomain.addNote(await this.actor(gate), id, body);
  }

  async takeTask(gate: Gate, id: string) {
    return this.tasksDomain.take(await this.actor(gate), id);
  }

  async releaseTask(gate: Gate, id: string) {
    return this.tasksDomain.release(await this.actor(gate), id);
  }

  async rejectTask(gate: Gate, id: string, body: { reason?: unknown }) {
    return this.tasksDomain.reject(await this.actor(gate), id, body);
  }

  async cancelTask(gate: Gate, id: string) {
    return this.tasksDomain.cancel(await this.actor(gate), id);
  }

  // Facades (Phase 3): specs still call these; the routes live in accounts/accounts.controller.ts.
  async users(gate: Gate) {
    return this.accountDesk.list(await this.actor(gate));
  }

  async directory(gate: Gate) {
    return this.accountDesk.directory(await this.actor(gate));
  }

  async createAccount(gate: Gate, body: { loginName?: unknown; nickname?: unknown; password?: unknown; layer?: unknown; parentLogin?: unknown; roleId?: unknown }) {
    return this.accountDesk.create(await this.actor(gate), body);
  }

  async setAccountPassword(gate: Gate, loginName: string, body: { password?: unknown }) {
    return this.accountDesk.setPassword(await this.actor(gate), loginName, body);
  }

  async account(gate: Gate, loginName: string) {
    return this.accountDesk.detail(await this.actor(gate), loginName);
  }

  async saveAccess(gate: Gate, loginName: string, body: { extraGrants?: unknown; deniedGrants?: unknown; extraRoleIds?: unknown; roleId?: unknown }) {
    return this.accountDesk.saveAccess(await this.actor(gate), loginName, body);
  }

  async setFrozen(gate: Gate, loginName: string, frozen: boolean) {
    return this.accountDesk.setFrozen(await this.actor(gate), loginName, frozen);
  }

  async removeUser(gate: Gate, loginName: string) {
    return this.accountDesk.remove(await this.actor(gate), loginName);
  }

  async enter(gate: Gate, loginName: string, meta: { userAgent: string; ip: string }) {
    return this.accountDesk.enter(await this.actor(gate), loginName, meta);
  }

  // Facades (Phase 3): specs still call these; the routes live in roles/roles.controller.ts.
  async roles(gate: Gate) {
    return this.roleDesk.list(await this.actor(gate));
  }

  async saveRole(gate: Gate, body: { id?: unknown; name?: unknown; grants?: unknown; read?: unknown; edit?: unknown; accounting?: unknown; tasks?: unknown; reports?: unknown; staff?: unknown; enter?: unknown }) {
    return this.roleDesk.save(await this.actor(gate), body);
  }

  // Facades (Phase 3): specs still call these; the routes live in transfers/transfers.controller.ts.
  async transferAccount(gate: Gate, loginName: string, body: TransferAccountBody) {
    return this.transferDesk.transferAccount(await this.actor(gate), loginName, body);
  }

  async transferPreview(gate: Gate, loginName: string, query: { parentLogin?: unknown }) {
    return this.transferDesk.transferPreview(await this.actor(gate), loginName, query);
  }

  async transferLine(gate: Gate, lineId: string, body: { posLogin?: unknown; linePrices?: unknown }) {
    return this.transferDesk.transferLine(await this.actor(gate), lineId, body);
  }

  // ---- Per-user package terms and operation stops -------------------------------------------

  // Facades (Phase 3): specs still call these; the routes live in terms/terms.controller.ts.
  async userPackages(gate: Gate, loginName: string) {
    return this.termDesk.userPackages(await this.actor(gate), loginName);
  }

  async setUserPackage(gate: Gate, loginName: string, code: string, body: { hidden?: unknown; price?: unknown; renewalPrice?: unknown }) {
    return this.termDesk.setUserPackage(await this.actor(gate), loginName, code, body);
  }

  async setUserPackagesBulk(gate: Gate, loginName: string, body: { codes?: unknown; hidden?: unknown }) {
    return this.termDesk.setUserPackagesBulk(await this.actor(gate), loginName, body);
  }

  async userOps(gate: Gate, loginName: string) {
    return this.termDesk.userOps(await this.actor(gate), loginName);
  }

  async setUserOps(gate: Gate, loginName: string, body: { denied?: unknown }) {
    return this.termDesk.setUserOps(await this.actor(gate), loginName, body);
  }

  async customPrices(gate: Gate, code: string) {
    return this.termDesk.customPrices(await this.actor(gate), code);
  }

  async setCustomPrice(gate: Gate, code: string, loginName: string, body: { price?: unknown; renewalPrice?: unknown }) {
    return this.termDesk.setCustomPrice(await this.actor(gate), code, loginName, body);
  }

  async clearCustomPrice(gate: Gate, code: string, loginName: string) {
    return this.termDesk.clearCustomPrice(await this.actor(gate), code, loginName);
  }

  async linePrices(gate: Gate, code: string, query: { scope?: unknown }) {
    return this.termDesk.linePrices(await this.actor(gate), code, query);
  }

  async setLinePrices(gate: Gate, code: string, body: { scope?: unknown; groups?: unknown }) {
    return this.termDesk.setLinePrices(await this.actor(gate), code, body);
  }

  // Facade (Phase 3): specs still call the service; the route lives in audit/audit.controller.ts.
  async audit(gate: Gate, query: Parameters<AuditService['list']>[1] = {}) {
    return this.auditLog.list(await this.actor(gate), query);
  }

  async report(gate: Gate, kind: string, cursor?: string) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    if (!actor.isBranchOwner && !actor.grants.includes('reports')) fail(403, 'REPORTS_BRANCH_ONLY');
    if (kind === 'providers') return this.providerReport();
    if (kind === 'operations') return this.entryReport(cursor, PROVIDER_OPERATION_KINDS);
    if (kind === 'tasks') {
      const listed = await this.tasks(gate, { cursor });
      return { tasks: listed.tasks, nextCursor: listed.nextCursor, total: listed.total };
    }
    if (kind === 'numbers') {
      const listed = await this.lines(gate, { cursor });
      return { lines: listed.lines, nextCursor: listed.nextCursor, total: listed.total };
    }
    fail(404, 'NOT_FOUND');
  }

  async companySwitch() {
    fail(400, 'INVALID');
  }

  private runsNow(pkg: Parameters<OfficeService['assertRunnable']>[0], action: ActionKey | 'unfreeze') {
    return resolvePackageMode(pkg.actionModes, pkg, action) === 'auto';
  }

  private operationsFor(line: {
    status: string;
    endsAt: Date;
    opsLocked?: boolean;
    package: Parameters<OfficeService['assertRunnable']>[0] & { company?: { esim?: boolean } | null };
    denied?: ReadonlySet<OpKey>;
  }): string[] {
    const denied = line.denied ?? new Set<OpKey>();
    const keys: string[] = offeredOperations(
      { status: line.status, endsAt: line.endsAt, opsLocked: line.opsLocked ?? false },
      (action) => resolvePackageMode(line.package.actionModes, line.package, action),
    );
    // An eSIM request is always a branch task: the employee attaches the serial and the QR picture.
    if (line.status === 'active' && !line.opsLocked && simRulesOf(line.package.company ?? null).esim) keys.push('esim');
    // A refresh is a provider operation on a live subscription: active numbers only, like the rest.
    if (line.status === 'active' && !line.opsLocked && refreshMode(line.package.actionModes) !== 'off') keys.push('refresh');
    return keys.filter((key) => {
      const stop = opKeyOf(key);
      return !stop || !denied.has(stop);
    });
  }

  private async restartDisconnected(actor: Actor, line: Awaited<ReturnType<OfficeService['visibleLine']>>, outcome: 'success' | 'fail') {
    if (line.status !== 'disconnected') fail(400, 'INVALID');
    this.assertRunnable(line.package, 'charge', line.denied);
    const charged = await this.resolveBuyPrice(line.posId, line.package, 'subscription', line.posPath);
    const posDelta = -charged;
    if (outcome === 'fail' || !this.runsNow(line.package, 'charge')) {
      const task = await this.openTask({
        action: 'charge', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false as const, taskId: task.id };
    }
    await this.runTx(async (tx) => {
      const endsAt = periodEnd(new Date(), line.package.months);
      await this.move(tx, line.posId, posDelta, actor.operatorId, 'charge', '', {
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
    const [known, { terms }] = await Promise.all([path ? Promise.resolve(path) : this.pathOf(userId, await this.accounts()), this.termsFor(pkg.id)]);
    return visibleTo(known, terms, pkg);
  }

  /** Switch targets saved on the package that the selling account may see. */
  private async visibleSwitchTargets(packageId: string, posPath: PathNode[]): Promise<string[]> {
    const saved = await this.prisma.packageSwitch.findMany({
      where: { packageId },
      select: { target: { select: { id: true, code: true, enabled: true, forSale: true } } },
    });
    if (saved.length === 0) return [];
    const terms = await this.prisma.userPackage.findMany({
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
    const [path, { terms, sells }] = await Promise.all([known ? Promise.resolve(known) : this.pathOf(userId, await this.accounts()), this.termsFor(pkg.id)]);
    if (path.length === 0) return buyPriceFor([{ id: userId, loginName: '', layer: 'pos', deniedOps: '' }], [], [], pkg, kind);
    return buyPriceFor(path, terms, sells, pkg, kind);
  }

  /**
   * Writes into terms about to be saved the renewal price the point of sale would pay today, for the
   * package and for each of its renewal targets: custom price, else the parent's sell price, else the
   * layer column. One read per table serves every package named in the terms. A point of sale that is
   * not in the tree leaves the terms as captured.
   */
  private async stampFor(
    terms: LineTerms,
    posId: string,
    known?: PathNode[],
    db: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<LineTerms> {
    const path = known ?? this.pathOf(posId, await this.accounts());
    if (path.length === 0) return terms;
    const codes = [...new Set([terms.packageCode, ...terms.renewalTargets.map((target) => target.code)])];
    return this.stampWith(terms, path, await this.ladderRows(codes, path.map((node) => node.id), db));
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
      const existing = await this.prisma.line.findUnique({ where: { msisdn } });
      if (!existing) return msisdn;
    }
    throw new OfficeFailure(400, 'INVALID');
  }

  private async providerReport() {
    const rows = await this.prisma.package.findMany({
      where: { companyId: { not: null } },
      include: { provider: true, company: true, _count: { select: { lines: true } } },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' } ],
    });
    return {
      total: rows.length,
      rows: rows.map((row) => ({
        providerName: row.provider.name,
        companyName: row.company?.name ?? '',
        packageName: row.name,
        price: row.branchCost,
        lines: row._count.lines,
      })),
    };
  }

  private async entryReport(cursor: string | undefined, kinds?: string[]) {
    const where = kinds ? { kind: { in: kinds } } : {};
    const [read, total] = await Promise.all([
      this.prisma.walletEntry.findMany({
        where: { ...where, AND: afterFeed(feedPosition(cursor)) },
        include: { user: true, actor: true },
        orderBy: [...NEWEST_FIRST],
        take: FEED_PAGE + 1,
      }),
      this.prisma.walletEntry.count({ where }),
    ]);
    const { page: rows, nextCursor } = mergeFeed([read], FEED_PAGE);
    return {
      total,
      entries: rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        loginName: row.user.loginName,
        actorLogin: row.actor.loginName,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        kind: row.kind,
        note: row.note,
      })),
      nextCursor,
    };
  }

  private async ensureCatalog(): Promise<void> {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      await this.prisma.wallet.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, balance: 0, ceiling: 0 },
      });
    }
    // Migrations insert companies on their own, so only providers say the catalog was seeded.
    const seeded = await this.prisma.provider.count();
    if (seeded > 0) return;
    for (const company of companies) {
      await this.prisma.company.upsert({
        where: { code: company.code },
        update: { name: company.name },
        create: { code: company.code, name: company.name },
      });
    }
    for (const provider of catalog) {
      const savedProvider = await this.prisma.provider.upsert({
        where: { code: provider.code },
        update: { name: provider.name },
        create: { code: provider.code, name: provider.name },
      });
      // New packages copy provider defaults once; package rows stay independent after create.
      const flags = packageFlagsFromModes(normalizeActionModes(savedProvider.actionModes));
      for (const company of provider.companies) {
        const savedCompany = await this.prisma.company.findUnique({ where: { code: company.code } });
        if (!savedCompany) continue;
        for (const item of company.packages) {
          await this.prisma.package.upsert({
            where: { code: packageCode(provider.code, company.code, item) },
            update: {},
            create: {
              code: packageCode(provider.code, company.code, item),
              name: packageName(item),
              providerId: savedProvider.id,
              companyId: savedCompany.id,
              dataGb: item.gb,
              months: item.months,
              forSale: item.forSale,
              branchCost: item.subscription.branchCost * AGOROT,
              mainPrice: item.subscription.mainPrice * AGOROT,
              agentPrice: item.subscription.agentPrice * AGOROT,
              posPrice: item.subscription.posPrice * AGOROT,
              subscriberPrice: item.subscription.subscriberPrice * AGOROT,
              renewalBranchCost: item.renewal.branchCost * AGOROT,
              renewalMainPrice: item.renewal.mainPrice * AGOROT,
              renewalAgentPrice: item.renewal.agentPrice * AGOROT,
              renewalPosPrice: item.renewal.posPrice * AGOROT,
              renewalSubscriberPrice: item.renewal.subscriberPrice * AGOROT,
              ...flags,
              actionModes: normalizeActionModes(savedProvider.actionModes),
            },
          });
        }
      }
    }
  }
}

/** A QR picture as a data URL. `undefined` when absent, `null` when cleared, otherwise the checked URL. */
function readQr(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > QR_LIMIT || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) fail(400, 'QR_INVALID');
  return value;
}

function asOutcome(value: unknown): 'success' | 'fail' | null {
  if (value === 'success' || value === 'fail') return value;
  return null;
}

/** The stop key an operation answers to. `unfreeze` follows `freeze`; a restart is a `charge`. */
function opKeyOf(action: string): OpKey | null {
  if (action === 'unfreeze') return 'freeze';
  if (action === 'reactivate') return 'charge';
  return isOpKey(action) ? action : null;
}

function canActivateFor(actor: Actor, pos: Account, accounts: Account[]): boolean {
  if (!visibleAccountIds(actor.id, actor.layer, accounts).has(pos.id)) return false;
  if (actor.layer === 'pos') return actor.id === pos.id;
  return true;
}
