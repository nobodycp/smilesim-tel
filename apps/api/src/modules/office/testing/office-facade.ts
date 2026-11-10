import { DeskRepository } from '../desk/desk.repository';
import { ProvidersRepository } from '../providers/providers.repository';
import { LinesRepository } from '../lines/lines.repository';
import { TasksRepository } from '../tasks/tasks.repository';
import { WalletsRepository } from '../wallets/wallets.repository';
import { TransfersRepository } from '../transfers/transfers.repository';
import { TermsRepository } from '../terms/terms.repository';
import { PackagesRepository } from '../packages/packages.repository';
import { CompaniesRepository } from '../companies/companies.repository';
import { AccountsRepository } from '../accounts/accounts.repository';
import { OfficeGraph } from './office-graph';
import { PrismaService } from '../../shared/prisma.service';
import { Prisma, PrismaClient } from '../../../generated/prisma/client';
import { AuthStore } from '../../auth/auth.store';
import type { LineFilter } from '../rules/office-paging';
import { NoticeService } from '../notices/notice.service';
import { LinePricing } from '../lines/line-pricing';
import { LineReads } from '../lines/line-reads';
import { LinesService } from '../lines/lines.service';
import { TaskCompletion } from '../lines/task-completion';
import { SimulatedProviderGateway } from '../providers/gateway/simulated-gateway';
import { TransfersService } from '../transfers/transfers.service';
import { AccountsService } from '../accounts/accounts.service';
import { DeskService } from '../desk/desk.service';
import { RolesService } from '../roles/roles.service';
import { TermsService } from '../terms/terms.service';
import { PackagesService } from '../packages/packages.service';
import { CompaniesService } from '../companies/companies.service';
import { ProvidersService } from '../providers/providers.service';
import { WalletsService } from '../wallets/wallets.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../tasks/tasks.service';
import type { Gate, Sale } from '../kernel/types';
import type { TransferAccountBody } from '../transfers/transfers.service';

/**
 * Test-only adapter: the office methods as the specs have always called them, `(gate, ...)`, each
 * resolving the actor and handing the call to the domain service that owns it. Production code never uses it;
 * every route lives in a domain controller under `modules/office/<domain>/`.
 */
export class OfficeFacade {
  /** Shared by every office domain: the client, the actor, accounts, transactions, wallet moves (testing/office-graph.ts). */
  private readonly graph: OfficeGraph;

  // The members below without `private` are the hooks specs reach in by: the client, the notice writer, a
  // transaction, a wallet move, the price stamp.
  // Specs replace the client through this property; it lives on the unit of work so the domain services see the same one.
  get prismaClient(): PrismaClient | null {
    return this.graph.prismaClient;
  }

  set prismaClient(client: PrismaClient | null) {
    this.graph.prismaClient = client;
  }

  get prisma(): PrismaClient {
    return this.graph.uow.prisma;
  }

  get notice(): NoticeService {
    return this.graph.uow.notice;
  }

  private auditService: AuditService | null = null;

  private get auditLog(): AuditService {
    this.auditService ??= new AuditService(this.graph.uow, this.graph.tree);
    return this.auditService;
  }

  private tasksService: TasksService | null = null;

  private get tasksDomain(): TasksService {
    this.tasksService ??= new TasksService(this.graph.uow, this.graph.tree, this.graph.actors, this.graph.ledger, new TasksRepository(this.graph.uow));
    return this.tasksService;
  }

  constructor(
    auth: AuthStore,
    notice?: NoticeService,
    db?: PrismaService,
    graph?: OfficeGraph,
  ) {
    this.graph = graph ?? new OfficeGraph(auth, notice, db);
  }

  private walletDeskInstance: WalletsService | null = null;

  private get walletDesk(): WalletsService {
    this.walletDeskInstance ??= new WalletsService(this.graph.uow, this.graph.tree, this.graph.ledger, this.graph.ladder, new WalletsRepository(this.graph.uow));
    return this.walletDeskInstance;
  }

  private providerDeskInstance: ProvidersService | null = null;

  private get providerDesk(): ProvidersService {
    this.providerDeskInstance ??= new ProvidersService(this.graph.uow, new ProvidersRepository(this.graph.uow));
    return this.providerDeskInstance;
  }

  private companyDeskInstance: CompaniesService | null = null;

  private get companyDesk(): CompaniesService {
    this.companyDeskInstance ??= new CompaniesService(this.graph.uow, new CompaniesRepository(this.graph.uow));
    return this.companyDeskInstance;
  }

  private packageDeskInstance: PackagesService | null = null;

  private get packageDesk(): PackagesService {
    this.packageDeskInstance ??= new PackagesService(this.graph.uow, this.graph.tree, this.graph.ladder, new PackagesRepository(this.graph.uow));
    return this.packageDeskInstance;
  }

  private termDeskInstance: TermsService | null = null;

  private get termDesk(): TermsService {
    this.termDeskInstance ??= new TermsService(this.graph.uow, this.graph.tree, this.graph.ladder, new TermsRepository(this.graph.uow));
    return this.termDeskInstance;
  }

  private roleDeskInstance: RolesService | null = null;

  private get roleDesk(): RolesService {
    this.roleDeskInstance ??= new RolesService(this.graph.uow, this.graph.layerRoles);
    return this.roleDeskInstance;
  }

  private deskDeskInstance: DeskService | null = null;

  private get deskDesk(): DeskService {
    this.deskDeskInstance ??= new DeskService(this.graph.uow, this.graph.tree, new DeskRepository(this.graph.uow));
    return this.deskDeskInstance;
  }

  private accountDeskInstance: AccountsService | null = null;

  private get accountDesk(): AccountsService {
    this.accountDeskInstance ??= new AccountsService(this.graph.uow, this.graph.tree, this.graph.layerRoles, this.graph.auth, new AccountsRepository(this.graph.uow), this.graph.ledger);
    return this.accountDeskInstance;
  }

  private transferDeskInstance: TransfersService | null = null;

  private get transferDesk(): TransfersService {
    this.transferDeskInstance ??= new TransfersService(this.graph.uow, this.graph.tree, this.graph.ledger, this.graph.lineAccess, this.termDesk, new TransfersRepository(this.graph.uow));
    return this.transferDeskInstance;
  }

  private lineDeskInstance: LinesService | null = null;

  private get lineDesk(): LinesService {
    this.lineDeskInstance ??= new LinesService(this.graph.uow, this.graph.tree, this.graph.ledger, this.graph.ladder, this.graph.lineAccess, this.tasksDomain, this.linePricing, new TaskCompletion(this.graph.uow, this.graph.ledger, this.tasksDomain, this.linePricing, new LinesRepository(this.graph.uow)), new SimulatedProviderGateway(), new LinesRepository(this.graph.uow));
    return this.lineDeskInstance;
  }

  private linePricingInstance: LinePricing | null = null;

  private get linePricing(): LinePricing {
    this.linePricingInstance ??= new LinePricing(this.graph.uow, this.graph.tree, this.graph.ladder, new LinesRepository(this.graph.uow));
    return this.linePricingInstance;
  }

  private get lineReads(): LineReads {
    return new LineReads(this.graph.uow, this.graph.tree, new LinesRepository(this.graph.uow));
  }

  // user-terms-service.spec stamps terms through the service; the stamping lives in LinesService.
  stampFor(...args: Parameters<LinePricing['stampFor']>) {
    return this.linePricing.stampFor(...args);
  }

  private actor(gate: Gate) {
    return this.graph.actors.actor(gate);
  }

  runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.graph.uow.runTx(fn);
  }

  move(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, kind: string, note: string, sale?: Sale) {
    return this.graph.ledger.move(tx, userId, amount, actorId, kind, note, sale);
  }

  // Spec entry points; the routes live in desk/desk.controller.ts.
  async me(gate: Gate) {
    return this.deskDesk.me(await this.actor(gate));
  }

  async home(gate: Gate) {
    return this.deskDesk.home(await this.actor(gate));
  }

  // Spec entry points; the routes live in wallets/wallets.controller.ts.
  async wallets(gate: Gate) {
    return this.walletDesk.list(await this.actor(gate));
  }

  async fund(gate: Gate, loginName: string, body: unknown) {
    return this.walletDesk.fund(await this.actor(gate), loginName, body);
  }

  async setCeiling(gate: Gate, loginName: string, body: unknown) {
    return this.walletDesk.setCeiling(await this.actor(gate), loginName, body);
  }

  async ledger(gate: Gate, query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string }) {
    return this.walletDesk.ledger(await this.actor(gate), query);
  }

  async providerOperations(gate: Gate, query: { cursor?: string; kind?: string; provider?: string; q?: string; from?: string; to?: string } = {}) {
    return this.walletDesk.providerOperations(await this.actor(gate), query);
  }

  async finance(gate: Gate, query: { cursor?: string; kind?: string; layer?: string; q?: string; from?: string; to?: string; scope?: string } = {}) {
    return this.walletDesk.finance(await this.actor(gate), query);
  }

  // Spec entry points; the routes live in packages/packages.controller.ts.
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

  async setPackageDetails(gate: Gate, code: string, body: Record<string, unknown>) {
    return this.packageDesk.setDetails(await this.actor(gate), code, body);
  }

  async setPackageTargets(gate: Gate, code: string, kind: 'renewals' | 'switches', body: { targets?: unknown }) {
    return this.packageDesk.setTargets(await this.actor(gate), code, kind, body);
  }

  // Spec entry points; the routes live in companies/companies.controller.ts.
  async companiesShelf(gate: Gate) {
    return this.companyDesk.shelf(await this.actor(gate));
  }

  async setCompanySim(gate: Gate, code: string, body: { length?: unknown; prefix?: unknown; esim?: unknown; esimPrice?: unknown }) {
    return this.companyDesk.setSim(await this.actor(gate), code, body);
  }

  // Spec entry points; the routes live in providers/providers.controller.ts.
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

  // Spec entry points; the routes live in lines/lines.controller.ts.
  async lines(gate: Gate, query: LineFilter & { cursor?: string; loginName?: string } = {}) {
    return this.lineReads.list(await this.actor(gate), query);
  }

  async line(gate: Gate, id: string) {
    return this.lineReads.detail(await this.actor(gate), id);
  }

  async activate(gate: Gate, body: Record<string, unknown>) {
    return this.lineDesk.activate(await this.actor(gate), body);
  }

  async requestAddon(gate: Gate, lineId: string, body: Record<string, unknown>) {
    return this.lineDesk.requestAddon(await this.actor(gate), lineId, body);
  }

  async operate(gate: Gate, lineId: string, action: 'charge' | 'disconnect' | 'freeze' | 'unfreeze', body: { outcome?: unknown }) {
    return this.lineDesk.operate(await this.actor(gate), lineId, action, body);
  }

  async disconnectQuote(gate: Gate, lineId: string) {
    return this.lineDesk.disconnectQuote(await this.actor(gate), lineId);
  }

  async switchPackage(gate: Gate, lineId: string, body: { packageCode?: unknown; outcome?: unknown }) {
    return this.lineDesk.switchPackage(await this.actor(gate), lineId, body);
  }

  async extend(gate: Gate, lineId: string, body: { outcome?: unknown; targetCode?: unknown }) {
    return this.lineDesk.extend(await this.actor(gate), lineId, body);
  }

  async reactivate(gate: Gate, lineId: string, body: { outcome?: unknown }) {
    return this.lineDesk.reactivate(await this.actor(gate), lineId, body);
  }

  async refreshLine(gate: Gate, lineId: string, body: { outcome?: unknown }) {
    return this.lineDesk.refresh(await this.actor(gate), lineId, body);
  }

  async renameLine(gate: Gate, lineId: string, body: { msisdn?: unknown; outcome?: unknown }) {
    return this.lineDesk.rename(await this.actor(gate), lineId, body);
  }

  async swapSim(gate: Gate, lineId: string, body: { iccid?: unknown; esim?: unknown; qr?: unknown; outcome?: unknown }) {
    return this.lineDesk.swapSim(await this.actor(gate), lineId, body);
  }

  async requestEsim(gate: Gate, lineId: string) {
    return this.lineDesk.requestEsim(await this.actor(gate), lineId);
  }

  async completeTask(gate: Gate, id: string, body: { note?: unknown; iccid?: unknown; qr?: unknown; msisdn?: unknown }) {
    return this.lineDesk.completeTask(await this.actor(gate), id, body);
  }

  // Spec entry points; the routes live in tasks/tasks.controller.ts.
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

  // Spec entry points; the routes live in accounts/accounts.controller.ts.
  async users(gate: Gate) {
    return this.accountDesk.page(await this.actor(gate), {});
  }

  async directory(gate: Gate) {
    return this.accountDesk.directory(await this.actor(gate));
  }

  async createAccount(gate: Gate, body: { loginName?: unknown; nickname?: unknown; password?: unknown; layer?: unknown; parentLoginName?: unknown; roleId?: unknown }) {
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

  // Spec entry points; the routes live in roles/roles.controller.ts.
  async roles(gate: Gate) {
    return this.roleDesk.list(await this.actor(gate));
  }

  // Spec entry points; the routes live in transfers/transfers.controller.ts.
  async transferAccount(gate: Gate, loginName: string, body: TransferAccountBody) {
    return this.transferDesk.transferAccount(await this.actor(gate), loginName, body);
  }

  async transferPreview(gate: Gate, loginName: string, query: { parentLoginName?: unknown }) {
    return this.transferDesk.transferPreview(await this.actor(gate), loginName, query);
  }

  async transferLine(gate: Gate, lineId: string, body: { posLoginName?: unknown; linePrices?: unknown }) {
    return this.transferDesk.transferLine(await this.actor(gate), lineId, body);
  }

  // ---- Per-user package terms and operation stops -------------------------------------------

  // Spec entry points; the routes live in terms/terms.controller.ts.
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

  // Spec entry point; the route lives in audit/audit.controller.ts.
  async audit(gate: Gate, query: Parameters<AuditService['list']>[1] = {}) {
    return this.auditLog.list(await this.actor(gate), query);
  }

}

