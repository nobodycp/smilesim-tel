import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { createPrismaClient } from '../../db';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { AUTH_STORE, AuthStore } from '../auth/auth.store';
import { hashPassword } from '../auth/password';
import { ERROR_MESSAGES, type ErrorCode } from '../../errors';
import { newPasswordProblem, fullNameProblem } from '../auth/validators';
import { catalog, companies, packageCode, packageName } from './office-catalog';
import {
  FEED_PAGE,
  LINES_PAGE,
  NEWEST_FIRST,
  NOTICES_PAGE,
  TASKS_PAGE,
  afterFeed,
  decodeFeedCursor,
  encodeFeedCursor,
  idCursorArgs,
  linesWhere,
  mergeFeed,
  pageOf,
  taskStatusOf,
  type LineFilter,
} from './office-paging';
import { parseTaskLogLine, stampTaskLog } from './task-log';
import {
  AGOROT,
  ESIM_PRICE_DEFAULT,
  activationProviderCost,
  esimPriceOf,
  PERIOD_DAYS,
  Prices,
  captureTerms,
  chainHolds,
  editableField,
  ACTION_KEYS,
  activateInputs,
  flagsForMode,
  lastWindow,
  normalizeActionModes,
  offeredOperations,
  openPeriods,
  packageFlagsFromModes,
  resolvePackageMode,
  periodEnd,
  providerBranchCost,
  renewOnto,
  refreshMode,
  renewStay,
  readSimRules,
  revalue,
  settleDisconnect,
  simRefusal,
  issueSerial,
  simRulesOf,
  switchOnto,
  switchOver,
  windowMonthsOf,
  visibleAccountIds,
  withinCeiling,
  type ActionKey,
  type ActionMode,
  type LineTerms,
  type PackageTerms,
} from './office-rules';
import { activityActorFilter, clampActivityRange } from './activity-log';
import { RENEWABLE_STATUSES, groupChanges, groupLinePrices, repriceLine, stampRenewal, type PriceGroup } from './line-prices';
import { packageTermsOf, type PackagePriceRow } from './office-terms';
import { TRANSFER_GRANT, canTransfer, parseChoice, parseLineChoice, previewOf, transferKind } from './transfer-rules';
import { buyPriceFor, deniedAbove, deniedOpsFor, floorFor, hiddenAbove, isOpKey, layerPrice, parseOps, priceSource, serializeOps, visibleTo, type LayerPrices, type OpKey, type PathNode, type PriceKind, type PriceSource, type SellRow, type TermRow } from './user-terms';
import { renderEsimQr } from './office-esim';
import { canHandleTasks, taskAudience, taskReaders, taskWhereFor, type TaskEvent } from './task-access';
import { NoticeService, type WrittenNotice } from './notice.service';
import { excerpt, noticeGroupOf, NOTICE_GROUPS, type TaskNoticePayload } from './notice-kinds';
import {
  FLAG_CODES,
  GRANT_CODES,
  LAYER_GRANTS,
  effectiveGrantCodes,
  flagsFor,
  roleGrantCodes,
  splitGrants,
} from './office-grants';


const MODE_FIELDS: Record<string, { auto: string; allow: string }> = {
  activate: { auto: 'autoActivate', allow: 'allowActivate' },
  charge: { auto: 'autoCharge', allow: 'allowCharge' },
  extend: { auto: 'autoExtend', allow: 'allowExtend' },
  disconnect: { auto: 'autoDisconnect', allow: 'allowDisconnect' },
  freeze: { auto: 'autoFreeze', allow: 'allowFreeze' },
  switch: { auto: 'autoSwitch', allow: 'allowSwitch' },
  rename: { auto: 'autoRename', allow: 'allowRename' },
  sim: { auto: 'autoSim', allow: 'allowSim' },
};
const LAYER_ORDER = ['branch', 'main_agent', 'agent', 'pos'];

type Gate = { sessionId?: string; homeId?: string };
type Actor = {
  id: string;
  loginName: string;
  nickname: string;
  layer: string;
  isBranchOwner: boolean;
  grants: string[];
  operatorId: string;
  impersonating: boolean;
};
type Account = { id: string; loginName: string; nickname: string; layer: string; parentId: string | null; deniedOps: string; disabledAt: Date | null };
type PackageFacts = { id: string; code: string; name: string; dataGb: number | null; months: number; company?: { code: string } | null } & LayerPrices;
type TermPatch = { hidden?: boolean; price?: number | null; renewalPrice?: number | null };
export type UserPackageRow = {
  code: string;
  name: string;
  dataGb: number | null;
  months: number;
  companyCode: string;
  hidden: boolean;
  hiddenAbove: string | null;
  parentBuy: number;
  parentRenewalBuy: number;
  price: number | null;
  renewalPrice: number | null;
  effective: number;
  renewalEffective: number;
  source: PriceSource;
  /** Renewable lines of this package on points of sale in this user's subtree. */
  lines: number;
};
export type CustomPriceRow = {
  loginName: string;
  nickname: string;
  layer: string;
  parentLogin: string;
  defaultPrice: number;
  defaultRenewalPrice: number;
  price: number | null;
  renewalPrice: number | null;
};
/** What a line-prices request covers: the whole system, or one account and everything under it. */
type LineScope = { kind: 'all' } | { kind: 'account'; id: string; loginName: string; layer: string };
/** What happens to one number: a flat price, or what a new activation would carry now. */
type LineTarget = { to: number | 'current' };
type RepriceLine = { id: string; posId: string; terms: Prisma.JsonValue; package: PackagePriceRow & { id: string } };
/** The price columns of a package that `LayerPrices` holds, as a `select`. */
const PRICE_COLUMNS = {
  branchCost: true,
  mainPrice: true,
  agentPrice: true,
  posPrice: true,
  renewalBranchCost: true,
  renewalMainPrice: true,
  renewalAgentPrice: true,
  renewalPosPrice: true,
} as const;
/** What decides the prices points of sale pay for some packages: their price columns, the custom rows on them, and the sell prices of the accounts above. */
type LadderRows = {
  packages: (LayerPrices & { id: string; code: string })[];
  termRows: (TermRow & { packageId: string })[];
  sellRows: (SellRow & { packageId: string })[];
};
type Action = 'activate' | 'charge' | 'extend' | 'reactivate' | 'disconnect' | 'freeze' | 'unfreeze' | 'switch' | 'rename' | 'sim' | 'esim' | 'refresh';
type Sale = {
  msisdn: string;
  lineId: string;
  companyName: string;
  packageName: string;
  packagePrice: number;
  providerCost?: number;
  /** The eSIM fee that is part of this entry's amount, so the finance row can explain amount − package price. */
  esimPrice?: number;
  /** The period a prepaid row bought. A switch has no end: it reprices the open periods. */
  period?: { days: number; endsAt: Date | null };
};

const PREPAID_KINDS = ['activate', 'charge', 'extend', 'reactivate', 'switch'];
/** Entries that put time on a line: the newest one is the last recharge shown on the card. */
const RECHARGE_KINDS = ['activate', 'charge', 'extend', 'reactivate'];
/** The largest QR data URL stored on a line. The client shrinks to about 300 KB first. */
const QR_LIMIT = 400_000;

function periodOf(months: number, endsAt: Date | null) {
  return { days: PERIOD_DAYS * Math.max(1, months), endsAt };
}

export class OfficeFailure extends Error {
  constructor(readonly status: number, readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
  }
}

function fail(status: number, code: ErrorCode): never {
  throw new OfficeFailure(status, code);
}

/** An account as one step of a path. */
function nodeOf(account: Account): PathNode {
  return { id: account.id, loginName: account.loginName, layer: account.layer, deniedOps: account.deniedOps ?? '' };
}

/** What a move is asked to do. Every field is checked before it is used, so each arrives as `unknown`. */
type TransferAccountBody = {
  parentLogin?: unknown;
  ownPrices?: unknown;
  ownStops?: unknown;
  childPrices?: unknown;
  childStops?: unknown;
  linePrices?: unknown;
};

/**
 * The choices that hold whatever is moved. None has a default: a move that leaves one out, or words one in
 * any other way, is `null`. A choice about what is below the account may be left out here, because only an
 * agent has anything below it, but one that is stated has to be a word. Nothing here reads an account, so a
 * body that cannot be a move is refused before any is read, and says nothing about what exists.
 */
function statedChoices(body: TransferAccountBody) {
  const ownPrices = parseChoice(body.ownPrices);
  const ownStops = parseChoice(body.ownStops);
  const linePrices = parseLineChoice(body.linePrices);
  if (!ownPrices || !ownStops || !linePrices) return null;
  const childPrices = body.childPrices === undefined ? undefined : parseChoice(body.childPrices);
  const childStops = body.childStops === undefined ? undefined : parseChoice(body.childStops);
  if (childPrices === null || childStops === null) return null;
  return { ownPrices, ownStops, linePrices, childPrices, childStops };
}

/**
 * The choices of a move once its kind is known. Only an agent has anything below it to choose for, so a
 * point of sale that states a choice about what is below it is as wrong as an agent that leaves one out.
 */
function transferChoices(kind: 'pos' | 'agent', stated: NonNullable<ReturnType<typeof statedChoices>>) {
  const { childPrices, childStops, ...own } = stated;
  if (kind === 'pos') return childPrices === undefined && childStops === undefined ? { ...own, child: null } : null;
  return childPrices && childStops ? { ...own, child: { prices: childPrices, stops: childStops } } : null;
}

function feedPosition(raw: string | undefined) {
  const position = decodeFeedCursor(raw);
  if (position === null) fail(400, 'INVALID');
  return position;
}

const PROVIDER_OPERATION_KINDS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'transfer'];

type PricedPackage = {
  id: string;
  name: string;
  dataGb: number | null;
  months: number;
  branchCost: number;
  renewalBranchCost: number;
  provider: { code: string; name: string };
  company: { name: string } | null;
};

function packageLabel(item: { name: string; dataGb: number | null; months: number }): string {
  if (item.dataGb == null) return item.name;
  return item.months === 1 ? `${item.dataGb} جيجا` : `${item.dataGb} جيجا · ${item.months} أشهر`;
}

function samePackage(item: PricedPackage, packageName: string, companyName: string): boolean {
  if ((item.company?.name ?? '') !== companyName) return false;
  return item.name === packageName || packageLabel(item) === packageName;
}

function savedTerms(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as { subscription?: { branchCost?: number }; renewal?: { branchCost?: number } };
}

function pricedOp(
  kind: string,
  packageName: string,
  companyName: string,
  line: { terms: Prisma.JsonValue; package: PricedPackage } | undefined,
  packages: PricedPackage[],
) {
  const named = packages.find((item) => samePackage(item, packageName, companyName));
  const current = line?.package;
  const chosen = named ?? current ?? null;
  const same = chosen != null && current != null && chosen.id === current.id;
  return {
    cost: providerBranchCost(kind, same ? savedTerms(line?.terms) : null, chosen),
    providerCode: chosen?.provider.code ?? '',
    providerName: chosen?.provider.name ?? '',
  };
}

@Injectable()
export class OfficeService implements OnModuleInit {
  private prismaClient: PrismaClient | null = null;

  private get prisma(): PrismaClient {
    this.prismaClient ??= createPrismaClient();
    return this.prismaClient;
  }

  private readonly notice: NoticeService;

  constructor(@Inject(AUTH_STORE) private readonly auth: AuthStore, @Optional() notice?: NoticeService) {
    this.notice = notice ?? new NoticeService();
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) return;
    await this.ensureCatalog();
    await this.ensureLayerRoles();
  }

  async me(gate: Gate) {
    const actor = await this.actor(gate);
    const [wallet, accounts] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId: actor.id } }),
      this.accounts(),
    ]);
    return {
      loginName: actor.loginName,
      nickname: actor.nickname,
      layer: actor.layer,
      isBranchOwner: actor.isBranchOwner,
      grants: actor.grants,
      // The stops on the actor's own path, own node included. `transfer` is judged on the actor, so the
      // browser needs them to hide what the server would refuse.
      stops: parseOps(serializeOps([...deniedOpsFor(this.pathOf(actor.id, accounts))])),
      impersonating: actor.impersonating,
      balance: wallet?.balance ?? 0,
      ceiling: wallet?.ceiling ?? 0,
    };
  }

  async home(gate: Gate) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const chain = this.chainIds(actor.id, accounts);
    const taskWhere = { ...taskWhereFor(actor, accounts), status: 'pending' };
    const [pendingTasks, activeLines, inactiveLines, entries, notes] = await Promise.all([
      this.prisma.officeTask.count({ where: taskWhere }),
      posIds.length ? this.prisma.line.count({ where: { posId: { in: posIds }, status: 'active' } }) : 0,
      posIds.length ? this.prisma.line.count({ where: { posId: { in: posIds }, status: 'disconnected' } }) : 0,
      posIds.length
        ? this.prisma.walletEntry.findMany({
            where: { userId: { in: posIds }, kind: { in: ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch'] } },
            orderBy: { createdAt: 'desc' },
            take: 8,
            include: { user: true },
          })
        : [],
      this.prisma.announcement.findMany({
        where: { authorId: { in: chain } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { author: true },
      }),
    ]);
    return {
      pendingTasks,
      activeLines,
      inactiveLines,
      canPost: actor.layer !== 'pos',
      operations: entries.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        kind: row.kind,
        amount: row.amount,
        note: row.note,
        packageName: row.packageName,
        loginName: row.user.loginName,
      })),
      announcements: notes.map((row) => ({
        id: row.id,
        body: row.body,
        at: row.createdAt.toISOString(),
        authorName: row.author.nickname || row.author.loginName,
        authorLayer: row.author.layer,
      })),
    };
  }

  async postAnnouncement(gate: Gate, body: { body?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.layer === 'pos') fail(403, 'FORBIDDEN');
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text || text.length > 400) fail(400, 'INVALID');
    const accounts = await this.accounts();
    const audience = [...visibleAccountIds(actor.id, actor.layer, accounts)].filter((id) => id !== actor.id);
    await this.runTx(async (tx) => {
      const posted = await tx.announcement.create({ data: { authorId: actor.id, body: text } });
      this.queueNotices(tx, await this.notice.write(tx, audience, actor, {
        kind: 'announcement',
        payload: { announcementId: posted.id, authorName: actor.nickname, excerpt: excerpt(text) },
      }));
    });
    return { ok: true };
  }

  async wallets(gate: Gate) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const rows = await this.prisma.wallet.findMany({ where: { userId: { in: [...visible] } } });
    const byUser = new Map(rows.map((row) => [row.userId, row]));
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return {
      wallets: accounts
        .filter((account) => visible.has(account.id))
        .map((account) => ({
          loginName: account.loginName,
          nickname: account.nickname,
          layer: account.layer,
          balance: byUser.get(account.id)?.balance ?? 0,
          ceiling: byUser.get(account.id)?.ceiling ?? 0,
          parentLogin: account.parentId ? byId.get(account.parentId)?.loginName ?? null : null,
          self: account.id === actor.id,
          directChild: account.parentId === actor.id,
        })),
    };
  }

  async fund(gate: Gate, loginName: string, body: { amount?: unknown; note?: unknown }) {
    const actor = await this.actor(gate);
    const amount = positive(body.amount);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!amount) fail(400, 'INVALID');
    const accounts = await this.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target) fail(404, 'NOT_FOUND');
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    if (!visible.has(target.id)) fail(403, 'FORBIDDEN');
    const self = target.id === actor.id;
    if (self) {
      if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
      if (!note) fail(400, 'NOTE_REQUIRED');
    } else if (actor.layer !== 'branch' && target.parentId !== actor.id) {
      fail(403, 'FORBIDDEN');
    }
    await this.runTx(async (tx) => {
      if (!self) await this.move(tx, actor.id, -amount, actor.operatorId, 'fund', note);
      await this.move(tx, target.id, amount, actor.operatorId, self ? 'self_fund' : 'fund', note);
      if (!self) {
        this.queueNotices(tx, await this.notice.write(tx, [target.id], actor, {
          kind: 'fund.received',
          payload: { amount, senderName: actor.nickname, note },
        }));
      }
    });
    return { ok: true };
  }

  async setCeiling(gate: Gate, loginName: string, body: { ceiling?: unknown }) {
    const actor = await this.actor(gate);
    const ceiling = nonNegative(body.ceiling);
    if (ceiling === null || ceiling > 100_000_000) fail(400, 'INVALID');
    const accounts = await this.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target || target.parentId !== actor.id) fail(403, 'FORBIDDEN');
    await this.prisma.wallet.update({ where: { userId: target.id }, data: { ceiling } });
    return { ok: true };
  }

  async packages(gate: Gate) {
    const actor = await this.actor(gate);
    const field = editableField(actor.layer);
    const [all, accounts] = await Promise.all([
      this.prisma.package.findMany({
        where: { companyId: { not: null }, enabled: true, forSale: true },
        include: { provider: true, company: true },
        orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' }],
      }),
      this.accounts(),
    ]);
    const path = this.pathOf(actor.id, accounts);
    // Only the rows on the actor's path matter: its own terms and sell prices plus its ancestors'.
    const pathIds = path.map((node) => node.id);
    const [termRows, sellRows] = await Promise.all([
      this.prisma.userPackage.findMany({
        where: { userId: { in: pathIds } },
        select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
      }),
      this.prisma.sellPrice.findMany({
        where: { ownerId: { in: pathIds } },
        select: { packageId: true, ownerId: true, price: true, renewalPrice: true },
      }),
    ]);
    const canActivate = !deniedOpsFor(path).has('activate');
    const termsOf = (packageId: string) => termRows.filter((row) => row.packageId === packageId);
    const sellsOf = (packageId: string) => sellRows.filter((row) => row.packageId === packageId);
    const rows = all.filter((row) => visibleTo(path, termsOf(row.id), row));
    // The layer the actor sells to; null for the branch (no sell price) and the point of sale.
    const sellsTo = actor.layer === 'main_agent' ? 'agent' : actor.layer === 'agent' ? 'pos' : null;
    const ownSell = (packageId: string) => sellRows.find((row) => row.packageId === packageId && row.ownerId === actor.id) ?? null;
    const images = new Map<string, string>();
    for (const row of rows) {
      const name = row.company?.name ?? '';
      if (name && row.company?.image) images.set(name, row.company.image);
    }
    return {
      companies: [...images].map(([name, image]) => ({ name, image })),
      packages: rows.map((row) => ({
        price: buyPriceFor(path, termsOf(row.id), sellsOf(row.id), row, 'subscription'),
        renewalPrice: buyPriceFor(path, termsOf(row.id), sellsOf(row.id), row, 'renewal'),
        canActivate,
        sellPrice: ownSell(row.id)?.price ?? null,
        sellRenewalPrice: ownSell(row.id)?.renewalPrice ?? null,
        sellDefault: sellsTo ? layerPrice(sellsTo, row, 'subscription') : null,
        sellRenewalDefault: sellsTo ? layerPrice(sellsTo, row, 'renewal') : null,
        code: row.code,
        name: row.name,
        providerCode: row.provider.code,
        providerName: actor.layer === 'branch' ? row.provider.name : '',
        activateMode: resolvePackageMode(row.actionModes, row, 'activate'),
        companyName: row.company?.name ?? '',
        sim: simRulesOf(row.company),
        esimPrice: esimPriceOf({ pkg: row, provider: row.provider, company: row.company }).price,
        dataGb: row.dataGb,
        months: row.months,
        branchCost: row.branchCost,
        mainPrice: row.mainPrice,
        agentPrice: row.agentPrice,
        posPrice: row.posPrice,
        subscriberPrice: row.subscriberPrice,
        editableField: field,
        autoActivate: row.autoActivate,
        autoCharge: row.autoCharge,
        autoDisconnect: row.autoDisconnect,
        autoFreeze: row.autoFreeze,
        autoSwitch: row.autoSwitch,
      })),
    };
  }

  async companiesShelf(gate: Gate) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const rows = await this.prisma.package.findMany({
      where: { companyId: { not: null } },
      include: {
        provider: true,
        company: true,
        lines: { select: { status: true } },
      },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' }],
    });
    const byCompany = new Map<string, Map<string, {
      code: string;
      name: string;
      packages: Array<{
        code: string;
        name: string;
        months: number;
        forSale: boolean;
        enabled: boolean;
        lines: number;
        activeLines: number;
        stoppedLines: number;
      }>;
    }>>();
    for (const row of rows) {
      if (!row.company) continue;
      const providers = byCompany.get(row.company.code) ?? new Map();
      const provider = providers.get(row.provider.code) ?? {
        code: row.provider.code,
        name: row.provider.name,
        packages: [],
      };
      const activeLines = row.lines.filter((line) => line.status === 'active').length;
      provider.packages.push({
        code: row.code,
        name: row.name,
        months: row.months,
        forSale: row.forSale,
        enabled: row.enabled,
        lines: row.lines.length,
        activeLines,
        stoppedLines: row.lines.length - activeLines,
      });
      providers.set(row.provider.code, provider);
      byCompany.set(row.company.code, providers);
    }
    const stored = await this.prisma.company.findMany({
      select: { code: true, image: true, iccidLength: true, iccidPrefix: true, esim: true, esimPrice: true },
    });
    const byCode = new Map(stored.map((row) => [row.code, row]));
    return {
      companies: companies.map((company) => ({
        code: company.code,
        name: company.name,
        image: byCode.get(company.code)?.image ?? '',
        sim: simRulesOf(byCode.get(company.code) ?? null),
        esimPrice: byCode.get(company.code)?.esimPrice ?? ESIM_PRICE_DEFAULT,
        providers: [...(byCompany.get(company.code)?.values() ?? [])],
      })),
    };
  }

  /** A main agent's or agent's own sell price for a package. The floor is what the actor itself pays. */
  async setSellPrice(gate: Gate, code: string, body: { price?: unknown; renewalPrice?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'main_agent' && actor.layer !== 'agent') fail(403, 'FORBIDDEN');
    const price = nonNegative(body.price);
    const renewalPrice = optionalPrice(body.renewalPrice);
    if (price === null || renewalPrice === undefined) fail(400, 'INVALID');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const [accounts, { terms, sells }] = await Promise.all([this.accounts(), this.termsFor(pkg.id)]);
    const path = this.pathOf(actor.id, accounts);
    if (path.length === 0) fail(404, 'NOT_FOUND');
    if (price < buyPriceFor(path, terms, sells, pkg, 'subscription')) fail(400, 'PRICE_BELOW_FLOOR');
    if (renewalPrice !== null && renewalPrice < buyPriceFor(path, terms, sells, pkg, 'renewal')) fail(400, 'PRICE_BELOW_FLOOR');
    await this.prisma.sellPrice.upsert({
      where: { packageId_ownerId: { packageId: pkg.id, ownerId: actor.id } },
      update: { price, renewalPrice },
      create: { packageId: pkg.id, ownerId: actor.id, price, renewalPrice },
    });
    return { price, renewalPrice };
  }

  /** Drops the caller's own sell price so the layer column applies again; a missing row is already clear. */
  async clearSellPrice(gate: Gate, code: string) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'main_agent' && actor.layer !== 'agent') fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    await this.prisma.sellPrice.deleteMany({ where: { packageId: pkg.id, ownerId: actor.id } });
    return { ok: true };
  }

  async setCompanySim(gate: Gate, code: string, body: { length?: unknown; prefix?: unknown; esim?: unknown; esimPrice?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    if (!actor.isBranchOwner && !actor.grants.includes('edit')) fail(403, 'FORBIDDEN');
    const rules = readSimRules(body);
    if (!rules) fail(400, 'INVALID');
    const esimPrice = body.esimPrice === undefined ? undefined : nonNegative(body.esimPrice);
    if (esimPrice === null) fail(400, 'INVALID');
    const row = await this.prisma.company.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    const saved = await this.prisma.company.update({
      where: { id: row.id },
      data: { iccidLength: rules.length, iccidPrefix: rules.prefix || null, esim: rules.esim, ...(esimPrice === undefined ? {} : { esimPrice }) },
    });
    return { ok: true, sim: rules, esimPrice: saved.esimPrice };
  }

  async setCompanyImage(gate: Gate, body: { name?: unknown; image?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'FORBIDDEN');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) fail(400, 'INVALID');
    const found = await this.prisma.company.count({ where: { name } });
    if (!found) fail(404, 'NOT_FOUND');
    let image: string | null = null;
    if (typeof body.image === 'string' && body.image) {
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
      if (!match) fail(400, 'INVALID');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length < 32 || bytes.length > 150_000) fail(400, 'INVALID');
      image = `data:image/${match[1]};base64,${match[2]}`;
    }
    await this.prisma.company.updateMany({ where: { name }, data: { image } });
    return { ok: true };
  }

  async providerSettings(gate: Gate, code: string) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const row = await this.prisma.provider.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    return {
      code: row.code,
      name: row.name,
      modes: normalizeActionModes(row.actionModes),
      esimPrice: row.esimPrice,
    };
  }

  async setProviderEsimPrice(gate: Gate, code: string, body: { price?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    if (!actor.isBranchOwner && !actor.grants.includes('edit')) fail(403, 'FORBIDDEN');
    const row = await this.prisma.provider.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    const price = body.price === null ? null : nonNegative(body.price);
    if (price === null && body.price !== null) fail(400, 'INVALID');
    await this.prisma.provider.update({ where: { code }, data: { esimPrice: price } });
    return { ok: true as const, esimPrice: price };
  }

  async setProviderMode(gate: Gate, code: string, body: Record<string, unknown>) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    if (!actor.isBranchOwner && !actor.grants.includes('edit')) fail(403, 'FORBIDDEN');
    const row = await this.prisma.provider.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    const action = typeof body.action === 'string' ? body.action : '';
    const mode = body.mode === 'auto' || body.mode === 'manual' || body.mode === 'off' ? body.mode : '';
    if (!(ACTION_KEYS as readonly string[]).includes(action) || !mode) fail(400, 'INVALID');
    const modes = normalizeActionModes(row.actionModes);
    modes[action as ActionKey] = mode as ActionMode;
    await this.prisma.provider.update({
      where: { code },
      data: { actionModes: modes },
    });
    return { ok: true as const };
  }

  async providers(gate: Gate) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const rows = await this.prisma.provider.findMany({
      where: { packages: { some: { companyId: { not: null } } } },
      include: { packages: { include: { company: true }, orderBy: { code: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return {
      providers: rows.map((row) => {
        const byCompany = new Map<string, { name: string; image: string; packages: Array<{
          code: string;
          name: string;
          dataGb: number | null;
          months: number;
          price: number;
          enabled: boolean;
          autoActivate: boolean;
          autoCharge: boolean;
          autoDisconnect: boolean;
          autoFreeze: boolean;
          autoSwitch: boolean;
          autoExtend: boolean;
          autoRename: boolean;
          autoSim: boolean;
          allowDisconnect: boolean;
        }> }>();
        for (const item of row.packages) {
          if (!item.company) continue;
          const company = byCompany.get(item.company.id) ?? {
            name: item.company.name,
            image: item.company.image ?? '',
            packages: [],
          };
          company.packages.push({
            code: item.code,
            name: item.name,
            dataGb: item.dataGb,
            months: item.months,
            price: item.branchCost,
            enabled: item.enabled,
            autoActivate: item.autoActivate,
            autoCharge: item.autoCharge,
            autoDisconnect: item.autoDisconnect,
            autoFreeze: item.autoFreeze,
            autoSwitch: item.autoSwitch,
            autoExtend: item.autoExtend,
            autoRename: item.autoRename,
            autoSim: item.autoSim,
            allowDisconnect: item.allowDisconnect,
          });
          byCompany.set(item.company.id, company);
        }
        return {
          code: row.code,
          name: row.name,
          companies: [...byCompany.values()].sort((left, right) => left.name.localeCompare(right.name, 'ar')),
        };
      }),
    };
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

  async tasks(
    gate: Gate,
    query: {
      cursor?: string;
      q?: string;
      status?: string;
      action?: string;
      packageCode?: string;
      company?: string;
      provider?: string;
    } = {},
  ) {
    const actor = await this.actor(gate);
    const handler = canHandleTasks(actor);
    const accounts = await this.accounts();
    const status = taskStatusOf(query.status);
    const action = typeof query.action === 'string' ? query.action.trim() : '';
    const packageCode = typeof query.packageCode === 'string' ? query.packageCode.trim() : '';
    const company = typeof query.company === 'string' ? query.company.trim() : '';
    const provider = typeof query.provider === 'string' ? query.provider.trim() : '';
    const digits = (typeof query.q === 'string' ? query.q : '').replace(/\s/g, '');
    const packageFilterOn = Boolean(packageCode || company || provider);
    const matchedPackages = packageFilterOn
      ? await this.prisma.package.findMany({
          where: {
            ...(packageCode ? { code: packageCode } : {}),
            ...(company ? { company: { name: company } } : {}),
            ...(provider ? { provider: { name: provider } } : {}),
          },
          select: { id: true },
        })
      : null;
    if (matchedPackages && matchedPackages.length === 0) {
      return { tasks: [], nextCursor: null, total: 0 };
    }
    const where = {
      ...taskWhereFor(actor, accounts),
      ...(status ? { status } : {}),
      ...(action ? { action } : {}),
      ...(digits ? { msisdn: { contains: digits } } : {}),
      ...(matchedPackages ? { packageId: { in: matchedPackages.map((row) => row.id) } } : {}),
    };
    const [read, total] = await Promise.all([
      this.prisma.officeTask.findMany({
        where: { ...where, AND: afterFeed(feedPosition(query.cursor)) },
        include: {
          submitter: true,
          assignee: true,
          notes: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true } },
        },
        orderBy: [...NEWEST_FIRST],
        take: TASKS_PAGE + 1,
      }),
      this.prisma.officeTask.count({ where }),
    ]);
    const { page: rows, nextCursor } = mergeFeed([read], TASKS_PAGE);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const packages = await this.prisma.package.findMany({ include: { company: true, provider: true } });
    const byPackage = new Map(packages.map((row) => [row.id, row]));
    return {
      tasks: rows.map((row) => {
        const pkg = byPackage.get(row.packageId);
        const open = row.status === 'pending' || row.status === 'working';
        return {
          id: row.id,
          action: row.action,
          status: row.status,
          posLogin: byId.get(row.posId)?.loginName ?? '',
          submitterLogin: row.submitter.loginName,
          assigneeLogin: row.assignee?.loginName ?? null,
          posDelta: row.posDelta,
          msisdn: row.msisdn,
          packageName: pkg?.name ?? '',
          companyName: pkg?.company?.name ?? '',
          providerName: pkg?.provider?.name ?? '',
          note: row.note,
          resultNote: row.status === 'pending' && !handler ? null : row.resultNote,
          lastNote: row.notes[0]?.body ?? null,
          log: handler ? row.log : '',
          canTake: handler && row.status === 'pending',
          canWork: handler && row.assigneeId === actor.id && row.status === 'working',
          canCancel: row.submitterId === actor.id && open,
        };
      }),
      nextCursor,
      total,
    };
  }

  async task(gate: Gate, id: string) {
    const actor = await this.actor(gate);
    const handler = canHandleTasks(actor);
    const row = await this.prisma.officeTask.findUnique({
      where: { id },
      include: {
        submitter: true,
        assignee: true,
        notes: { include: { author: true }, orderBy: { createdAt: 'asc' } },
        line: { include: { package: { include: { company: true, provider: true } } } },
      },
    });
    if (!row) fail(404, 'NOT_FOUND');
    const accounts = await this.accounts();
    if (!taskReaders(row, accounts).has(actor.id)) fail(403, 'FORBIDDEN');
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const pkg =
      row.line?.package ??
      (await this.prisma.package.findUnique({
        where: { id: row.packageId },
        include: { company: true, provider: true },
      }));
    const events: {
      id: string;
      kind: 'system' | 'note' | 'result';
      body: string;
      authorName: string | null;
      at: string;
    }[] = [];
    if (handler && row.log.trim()) {
      row.log
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line, index) => {
          const parsed = parseTaskLogLine(line, row.createdAt.toISOString());
          events.push({
            id: `log-${String(index).padStart(4, '0')}`,
            kind: 'system',
            body: parsed.body,
            authorName: null,
            at: parsed.at,
          });
        });
    }
    for (const note of row.notes) {
      events.push({
        id: note.id,
        kind: 'note',
        body: note.body,
        authorName: note.author.nickname || note.author.loginName,
        at: note.createdAt.toISOString(),
      });
    }
    const resultNote = row.status === 'pending' && !handler ? null : row.resultNote;
    if (resultNote) {
      events.push({
        id: 'result',
        kind: 'result',
        body: resultNote,
        authorName: row.assignee?.nickname || row.assignee?.loginName || null,
        at: row.updatedAt.toISOString(),
      });
    }
    events.sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
    const open = row.status === 'pending' || row.status === 'working';
    return {
      task: {
        id: row.id,
        action: row.action,
        status: row.status,
        posLogin: byId.get(row.posId)?.loginName ?? '',
        submitterLogin: row.submitter.loginName,
        assigneeLogin: row.assignee?.loginName ?? null,
        posDelta: row.posDelta,
        msisdn: row.line?.msisdn ?? row.msisdn,
        iccid: row.line?.iccid ?? row.iccid,
        esim: row.line?.esim ?? row.esim,
        esimQr: row.line?.esimQr ?? row.esimQr ?? null,
        sim: simRulesOf(pkg?.company ?? null),
        lineStatus: row.line?.status ?? null,
        packageName: pkg?.name ?? '',
        companyName: pkg?.company?.name ?? '',
        providerName: pkg?.provider?.name ?? '',
        note: row.note,
        resultNote,
        log: handler ? row.log : '',
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        canTake: handler && row.status === 'pending',
        canWork: handler && row.assigneeId === actor.id && row.status === 'working',
        canNote: open,
        canCancel: row.submitterId === actor.id && open,
      },
      events,
    };
  }

  async addTaskNote(gate: Gate, id: string, body: { text?: unknown }) {
    const actor = await this.actor(gate);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) fail(400, 'INVALID');
    const current = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!current) fail(404, 'NOT_FOUND');
    if (!taskReaders(current, await this.accounts()).has(actor.id)) fail(403, 'FORBIDDEN');
    if (current.status !== 'pending' && current.status !== 'working') fail(400, 'INVALID');
    const written = await this.runTx(async (tx) => {
      await tx.officeTaskNote.create({ data: { taskId: id, authorId: actor.id, body: text } });
      return this.taskNotice(tx, 'note', current, actor, { authorName: actor.nickname, excerpt: excerpt(text) });
    });
    await this.publishQuietly(written);
    return { ok: true };
  }

  async takeTask(gate: Gate, id: string) {
    const actor = await this.branchActor(gate);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const current = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!current || current.status !== 'pending') fail(400, 'INVALID');
    const written = await this.runTx(async (tx) => {
      const updated = await tx.officeTask.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'working', assigneeId: actor.id, log: this.noteLog(current.log, `أخذها ${actor.nickname}`) },
      });
      if (updated.count !== 1) fail(400, 'INVALID');
      return this.taskNotice(tx, 'taken', { ...current, assigneeId: actor.id }, actor, { handlerName: actor.nickname });
    });
    await this.publishQuietly(written);
    return { ok: true };
  }

  async releaseTask(gate: Gate, id: string) {
    const actor = await this.branchActor(gate);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const current = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!current || current.status !== 'working' || current.assigneeId !== actor.id) fail(400, 'INVALID');
    const written = await this.runTx(async (tx) => {
      const updated = await tx.officeTask.updateMany({
        where: { id, status: 'working', assigneeId: actor.id },
        data: { status: 'pending', assigneeId: null, log: this.noteLog(current.log, `أرجعها ${actor.nickname}`) },
      });
      if (updated.count !== 1) fail(400, 'INVALID');
      return this.taskNotice(tx, 'released', { ...current, assigneeId: null }, actor);
    });
    await this.publishQuietly(written);
    return { ok: true };
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

  async rejectTask(gate: Gate, id: string, body: { reason?: unknown }) {
    const actor = await this.branchActor(gate);
    if (!canHandleTasks(actor)) fail(403, 'FORBIDDEN');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) fail(400, 'INVALID');
    const task = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!task || task.status !== 'working' || task.assigneeId !== actor.id) fail(400, 'INVALID');
    const written = await this.runTx(async (tx) => {
      const updated = await tx.officeTask.updateMany({
        where: { id, status: 'working', assigneeId: actor.id },
        data: { status: 'cancelled', resultNote: reason },
      });
      if (updated.count !== 1) fail(400, 'INVALID');
      return this.taskNotice(tx, 'rejected', task, actor, { reason, handlerName: actor.nickname });
    });
    await this.publishQuietly(written);
    return { ok: true };
  }

  async cancelTask(gate: Gate, id: string) {
    const actor = await this.actor(gate);
    const task = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!task || task.submitterId !== actor.id || (task.status !== 'pending' && task.status !== 'working')) fail(400, 'INVALID');
    const written = await this.runTx(async (tx) => {
      const updated = await tx.officeTask.updateMany({
        where: { id, submitterId: actor.id, status: { in: ['pending', 'working'] } },
        data: { status: 'cancelled', resultNote: null, assigneeId: null },
      });
      if (updated.count !== 1) fail(400, 'INVALID');
      return this.taskNotice(tx, 'cancelled', task, actor);
    });
    await this.publishQuietly(written);
    return { ok: true };
  }

  async users(gate: Gate) {
    const actor = await this.actor(gate);
    const accounts = await this.prisma.user.findMany({
      select: { id: true, loginName: true, nickname: true, layer: true, parentId: true, disabledAt: true, isBranchOwner: true, role: { select: { name: true, staff: true } } },
      orderBy: { loginName: 'asc' },
    });
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const wallets = await this.prisma.wallet.findMany({ where: { userId: { in: [...visible] } } });
    const byWallet = new Map(wallets.map((row) => [row.userId, row]));
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const branch = actor.layer === 'branch' && !actor.impersonating;
    return {
      users: accounts
        .filter((account) => visible.has(account.id))
        .map((account) => ({
          loginName: account.loginName,
          nickname: account.nickname,
          layer: account.layer,
          roleName: account.role?.name ?? '',
          parentLogin: account.parentId ? byId.get(account.parentId)?.loginName ?? null : null,
          balance: byWallet.get(account.id)?.balance ?? 0,
          ceiling: byWallet.get(account.id)?.ceiling ?? 0,
          frozen: account.disabledAt !== null,
          self: account.id === actor.id,
          directChild: account.parentId === actor.id,
          canEnter: (actor.isBranchOwner || actor.grants.includes('enter')) && !actor.impersonating && account.id !== actor.id && account.disabledAt === null,
          canFreeze: (actor.isBranchOwner || actor.grants.includes('staff')) && !account.isBranchOwner && !(account.role?.staff && !actor.isBranchOwner),
          canDelete: branch && !account.isBranchOwner && account.id !== actor.id,
        })),
    };
  }

  /**
   * Login name → full name for every account the actor may meet on a screen: the accounts it can
   * see (its subtree), the chain above it, and the branch layer (staff act on every ledger).
   */
  async directory(gate: Gate) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const chain = new Set(this.chainIds(actor.id, accounts));
    const names: Record<string, string> = {};
    for (const account of accounts) {
      if (!visible.has(account.id) && !chain.has(account.id) && account.layer !== 'branch') continue;
      names[account.loginName] = account.nickname;
    }
    return { names };
  }

  async createAccount(gate: Gate, body: { loginName?: unknown; nickname?: unknown; password?: unknown; layer?: unknown; parentLogin?: unknown; roleId?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    const loginName = typeof body.loginName === 'string' ? body.loginName.trim().toLowerCase() : '';
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const layer = typeof body.layer === 'string' ? body.layer : '';
    const parentLogin = typeof body.parentLogin === 'string' ? body.parentLogin.trim() : '';
    if (!/^[a-z0-9._-]{3,32}$/.test(loginName)) fail(400, 'INVALID');
    const nickError = fullNameProblem(nickname);
    if (nickError) fail(400, nickError);
    const passError = newPasswordProblem(password);
    if (passError) fail(400, passError);
    const allowed: Record<string, string[]> = {
      branch: ['main_agent', 'agent', 'pos'],
      main_agent: ['agent', 'pos'],
      agent: ['pos'],
    };
    if (layer === 'staff') {
      if (actor.layer !== 'branch' || (!actor.isBranchOwner && !actor.grants.includes('staff'))) fail(403, 'FORBIDDEN');
      const roleId = typeof body.roleId === 'string' ? body.roleId : '';
      const role = roleId ? await this.prisma.role.findUnique({ where: { id: roleId } }) : null;
      if (!role || (role.staff && !actor.isBranchOwner)) fail(403, 'FORBIDDEN');
      const owner = await this.prisma.user.findFirst({ where: { isBranchOwner: true } });
      if (!owner) fail(400, 'INVALID');
      const existing = await this.prisma.user.findUnique({ where: { loginName } });
      if (existing) fail(400, 'LOGIN_TAKEN');
      await this.prisma.user.create({
        data: {
          loginName,
          nickname,
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
          layer: 'branch',
          parentId: owner.id,
          roleId: role.id,
          wallet: { create: {} },
        },
      });
      return { ok: true as const };
    }
    if (!allowed[actor.layer]?.includes(layer)) fail(403, 'FORBIDDEN');
    const accounts = await this.accounts();
    const direct: Record<string, string> = { branch: 'main_agent', main_agent: 'agent', agent: 'pos' };
    let parent = accounts.find((account) => account.id === actor.id) ?? null;
    if (layer !== direct[actor.layer]) {
      const chosen = accounts.find((account) => account.loginName === parentLogin);
      const visible = visibleAccountIds(actor.id, actor.layer, accounts);
      const parentLayer = layer === 'agent' ? 'main_agent' : 'agent';
      parent = chosen && chosen.id !== actor.id && visible.has(chosen.id) && chosen.layer === parentLayer ? chosen : null;
    }
    if (!parent) fail(400, 'INVALID');
    const existing = await this.prisma.user.findUnique({ where: { loginName } });
    if (existing) fail(400, 'LOGIN_TAKEN');
    await this.prisma.user.create({
      data: {
        loginName,
        nickname,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        layer,
        parentId: parent.id,
        wallet: { create: {} },
      },
    });
    return { ok: true as const };
  }

  async setAccountPassword(gate: Gate, loginName: string, body: { password?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    const password = typeof body.password === 'string' ? body.password : '';
    const passError = newPasswordProblem(password);
    if (passError) fail(400, passError);
    const target = await this.prisma.user.findUnique({ where: { loginName } });
    if (!target || target.isBranchOwner || target.id === actor.id) fail(403, 'FORBIDDEN');
    const accounts = await this.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(403, 'FORBIDDEN');
    const rank: Record<string, number> = { branch: 0, main_agent: 1, agent: 2, pos: 3 };
    if (target.roleId) {
      if (!actor.isBranchOwner && !actor.grants.includes('staff')) fail(403, 'FORBIDDEN');
    } else if ((rank[target.layer] ?? 9) <= (rank[actor.layer] ?? 9)) fail(403, 'FORBIDDEN');
    await this.prisma.user.update({
      where: { id: target.id },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true },
    });
    return { ok: true as const };
  }

  async roles(gate: Gate) {
    const actor = await this.actor(gate);
    if (!actor.isBranchOwner) fail(403, 'FORBIDDEN');
    await this.ensureLayerRoles();
    const roles = await this.prisma.role.findMany();
    const rank = (role: { kind: string; layer: string | null; name: string }) =>
      role.kind === 'layer' ? LAYER_ORDER.indexOf(role.layer ?? '') : LAYER_ORDER.length;
    roles.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return {
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        kind: role.kind === 'layer' ? 'layer' : 'job',
        layer: role.layer ?? '',
        grants: roleGrantCodes(role),
        read: role.read,
        edit: role.edit,
        accounting: role.accounting,
        tasks: role.tasks,
        reports: role.reports,
        staff: role.staff,
        enter: role.enter,
      })),
    };
  }

  async saveRole(gate: Gate, body: { id?: unknown; name?: unknown; grants?: unknown; read?: unknown; edit?: unknown; accounting?: unknown; tasks?: unknown; reports?: unknown; staff?: unknown; enter?: unknown }) {
    const actor = await this.actor(gate);
    if (!actor.isBranchOwner || actor.impersonating) fail(403, 'FORBIDDEN');
    const listed = Array.isArray(body.grants)
      ? splitGrants(body.grants.filter((code): code is string => typeof code === 'string').join(','))
      : FLAG_CODES.filter((code) => body[code] === true);
    const flags = flagsFor(listed);
    const id = typeof body.id === 'string' ? body.id : '';
    if (id) {
      const existing = await this.prisma.role.findUnique({ where: { id } });
      if (!existing) fail(404, 'NOT_FOUND');
      const name = existing.kind === 'layer' ? existing.name : (typeof body.name === 'string' ? body.name.trim() : '');
      if (name.length < 2) fail(400, 'INVALID');
      await this.prisma.role.update({
        where: { id },
        data: { name, ...flags, grants: listed.join(',') },
      });
    } else {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 2) fail(400, 'INVALID');
      await this.prisma.role.create({ data: { name, kind: 'job', ...flags, grants: listed.join(',') } });
    }
    return { ok: true as const };
  }

  async account(gate: Gate, loginName: string) {
    const actor = await this.actor(gate);
    await this.ensureLayerRoles();
    const target = await this.visibleAccount(actor, loginName);
    const [layerRole, jobs, extra] = await Promise.all([
      this.prisma.role.findUnique({ where: { layer: target.layer } }),
      this.prisma.role.findMany({ where: { kind: 'job' }, orderBy: { name: 'asc' } }),
      this.prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } }),
    ]);
    const staff = target.layer === 'branch' && Boolean(target.roleId) && !target.isBranchOwner;
    const roleGrants = effectiveGrantCodes({
      owner: false,
      staff,
      layer: target.layer,
      layerRole,
      roles: [target.role, ...extra.map((link) => link.role)],
      extra: '',
      denied: '',
    });
    const grants = target.isBranchOwner
      ? [...GRANT_CODES]
      : effectiveGrantCodes({
        owner: false,
        staff,
        layer: target.layer,
        layerRole,
        roles: [target.role, ...extra.map((link) => link.role)],
        extra: target.extraGrants,
        denied: target.deniedGrants,
      });
    const parent = target.parentId
      ? await this.prisma.user.findUnique({ where: { id: target.parentId }, select: { loginName: true } })
      : null;
    return {
      loginName: target.loginName,
      nickname: target.nickname,
      layer: target.layer,
      parentLogin: parent?.loginName ?? null,
      frozen: target.disabledAt !== null,
      isBranchOwner: target.isBranchOwner,
      staff,
      roleId: target.roleId ?? '',
      roleName: target.role?.name ?? '',
      roleGrants,
      extraGrants: splitGrants(target.extraGrants),
      deniedGrants: splitGrants(target.deniedGrants),
      extraRoleIds: extra.map((link) => link.roleId),
      grants,
      roles: jobs.map((role) => ({ id: role.id, name: role.name, grants: roleGrantCodes(role) })),
      canEdit: actor.isBranchOwner && !actor.impersonating && !target.isBranchOwner,
    };
  }

  async saveAccess(gate: Gate, loginName: string, body: { extraGrants?: unknown; deniedGrants?: unknown; extraRoleIds?: unknown; roleId?: unknown }) {
    const actor = await this.actor(gate);
    if (!actor.isBranchOwner || actor.impersonating) fail(403, 'FORBIDDEN');
    const target = await this.visibleAccount(actor, loginName);
    if (target.isBranchOwner) fail(403, 'FORBIDDEN');
    const extraGrants = splitGrants(Array.isArray(body.extraGrants) ? body.extraGrants.filter((code): code is string => typeof code === 'string').join(',') : '');
    const denied = new Set(splitGrants(Array.isArray(body.deniedGrants) ? body.deniedGrants.filter((code): code is string => typeof code === 'string').join(',') : ''));
    for (const code of extraGrants) denied.delete(code);
    const wanted = Array.isArray(body.extraRoleIds) ? body.extraRoleIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
    const jobs = wanted.length === 0
      ? []
      : await this.prisma.role.findMany({ where: { id: { in: wanted }, kind: 'job' }, select: { id: true } });
    if (jobs.length !== new Set(wanted).size) fail(400, 'INVALID');
    const staff = target.layer === 'branch' && Boolean(target.roleId);
    let roleId = target.roleId;
    if (staff) {
      const next = typeof body.roleId === 'string' ? body.roleId : '';
      const primary = next ? await this.prisma.role.findUnique({ where: { id: next } }) : null;
      if (!primary || primary.kind === 'layer') fail(400, 'INVALID');
      roleId = primary.id;
    }
    const extraIds = jobs.map((role) => role.id).filter((id) => id !== roleId);
    await this.runTx(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { extraGrants: extraGrants.join(','), deniedGrants: [...denied].join(','), roleId },
      });
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      if (extraIds.length > 0) {
        await tx.userRole.createMany({ data: extraIds.map((id) => ({ userId: target.id, roleId: id })) });
      }
    });
    return { ok: true as const };
  }

  /**
   * Moves a point of sale under another agent, or an agent under another main agent. The caller states
   * every choice: what the account's own terms do, what the terms below it do (an agent), and whether the
   * numbers under it keep the renewal prices they carry or take what the new parent would charge. All of it
   * is asked before anything is written, in this order: the words of the choices, which need no account;
   * then the rules, which are the preview's, so a refusal is the same in both; then what is below the
   * account, which depends on its kind. Wallets and numbers go with the account as they are. Everything
   * happens in one transaction, so a move either carries all its choices and both notices, or nothing.
   */
  async transferAccount(gate: Gate, loginName: string, body: TransferAccountBody) {
    const actor = await this.actor(gate);
    const stated = statedChoices(body);
    if (!stated) fail(400, 'INVALID');
    const accounts = await this.accounts();
    const { moved, next, from, kind } = this.resolveTransfer(actor, accounts, loginName, body.parentLogin);
    const choices = transferChoices(kind, stated);
    if (!choices) fail(400, 'INVALID');
    const posIds = accounts.filter((account) => account.parentId === moved.id).map((account) => account.id);
    const lines = await this.runTx(async (tx) => {
      // A point of sale's numbers remember the agent they were first sold under.
      if (kind === 'pos') {
        await tx.line.updateMany({ where: { posId: moved.id, originAgentId: null }, data: { originAgentId: moved.parentId } });
      }
      await tx.user.update({ where: { id: moved.id }, data: { parentId: next.id } });
      // What the old parent wrote about the moved account goes only if the caller said so.
      if (choices.ownPrices === 'reset') await tx.userPackage.deleteMany({ where: { userId: moved.id } });
      if (choices.ownStops === 'reset') await tx.user.update({ where: { id: moved.id }, data: { deniedOps: '' } });
      if (choices.child?.prices === 'reset') {
        await tx.userPackage.deleteMany({ where: { userId: { in: posIds } } });
        await tx.sellPrice.deleteMany({ where: { ownerId: moved.id } });
      }
      if (choices.child?.stops === 'reset') await tx.user.updateMany({ where: { id: { in: posIds } }, data: { deniedOps: '' } });
      let repriced = 0;
      if (choices.linePrices === 'recapture') {
        // After the resets, so the numbers are priced by the rows that are left, and through the new parent.
        const renewable = await tx.line.findMany({
          where: { posId: { in: [moved.id, ...posIds] }, status: { in: [...RENEWABLE_STATUSES] } },
          include: { package: { include: { company: true, provider: true } } },
        });
        const accountsAfter = accounts.map((account) => (account.id === moved.id ? { ...account, parentId: next.id } : account));
        repriced = await this.repriceLines(tx, renewable, () => ({ to: 'current' }), accountsAfter);
      }
      const payload = { kind, subject: moved.loginName, actorName: actor.nickname };
      const lost = await this.notice.write(tx, [from.id], actor, { kind: 'transfer.out', payload: { ...payload, toLogin: next.loginName } });
      const gained = await this.notice.write(tx, [next.id], actor, { kind: 'transfer.in', payload: { ...payload, fromLogin: from.loginName } });
      this.queueNotices(tx, [...lost, ...gained]);
      return repriced;
    });
    return { ok: true as const, lines };
  }

  /**
   * What moving `loginName` under `query.parentLogin` would carry, without writing anything. It asks the
   * same rules as the move, so a refusal reaches the dialog from here, and it reads each table once however
   * many accounts sit below.
   */
  async transferPreview(gate: Gate, loginName: string, query: { parentLogin?: unknown }) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const { moved, next, kind } = this.resolveTransfer(actor, accounts, loginName, query.parentLogin);
    const nextPath = [nodeOf(moved), ...this.pathOf(next.id, accounts)];
    // What is under the moved account: an agent's points of sale, nothing for a point of sale. They go with
    // it, so their paths after the move run through its own.
    const below = accounts.filter((account) => account.parentId === moved.id);
    const belowIds = below.map((account) => account.id);
    const subtree = [moved.id, ...belowIds];
    // The moved account heads the new chain, so one list serves its own rows and the rows that set its floor.
    const chainIds = nextPath.map((node) => node.id);
    const [terms, sells, packages, wallets, lines] = await Promise.all([
      this.prisma.userPackage.findMany({
        where: { userId: { in: [...chainIds, ...belowIds] } },
        select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
      }),
      this.prisma.sellPrice.findMany({
        where: { ownerId: { in: chainIds } },
        select: { packageId: true, ownerId: true, price: true, renewalPrice: true },
      }),
      this.prisma.package.findMany({ select: { id: true, ...PRICE_COLUMNS } }),
      this.prisma.wallet.findMany({ where: { userId: { in: subtree } }, select: { userId: true, balance: true } }),
      this.prisma.line.count({ where: { posId: { in: subtree }, status: { in: [...RENEWABLE_STATUSES] } } }),
    ]);
    const balances = new Map(wallets.map((wallet) => [wallet.userId, wallet.balance]));
    return {
      balance: balances.get(moved.id) ?? 0,
      subtreeBalance: belowIds.reduce((sum, id) => sum + (balances.get(id) ?? 0), 0),
      ...previewOf({
        moved: this.pathOf(moved.id, accounts),
        nextPath,
        // Only a point of sale has no child section. An agent with none still has its sell prices to count.
        children: kind === 'pos' ? null : below.map((account) => [nodeOf(account), ...nextPath]),
        terms,
        sells,
        packages,
      }),
      lines,
    };
  }

  /**
   * The account a move names and the parent it names, once the rules allow the move, with the parent it
   * leaves and the kind of move. All of them come from the accounts the caller already loaded. A login that
   * is not there, or an account with no parent to change, answers like a destination of the wrong layer, but
   * not to a caller with no say over any move: that one is refused first, as `canTransfer` refuses before it
   * reads anything, so a refusal never tells what exists.
   */
  private resolveTransfer(actor: Actor, accounts: Account[], loginName: string, parentLogin: unknown) {
    const moved = accounts.find((account) => account.loginName === loginName);
    const kind = moved ? transferKind(moved.layer) : null;
    if (!moved || !kind) {
      const mayMove = !actor.impersonating && (actor.grants.includes(TRANSFER_GRANT.pos) || actor.grants.includes(TRANSFER_GRANT.agent));
      if (!mayMove) fail(403, 'FORBIDDEN');
      fail(400, 'INVALID');
    }
    const next = typeof parentLogin === 'string' ? accounts.find((account) => account.loginName === parentLogin) : undefined;
    const from = accounts.find((account) => account.id === moved.parentId);
    const refusal = canTransfer({
      kind,
      actor: { grants: actor.grants, impersonating: actor.impersonating },
      actorStops: deniedOpsFor(this.pathOf(actor.id, accounts)),
      currentParentId: moved.parentId ?? '',
      destination: next ? { id: next.id, layer: next.layer, frozen: Boolean(next.disabledAt) } : null,
      visible: visibleAccountIds(actor.id, actor.layer, accounts),
    });
    if (refusal === 'FORBIDDEN') fail(403, 'FORBIDDEN');
    if (refusal || !next || !from) fail(400, 'INVALID');
    return { moved, next, from, kind };
  }

  async transferLine(gate: Gate, lineId: string, body: { posLogin?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.impersonating || !actor.grants.includes('transferLines')) fail(403, 'FORBIDDEN');
    const posLogin = typeof body.posLogin === 'string' ? body.posLogin : '';
    const line = await this.visibleLine(actor, lineId);
    const accounts = await this.accounts();
    const next = accounts.find((account) => account.loginName === posLogin && account.layer === 'pos');
    if (!next || next.id === line.posId) fail(400, 'INVALID');
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(next.id)) fail(403, 'FORBIDDEN');
    const locked = !line.package.companyId;
    await this.runTx(async (tx) => {
      await tx.line.update({
        where: { id: line.id },
        data: { posId: next.id, opsLocked: locked },
      });
      await this.recordOp(tx, line.posId, actor.operatorId, 'transfer', saleOf(line));
    });
    return { ok: true as const };
  }

  async setPackageMode(gate: Gate, code: string, body: Record<string, unknown>) {
    const actor = await this.actor(gate);
    if (!actor.isBranchOwner && !actor.grants.includes('edit')) fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const keys = ['autoActivate', 'autoCharge', 'autoDisconnect', 'autoFreeze', 'autoSwitch', 'autoExtend', 'autoRename', 'autoSim', 'allowActivate', 'allowCharge', 'allowDisconnect', 'allowFreeze', 'allowSwitch', 'allowExtend', 'allowRename', 'allowSim', 'enabled'] as const;
    const data: Record<string, boolean | Prisma.InputJsonValue> = {};
    for (const key of keys) if (typeof body[key] === 'boolean') data[key] = body[key] as boolean;
    const action = typeof body.action === 'string' ? body.action : '';
    const mode = body.mode === 'auto' || body.mode === 'manual' || body.mode === 'off' ? body.mode : '';
    const known = (ACTION_KEYS as readonly string[]).includes(action);
    if (known && mode) {
      const modes = {} as Record<ActionKey, 'auto' | 'manual' | 'off'>;
      for (const key of ACTION_KEYS) modes[key] = resolvePackageMode(pkg.actionModes, pkg, key);
      modes[action as ActionKey] = mode;
      data.actionModes = modes;
      const pair = MODE_FIELDS[action];
      if (pair) {
        const flags = flagsForMode(mode);
        data[pair.auto] = flags.auto;
        data[pair.allow] = flags.allow;
      }
    }
    if (Object.keys(data).length === 0) fail(400, 'INVALID');
    await this.prisma.package.update({ where: { code }, data });
    return { ok: true as const };
  }

  async packageSheet(gate: Gate, code: string) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({
      where: { code },
      include: {
        provider: true,
        company: true,
        lines: { select: { status: true } },
        renewals: { include: { target: { select: { code: true } } } },
        switches: { include: { target: { select: { code: true } } } },
      },
    });
    if (!pkg) fail(404, 'NOT_FOUND');
    return {
      code: pkg.code,
      name: pkg.name,
      providerCode: pkg.provider.code,
      providerName: pkg.provider.name,
      companyCode: pkg.company?.code ?? '',
      companyName: pkg.company?.name ?? '',
      enabled: pkg.enabled,
      forSale: pkg.forSale,
      branchCost: pkg.branchCost,
      mainPrice: pkg.mainPrice,
      agentPrice: pkg.agentPrice,
      posPrice: pkg.posPrice,
      subscriberPrice: pkg.subscriberPrice,
      renewalBranchCost: pkg.renewalBranchCost,
      renewalMainPrice: pkg.renewalMainPrice,
      renewalAgentPrice: pkg.renewalAgentPrice,
      renewalPosPrice: pkg.renewalPosPrice,
      renewalSubscriberPrice: pkg.renewalSubscriberPrice,
      esimPrice: pkg.esimPrice,
      esimPriceEffective: esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).price,
      esimPriceSource: esimPriceOf({ pkg, provider: pkg.provider, company: pkg.company }).source,
      lines: pkg.lines.length,
      activeLines: pkg.lines.filter((line) => line.status === 'active').length,
      renewals: pkg.renewals.map((renewal) => renewal.target.code),
      switches: pkg.switches.map((item) => item.target.code),
      modes: Object.fromEntries(ACTION_KEYS.map((key) => [key, resolvePackageMode(pkg.actionModes, pkg, key)])),
    };
  }

  async setChain(gate: Gate, code: string, body: Record<string, unknown>) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || (!actor.isBranchOwner && !actor.grants.includes('edit'))) fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const next = { ...pricesOf(pkg) };
    const renewal = {
      branchCost: pkg.renewalBranchCost,
      mainPrice: pkg.renewalMainPrice,
      agentPrice: pkg.renewalAgentPrice,
      posPrice: pkg.renewalPosPrice,
      subscriberPrice: pkg.renewalSubscriberPrice,
    };
    for (const key of ['branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice'] as const) {
      if (body[key] === undefined) continue;
      const price = nonNegative(body[key]);
      if (price === null) fail(400, 'INVALID');
      next[key] = price;
    }
    for (const [key, renewalKey] of [
      ['branchCost', 'renewalBranchCost'],
      ['mainPrice', 'renewalMainPrice'],
      ['agentPrice', 'renewalAgentPrice'],
      ['posPrice', 'renewalPosPrice'],
      ['subscriberPrice', 'renewalSubscriberPrice'],
    ] as const) {
      if (body[renewalKey] === undefined) continue;
      const price = nonNegative(body[renewalKey]);
      if (price === null) fail(400, 'INVALID');
      renewal[key] = price;
    }
    if (!chainHolds(next) || !chainHolds(renewal)) fail(400, 'PRICE_BELOW_FLOOR');
    const esimPrice = body.esimPrice === undefined ? undefined : body.esimPrice === null ? null : nonNegative(body.esimPrice);
    if (esimPrice === null && body.esimPrice !== null) fail(400, 'INVALID');
    await this.prisma.package.update({
      where: { id: pkg.id },
      data: {
        ...next,
        ...(esimPrice === undefined ? {} : { esimPrice }),
        renewalBranchCost: renewal.branchCost,
        renewalMainPrice: renewal.mainPrice,
        renewalAgentPrice: renewal.agentPrice,
        renewalPosPrice: renewal.posPrice,
        renewalSubscriberPrice: renewal.subscriberPrice,
      },
    });
    return { ok: true as const };
  }

  async setPackageTargets(
    gate: Gate,
    code: string,
    kind: 'renewals' | 'switches',
    body: { targets?: unknown },
  ) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || (!actor.isBranchOwner && !actor.grants.includes('edit'))) fail(403, 'FORBIDDEN');
    if (!Array.isArray(body.targets) || body.targets.some((target) => typeof target !== 'string' || !target)) {
      fail(400, 'INVALID');
    }
    const targetCodes = body.targets as string[];
    if (new Set(targetCodes).size !== targetCodes.length || targetCodes.includes(code)) fail(400, 'INVALID');
    const [pkg, targets] = await Promise.all([
      this.prisma.package.findUnique({ where: { code }, include: { company: true, provider: true } }),
      targetCodes.length
        ? this.prisma.package.findMany({
            where: { code: { in: targetCodes } },
            include: { company: true, provider: true },
          })
        : [],
    ]);
    if (!pkg) fail(404, 'NOT_FOUND');
    if (
      !pkg.company ||
      !pkg.provider ||
      targets.length !== targetCodes.length ||
      targets.some(
        (target) =>
          !target.company ||
          !target.provider ||
          target.company.code !== pkg.company?.code ||
          target.provider.code !== pkg.provider.code,
      )
    ) fail(400, 'INVALID');
    await this.runTx(async (tx) => {
      if (kind === 'renewals') {
        await tx.packageRenewal.deleteMany({ where: { packageId: pkg.id } });
        if (targets.length) {
          await tx.packageRenewal.createMany({
            data: targets.map((target) => ({ packageId: pkg.id, targetPackageId: target.id })),
          });
        }
      } else {
        await tx.packageSwitch.deleteMany({ where: { packageId: pkg.id } });
        if (targets.length) {
          await tx.packageSwitch.createMany({
            data: targets.map((target) => ({ packageId: pkg.id, targetPackageId: target.id })),
          });
        }
      }
    });
    return { ok: true as const };
  }

  // ---- Per-user package terms and operation stops -------------------------------------------

  /** Every sellable package, grouped by company, with what `loginName` sees and pays. */
  async userPackages(gate: Gate, loginName: string) {
    const { path, target, accounts } = await this.termTarget(gate, loginName);
    const lineCountsByPackage = await this.renewableLinesByPackage(target.id, target.layer, accounts);
    const [packages, terms, sells] = await Promise.all([
      this.prisma.package.findMany({ where: { enabled: true, forSale: true }, include: { company: true }, orderBy: [{ company: { name: 'asc' } }, { name: 'asc' }] }),
      this.prisma.userPackage.findMany({ where: { userId: { in: path.map((node) => node.id) } } }),
      this.prisma.sellPrice.findMany({ where: { ownerId: { in: path.map((node) => node.id) } } }),
    ]);
    const rows = packages.map((pkg) => ({
      pkg,
      row: this.userPackageRow(pkg, path, terms.filter((term) => term.packageId === pkg.id), sells.filter((sell) => sell.packageId === pkg.id), lineCountsByPackage),
    }));
    const companies = new Map<string, { code: string; name: string; packages: UserPackageRow[] }>();
    for (const { pkg, row } of rows) {
      const key = pkg.company?.code ?? '';
      const group = companies.get(key) ?? { code: key, name: pkg.company?.name ?? '', packages: [] };
      group.packages.push(row);
      companies.set(key, group);
    }
    return { summary: summarize(rows.map((item) => item.row)), companies: [...companies.values()] };
  }

  async setUserPackage(gate: Gate, loginName: string, code: string, body: { hidden?: unknown; price?: unknown; renewalPrice?: unknown }) {
    const patch = termPatch(body);
    if (!patch) fail(400, 'INVALID');
    const { actor, path, target, accounts } = await this.termTarget(gate, loginName);
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const { terms, sells } = await this.termsFor(pkg.id);
    const lineCountsByPackage = await this.renewableLinesByPackage(target.id, target.layer, accounts);
    return this.writeUserPackage(actor, path, pkg, patch, terms, sells, this.prisma, lineCountsByPackage);
  }

  /** Hide or show several packages at once. Packages hidden higher up are left alone. */
  async setUserPackagesBulk(gate: Gate, loginName: string, body: { codes?: unknown; hidden?: unknown }) {
    if (!Array.isArray(body.codes) || body.codes.some((code) => typeof code !== 'string' || !code) || typeof body.hidden !== 'boolean') fail(400, 'INVALID');
    const codes = new Set(body.codes as string[]);
    const hidden = body.hidden as boolean;
    const { actor, path, target, accounts } = await this.termTarget(gate, loginName);
    const pathIds = path.map((node) => node.id);
    const lineCountsByPackage = await this.renewableLinesByPackage(target.id, target.layer, accounts);
    // The path's rows for every package on sale, loaded once: the picked ones are written, all of
    // them feed the summary. Every write sits in one transaction so a refusal midway applies nothing.
    const [packages, terms, sells] = await Promise.all([
      this.prisma.package.findMany({ where: { enabled: true, forSale: true } }),
      this.prisma.userPackage.findMany({ where: { userId: { in: pathIds } }, select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true } }),
      this.prisma.sellPrice.findMany({ where: { ownerId: { in: pathIds } }, select: { packageId: true, ownerId: true, price: true, renewalPrice: true } }),
    ]);
    const termsOf = (packageId: string) => terms.filter((row) => row.packageId === packageId);
    const sellsOf = (packageId: string) => sells.filter((row) => row.packageId === packageId);
    const written = new Map<string, TermRow[]>();
    await this.runTx(async (tx) => {
      for (const pkg of packages) {
        if (!codes.has(pkg.code)) continue;
        const own = termsOf(pkg.id);
        if (hiddenAbove(path, own)) continue;
        await this.writeUserPackage(actor, path, pkg, { hidden }, own, sellsOf(pkg.id), tx, lineCountsByPackage);
        written.set(pkg.id, own);
      }
    });
    const rows = packages.map((pkg) => this.userPackageRow(pkg, path, written.get(pkg.id) ?? termsOf(pkg.id), sellsOf(pkg.id), lineCountsByPackage));
    return { summary: summarize(rows) };
  }

  async userOps(gate: Gate, loginName: string) {
    const { target, path } = await this.termTarget(gate, loginName);
    return { denied: parseOps(target.deniedOps), deniedAbove: deniedAbove(path) };
  }

  async setUserOps(gate: Gate, loginName: string, body: { denied?: unknown }) {
    if (!Array.isArray(body.denied) || body.denied.some((key) => typeof key !== 'string' || !isOpKey(key))) fail(400, 'INVALID');
    const { target, path } = await this.termTarget(gate, loginName);
    const deniedOps = serializeOps(body.denied as string[]);
    await this.prisma.user.update({ where: { id: target.id }, data: { deniedOps } });
    return { denied: parseOps(deniedOps), deniedAbove: deniedAbove(path) };
  }

  /** Users whose price for `code` differs from what they would pay by default. Branch only. */
  async customPrices(gate: Gate, code: string): Promise<CustomPriceRow[]> {
    await this.branchActor(gate);
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const [accounts, { terms, sells }] = await Promise.all([this.accounts(), this.termsFor(pkg.id)]);
    return terms
      .filter((term) => term.price !== null || term.renewalPrice !== null)
      .map((term) => this.customPriceRow(term.userId, pkg, accounts, terms, sells))
      .filter((row): row is CustomPriceRow => row !== null)
      .sort((a, b) => a.loginName.localeCompare(b.loginName));
  }

  async setCustomPrice(gate: Gate, code: string, loginName: string, body: { price?: unknown; renewalPrice?: unknown }) {
    const patch = termPatch({ price: body.price, renewalPrice: body.renewalPrice });
    if (!patch) fail(400, 'INVALID');
    const { actor, target, accounts, path } = await this.termTarget(gate, loginName);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const { terms, sells } = await this.termsFor(pkg.id);
    await this.writeUserPackage(actor, path, pkg, patch, terms, sells);
    const row = this.customPriceRow(target.id, pkg, accounts, terms, sells);
    if (!row) fail(404, 'NOT_FOUND');
    return row;
  }

  async clearCustomPrice(gate: Gate, code: string, loginName: string) {
    const { actor, path } = await this.termTarget(gate, loginName);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const { terms, sells } = await this.termsFor(pkg.id);
    await this.writeUserPackage(actor, path, pkg, { price: null, renewalPrice: null }, terms, sells);
    return { ok: true as const };
  }

  /**
   * The renewable numbers of a package in a scope, grouped by the renewal price each one carries, and
   * what a new activation would pay on the scope account (`null` for the whole system: it differs per number).
   */
  async linePrices(gate: Gate, code: string, query: { scope?: unknown }): Promise<{ current: number | null; groups: PriceGroup[] }> {
    const [actor, accounts] = await Promise.all([this.actor(gate), this.accounts()]);
    const scope = await this.lineScope(actor, accounts, query.scope);
    const pkg = await this.prisma.package.findUnique({ where: { code }, include: { company: true, provider: true } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const lines = await this.prisma.line.findMany({ where: this.scopeLineWhere(scope, accounts, pkg.id), select: { terms: true } });
    const groups = groupLinePrices(lines.map((line) => ({ terms: lineTermsOf(line.terms, pkg) })));
    if (scope.kind === 'all') return { current: null, groups };
    const { terms, sells } = await this.termsFor(pkg.id);
    return { current: buyPriceFor(this.pathOf(scope.id, accounts), terms, sells, pkg, 'renewal'), groups };
  }

  /**
   * Reprices the renewable numbers of a package in a scope, one price group at a time: every number
   * carrying `from` takes `to`, a flat price or what a new activation would carry now. Numbers in no
   * listed group stay as they are. One transaction, so a refusal anywhere applies nothing.
   */
  async setLinePrices(gate: Gate, code: string, body: { scope?: unknown; groups?: unknown }): Promise<{ ok: true; lines: number }> {
    const changes = groupChanges(body.groups);
    if (!changes) fail(400, 'INVALID');
    const [actor, accounts] = await Promise.all([this.actor(gate), this.accounts()]);
    const scope = await this.lineScope(actor, accounts, body.scope);
    const pkg = await this.prisma.package.findUnique({ where: { code }, select: { id: true } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const lines = await this.runTx(async (tx) => {
      const found = await tx.line.findMany({
        where: this.scopeLineWhere(scope, accounts, pkg.id),
        include: { package: { include: { company: true, provider: true } } },
      });
      return this.repriceLines(
        tx,
        found,
        (line) => {
          const price = lineTermsOf(line.terms, line.package).renewal.posPrice;
          const change = changes.find((item) => item.from === price);
          return change ? { to: change.to } : null;
        },
        accounts,
      );
    });
    return { ok: true as const, lines };
  }

  /**
   * What a line-prices request covers. The whole system is for the branch owner, or staff who may edit.
   * An account is for whoever may write a custom price on it (its parent, or the branch), and for an agent
   * or main agent naming itself: the table over its own subtree. A point of sale never opens it, and an
   * impersonated session writes no prices.
   */
  private async lineScope(actor: Actor, accounts: Account[], scope: unknown): Promise<LineScope> {
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    if (scope === 'all') {
      if (actor.layer !== 'branch' || (!actor.isBranchOwner && !actor.grants.includes('edit'))) fail(403, 'FORBIDDEN');
      return { kind: 'all' };
    }
    if (typeof scope !== 'string' || !scope) fail(400, 'INVALID');
    const target = accounts.find((account) => account.loginName === scope);
    if (!target) fail(404, 'NOT_FOUND');
    if (target.layer === 'branch') fail(400, 'INVALID');
    const reachable = visibleAccountIds(actor.id, actor.layer, accounts).has(target.id);
    if (!reachable || (target.id !== actor.id && !this.canEditTerms(actor, target))) fail(403, 'FORBIDDEN');
    return { kind: 'account', id: target.id, loginName: target.loginName, layer: target.layer };
  }

  /** The numbers a table lists and a save may change: one package, in the scope, never a disconnected one. */
  private scopeLineWhere(scope: LineScope, accounts: Account[], packageId: string) {
    return {
      packageId,
      status: { in: [...RENEWABLE_STATUSES] },
      ...(scope.kind === 'account' ? { posId: { in: [...visibleAccountIds(scope.id, scope.layer, accounts)] } } : {}),
    };
  }

  /**
   * Rewrites the renewal terms of the numbers `planFor` names, in the caller's transaction, and returns how
   * many it wrote. A flat price may not sit below the floor of that number's point of sale. `'current'`
   * rebuilds the ladder and the renewal targets as an activation captures them today, priced through the
   * number's own path, so a nearer custom price still wins. Everything the batch needs is read once and every
   * number is checked before the first write, so one refusal applies nothing.
   */
  private async repriceLines(
    tx: Prisma.TransactionClient,
    lines: RepriceLine[],
    planFor: (line: RepriceLine) => LineTarget | null,
    accounts: Account[],
  ): Promise<number> {
    const plans = lines.flatMap((line) => {
      const target = planFor(line);
      return target ? [{ line, to: target.to }] : [];
    });
    if (plans.length === 0) return 0;
    const paths = new Map<string, PathNode[]>();
    const pathOf = (posId: string) => {
      const known = paths.get(posId) ?? this.pathOf(posId, accounts);
      paths.set(posId, known);
      return known;
    };
    const packageIds = [...new Set(plans.map(({ line }) => line.package.id))];

    // `'current'` needs the renewal targets each package lists today.
    const renewals = plans.some(({ to }) => to === 'current')
      ? await tx.packageRenewal.findMany({
          where: { packageId: { in: packageIds } },
          include: { target: { include: { company: true, provider: true } } },
        })
      : [];
    const targetsOf = new Map<string, PackageTerms[]>();
    for (const renewal of renewals) {
      if (!renewal.target.company || !renewal.target.provider) fail(400, 'INVALID');
      targetsOf.set(renewal.packageId, [...(targetsOf.get(renewal.packageId) ?? []), packageTermsOf(renewal.target)]);
    }

    // One read of the price rows serves every number in the batch, a flat price and `'current'` alike:
    // the batch's packages and the renewal targets they list, for every account on any number's path.
    const codes = new Set(plans.map(({ line }) => line.package.code));
    for (const targets of targetsOf.values()) for (const target of targets) codes.add(target.code);
    const pathIds = [...new Set(plans.flatMap(({ line }) => pathOf(line.posId).map((node) => node.id)))];
    const rows = await this.ladderRows([...codes], pathIds, tx);

    const fresh = new Map<string, LineTerms>();
    const floors = new Map<string, number>();
    const changes: { id: string; terms: LineTerms }[] = [];
    for (const { line, to } of plans) {
      const terms = lineTermsOf(line.terms, line.package);
      const path = pathOf(line.posId);
      // Every number of one package at one point of sale takes the same ladder and answers to the same floor, so each is worked out once.
      const key = `${line.package.id}:${line.posId}`;
      if (to === 'current') {
        if (!line.package.company || !line.package.provider) fail(400, 'INVALID');
        const ladder = fresh.get(key) ?? this.stampWith(captureTerms(packageTermsOf(line.package), targetsOf.get(line.package.id) ?? []), path, rows);
        fresh.set(key, ladder);
        changes.push({ id: line.id, terms: repriceLine(terms, { to, fresh: ladder }) });
        continue;
      }
      const floor =
        floors.get(key) ??
        floorFor(
          path,
          rows.termRows.filter((row) => row.packageId === line.package.id),
          rows.sellRows.filter((row) => row.packageId === line.package.id),
          line.package,
          'renewal',
        );
      floors.set(key, floor);
      if (to < floor) fail(400, 'PRICE_BELOW_FLOOR');
      changes.push({ id: line.id, terms: repriceLine(terms, { to }) });
    }
    for (const { id, terms } of changes) {
      await tx.line.update({ where: { id }, data: { terms: terms as unknown as Prisma.InputJsonValue } });
    }
    return changes.length;
  }

  /** Resolves the account whose terms are edited and checks the actor may edit them. */
  private async termTarget(gate: Gate, loginName: string) {
    const [actor, accounts] = await Promise.all([this.actor(gate), this.accounts()]);
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target) fail(404, 'NOT_FOUND');
    if (target.layer === 'branch') fail(400, 'INVALID');
    if (!this.canEditTerms(actor, target)) fail(403, 'FORBIDDEN');
    return { actor, target, accounts, path: this.pathOf(target.id, accounts) };
  }

  /**
   * The one writer for a user's row on a package. Refuses to show what an ancestor hid, checks
   * each price against the parent's own buy price, and deletes a row that is back on defaults.
   * `terms` is updated in place so the caller can compute the returned row from it.
   */
  private async writeUserPackage(
    actor: Actor,
    path: PathNode[],
    pkg: { id: string } & PackageFacts,
    patch: TermPatch,
    terms: TermRow[],
    sells: SellRow[],
    db: Prisma.TransactionClient | PrismaClient = this.prisma,
    lineCountsByPackage: Map<string, number> = new Map(),
  ): Promise<UserPackageRow> {
    const userId = path[0].id;
    const index = terms.findIndex((term) => term.userId === userId);
    const own = index >= 0 ? terms[index] : null;
    if (patch.hidden === false && hiddenAbove(path, terms)) fail(403, 'FORBIDDEN');
    const next: TermRow = {
      userId,
      hidden: patch.hidden ?? own?.hidden ?? false,
      price: patch.price === undefined ? (own?.price ?? null) : patch.price,
      renewalPrice: patch.renewalPrice === undefined ? (own?.renewalPrice ?? null) : patch.renewalPrice,
    };
    // The floor is checked at write time only, and only for the price this patch sets: a later
    // rise of the parent's buy price must not block the hide/show switch on an older row.
    if (patch.price != null && patch.price < floorFor(path, terms, sells, pkg, 'subscription')) fail(400, 'PRICE_BELOW_FLOOR');
    if (patch.renewalPrice != null && patch.renewalPrice < floorFor(path, terms, sells, pkg, 'renewal')) fail(400, 'PRICE_BELOW_FLOOR');
    const where = { packageId_userId: { packageId: pkg.id, userId } };
    if (!next.hidden && next.price === null && next.renewalPrice === null) {
      if (own) {
        await db.userPackage.delete({ where });
        terms.splice(index, 1);
      }
    } else {
      const data = { hidden: next.hidden, price: next.price, renewalPrice: next.renewalPrice, setById: actor.id };
      await db.userPackage.upsert({ where, update: data, create: { packageId: pkg.id, userId, ...data } });
      if (own) terms[index] = next;
      else terms.push(next);
    }
    return this.userPackageRow(pkg, path, terms, sells, lineCountsByPackage);
  }

  /** Renewable line counts per package under `targetId`'s subtree (visible POS ids). */
  private async renewableLinesByPackage(targetId: string, targetLayer: string, accounts: Account[]): Promise<Map<string, number>> {
    const posIds = [...visibleAccountIds(targetId, targetLayer, accounts)];
    if (posIds.length === 0) return new Map();
    const groups = await this.prisma.line.groupBy({
      by: ['packageId'],
      where: { status: { in: [...RENEWABLE_STATUSES] }, posId: { in: posIds } },
      _count: { _all: true },
    });
    return new Map(groups.map((row) => [row.packageId, row._count._all]));
  }

  private userPackageRow(
    pkg: PackageFacts,
    path: PathNode[],
    terms: TermRow[],
    sells: SellRow[],
    lineCountsByPackage: Map<string, number> = new Map(),
  ): UserPackageRow {
    const own = terms.find((term) => term.userId === path[0].id);
    return {
      code: pkg.code,
      name: pkg.name,
      dataGb: pkg.dataGb,
      months: pkg.months,
      companyCode: pkg.company?.code ?? '',
      hidden: own?.hidden ?? false,
      hiddenAbove: hiddenAbove(path, terms),
      parentBuy: floorFor(path, terms, sells, pkg, 'subscription'),
      parentRenewalBuy: floorFor(path, terms, sells, pkg, 'renewal'),
      price: own?.price ?? null,
      renewalPrice: own?.renewalPrice ?? null,
      effective: buyPriceFor(path, terms, sells, pkg, 'subscription'),
      renewalEffective: buyPriceFor(path, terms, sells, pkg, 'renewal'),
      source: priceSource(path, terms, sells, 'subscription'),
      lines: lineCountsByPackage.get(pkg.id) ?? 0,
    };
  }

  private customPriceRow(userId: string, pkg: LayerPrices, accounts: Account[], terms: TermRow[], sells: SellRow[]): CustomPriceRow | null {
    const path = this.pathOf(userId, accounts);
    if (path.length === 0) return null;
    const account = accounts.find((item) => item.id === userId) as Account;
    const own = terms.find((term) => term.userId === userId);
    const without = terms.filter((term) => term.userId !== userId);
    return {
      loginName: account.loginName,
      nickname: account.nickname,
      layer: account.layer,
      parentLogin: path[1]?.loginName ?? '',
      defaultPrice: buyPriceFor(path, without, sells, pkg, 'subscription'),
      defaultRenewalPrice: buyPriceFor(path, without, sells, pkg, 'renewal'),
      price: own?.price ?? null,
      renewalPrice: own?.renewalPrice ?? null,
    };
  }

  async setFrozen(gate: Gate, loginName: string, frozen: boolean) {
    const actor = await this.branchActor(gate);
    if (actor.impersonating) fail(403, 'FORBIDDEN');
    const target = await this.prisma.user.findUnique({ where: { loginName }, include: { role: true } });
    if (!target || target.isBranchOwner) fail(403, 'FORBIDDEN');
    if (!actor.isBranchOwner && !actor.grants.includes('staff')) fail(403, 'FORBIDDEN');
    if (target.role?.staff && !actor.isBranchOwner) fail(403, 'FORBIDDEN');
    await this.prisma.user.update({ where: { id: target.id }, data: { disabledAt: frozen ? new Date() : null } });
    if (frozen) {
      const held = await this.prisma.officeTask.findMany({ where: { assigneeId: target.id, status: 'working' } });
      for (const task of held) {
        await this.prisma.officeTask.update({
          where: { id: task.id },
          data: {
            status: 'pending',
            assigneeId: null,
            resultNote: 'رجع لأن الحساب أُوقف',
            log: this.noteLog(task.log, 'رجعت لأن الحساب أُوقف'),
          },
        });
      }
      await this.auth.dropLiveSessions(target.id);
    }
    return { ok: true };
  }

  async removeUser(gate: Gate, loginName: string) {
    const actor = await this.branchActor(gate);
    if (actor.impersonating) fail(403, 'FORBIDDEN');
    const target = await this.prisma.user.findUnique({ where: { loginName } });
    if (!target || target.isBranchOwner || target.id === actor.id) fail(403, 'FORBIDDEN');
    const [children, lines, tasks, entries] = await Promise.all([
      this.prisma.user.count({ where: { parentId: target.id } }),
      this.prisma.line.count({ where: { posId: target.id } }),
      this.prisma.officeTask.count({ where: { OR: [{ submitterId: target.id }, { posId: target.id }, { assigneeId: target.id }] } }),
      this.prisma.walletEntry.count({ where: { OR: [{ userId: target.id }, { actorId: target.id }] } }),
    ]);
    if (children + lines + tasks + entries > 0) fail(400, 'HAS_HISTORY');
    await this.auth.dropLiveSessions(target.id);
    await this.prisma.session.deleteMany({ where: { userId: target.id } });
    await this.prisma.wallet.deleteMany({ where: { userId: target.id } });
    await this.prisma.userPackage.deleteMany({ where: { userId: target.id } });
    await this.prisma.sellPrice.deleteMany({ where: { ownerId: target.id } });
    await this.prisma.user.delete({ where: { id: target.id } });
    return { ok: true };
  }

  async enter(gate: Gate, loginName: string, meta: { userAgent: string; ip: string }) {
    const actor = await this.actor(gate);
    if (actor.impersonating || actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    if (!actor.isBranchOwner && !actor.grants.includes('enter')) fail(403, 'FORBIDDEN');
    const target = await this.prisma.user.findUnique({ where: { loginName } });
    if (!target || target.disabledAt || target.id === actor.id) fail(400, 'INVALID');
    await this.prisma.accessLog.create({ data: { actorId: actor.operatorId, targetLogin: target.loginName, ip: meta.ip } });
    const sessionId = await this.auth.saveImpersonation({ userId: target.id, userAgent: meta.userAgent, ip: meta.ip });
    return { sessionId };
  }

  async leave(gate: Gate) {
    const live = gate.sessionId ? await this.auth.liveSession(gate.sessionId) : null;
    if (!live || live.session.kind !== 'impersonation') fail(400, 'INVALID');
    await this.auth.revokeSessions([live.session.id]);
    return { ok: true };
  }

  async ledger(gate: Gate, scope: string, query: { kind?: string; direction?: string; from?: string; to?: string; cursor?: string }) {
    const actor = await this.actor(gate);
    const operationKinds = PROVIDER_OPERATION_KINDS;
    const auditKinds = [...operationKinds, 'fund', 'self_fund'];
    if (scope !== 'operations' && scope !== 'audit') fail(404, 'NOT_FOUND');
    const allowed = scope === 'operations' ? operationKinds : auditKinds;
    const kind = query.kind && allowed.includes(query.kind) ? query.kind : '';
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59` : query.to) : null;
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    const where = {
      userId: actor.id,
      kind: { in: kind ? [kind] : allowed },
      ...(query.direction === 'in' ? { amount: { gt: 0 } } : {}),
      ...(query.direction === 'out' ? { amount: { lt: 0 } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    };
    const [read, total] = await Promise.all([
      this.prisma.walletEntry.findMany({
        where: { ...where, AND: afterFeed(feedPosition(query.cursor)) },
        include: { actor: true },
        orderBy: [...NEWEST_FIRST],
        take: FEED_PAGE + 1,
      }),
      this.prisma.walletEntry.count({ where }),
    ]);
    const { page: rows, nextCursor } = mergeFeed([read], FEED_PAGE);
    return {
      entries: rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        kind: row.kind,
        amount: row.amount,
        balanceBefore: row.balanceAfter - row.amount,
        balanceAfter: row.balanceAfter,
        note: row.note,
        packageName: row.packageName,
        msisdn: row.msisdn,
        actorLogin: row.actor.loginName,
      })),
      nextCursor,
      total,
    };
  }

  async audit(gate: Gate, query: { cursor?: string; action?: string; result?: string; layer?: string; q?: string; from?: string; to?: string } = {}) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const position = feedPosition(query.cursor);
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999Z` : query.to) : null;
    const range = clampActivityRange(from, to);
    const needle = (query.q ?? '').trim();
    const where: Prisma.ActivityEventWhereInput = {
      ...activityActorFilter(actor.layer, [...visible]),
      ...(query.action ? { action: query.action } : {}),
      ...(query.result === 'ok' || query.result === 'fail' ? { result: query.result } : {}),
      ...(query.layer ? { actorLayer: query.layer } : {}),
      at: { gte: range.gte, lte: range.lte },
      ...(needle
        ? { OR: [{ actorLogin: { contains: needle, mode: 'insensitive' } }, { subjectRef: { contains: needle, mode: 'insensitive' } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.activityEvent.findMany({
        where: {
          ...where,
          ...(position
            ? { AND: [{ OR: [{ at: { lt: position.at } }, { at: position.at, id: { lt: position.id } }] }] }
            : {}),
        },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: FEED_PAGE + 1,
      }),
      this.prisma.activityEvent.count({ where }),
    ]);
    const page = rows.slice(0, FEED_PAGE);
    const last = page[page.length - 1];
    return {
      total,
      entries: page.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        action: row.action,
        result: row.result,
        reason: row.reason,
        ip: row.ip,
        actorLogin: row.actorLogin,
        actorLayer: row.actorLayer,
        subjectKind: row.subjectKind,
        subjectRef: row.subjectRef,
      })),
      nextCursor: rows.length > FEED_PAGE && last ? encodeFeedCursor({ createdAt: last.at, id: last.id }) : null,
    };
  }

  async providerOperations(gate: Gate, query: { cursor?: string; kind?: string; provider?: string; q?: string; from?: string; to?: string } = {}) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    if (!actor.isBranchOwner && !actor.grants.includes('reports')) fail(403, 'REPORTS_BRANCH_ONLY');
    const kind = query.kind && PROVIDER_OPERATION_KINDS.includes(query.kind) ? query.kind : '';
    const needle = (query.q ?? '').replace(/\s/g, '');
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999` : query.to) : null;
    const rows = await this.prisma.walletEntry.findMany({
      where: {
        kind: { in: kind ? [kind] : PROVIDER_OPERATION_KINDS },
        ...(needle ? { msisdn: { contains: needle } } : {}),
      },
      orderBy: [...NEWEST_FIRST],
    });
    const lineIds = [...new Set(rows.flatMap((row) => (row.lineId ? [row.lineId] : [])))];
    const [lines, packages, providers] = await Promise.all([
      lineIds.length
        ? this.prisma.line.findMany({
            where: { id: { in: lineIds } },
            include: { package: { include: { provider: true, company: true } } },
          })
        : [],
      this.prisma.package.findMany({ include: { provider: true, company: true } }),
      this.prisma.provider.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const lineById = new Map(lines.map((line) => [line.id, line]));
    const resolved = rows.map((row) => {
      const priced = pricedOp(row.kind, row.packageName ?? '', row.companyName ?? '', row.lineId ? lineById.get(row.lineId) : undefined, packages);
      return {
        id: row.id,
        at: row.createdAt,
        kind: row.kind,
        msisdn: row.msisdn ?? '',
        companyName: row.companyName ?? '',
        packageName: row.packageName ?? '',
        ...priced,
        cost: row.providerCost ?? priced.cost,
        esimPrice: row.esimPrice ?? null,
      };
    });
    const chosen = query.provider ? resolved.filter((row) => row.providerCode === query.provider) : resolved;
    const ranged = chosen.filter((row) => {
      if (from && !Number.isNaN(from.getTime()) && row.at < from) return false;
      if (to && !Number.isNaN(to.getTime()) && row.at > to) return false;
      return true;
    });
    const now = new Date();
    const monthCost = chosen
      .filter((row) => row.at.getFullYear() === now.getFullYear() && row.at.getMonth() === now.getMonth())
      .reduce((sum, row) => sum + row.cost, 0);
    const position = query.cursor ? feedPosition(query.cursor) : undefined;
    const window = position
      ? ranged.filter((row) => row.at < position.at || (row.at.getTime() === position.at.getTime() && row.id < position.id))
      : ranged;
    const page = window.slice(0, FEED_PAGE);
    const last = page[page.length - 1];
    return {
      entries: page.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        kind: row.kind,
        msisdn: row.msisdn,
        providerCode: row.providerCode,
        providerName: row.providerName,
        companyName: row.companyName,
        packageName: row.packageName,
        cost: row.cost,
        esimPrice: row.esimPrice,
      })),
      nextCursor: window.length > FEED_PAGE && last ? encodeFeedCursor({ createdAt: last.at, id: last.id }) : null,
      total: ranged.length,
      stats: { count: ranged.length, cost: ranged.reduce((sum, row) => sum + row.cost, 0), monthCost },
      providers: providers.map((item) => ({ code: item.code, name: item.name })),
    };
  }

  async finance(gate: Gate, query: { cursor?: string; kind?: string; layer?: string; q?: string; from?: string; to?: string } = {}) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const visible = [...visibleAccountIds(actor.id, actor.layer, accounts)];
    const position = feedPosition(query.cursor);
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to.length === 10 ? `${query.to}T23:59:59.999` : query.to) : null;
    const createdAt = {
      ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
    };
    const needle = (query.q ?? '').trim();
    const digits = needle.replace(/\s/g, '');
    const where: Prisma.WalletEntryWhereInput = {
      ...(actor.layer === 'branch' ? {} : { userId: { in: visible } }),
      amount: { not: 0 },
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.layer ? { user: { layer: query.layer } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(needle
        ? {
            OR: [
              ...(digits ? [{ msisdn: { contains: digits } }] : []),
              { note: { contains: needle, mode: 'insensitive' as const } },
              { packageName: { contains: needle, mode: 'insensitive' as const } },
              { companyName: { contains: needle, mode: 'insensitive' as const } },
              { user: { loginName: { contains: needle, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.walletEntry.findMany({
        where: {
          ...where,
          ...(position ? { AND: [{ OR: [{ createdAt: { lt: position.at } }, { createdAt: position.at, id: { lt: position.id } }] }] } : {}),
        },
        include: { user: true, actor: true },
        orderBy: [...NEWEST_FIRST],
        take: FEED_PAGE + 1,
      }),
      this.prisma.walletEntry.count({ where }),
    ]);
    const page = rows.slice(0, FEED_PAGE);
    const last = page[page.length - 1];
    return {
      total,
      entries: page.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        loginName: row.user.loginName,
        layer: row.user.layer,
        actorLogin: row.actor.loginName,
        kind: row.kind,
        amount: row.amount,
        balanceBefore: row.balanceAfter - row.amount,
        balanceAfter: row.balanceAfter,
        msisdn: row.msisdn ?? '',
        companyName: row.companyName ?? '',
        packageName: row.packageName ?? '',
        packagePrice: row.packagePrice,
        esimPrice: row.esimPrice ?? null,
        note: row.note ?? '',
      })),
      nextCursor: rows.length > FEED_PAGE && last ? encodeFeedCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
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

  private async actor(gate: Gate): Promise<Actor> {
    const sessionId = gate.sessionId;
    if (!sessionId) fail(401, 'LOGIN_REQUIRED');
    const live = await this.auth.liveSession(sessionId);
    if (!live || live.session.scope !== 'full' || live.user.disabledAt) fail(401, 'LOGIN_REQUIRED');
    await this.auth.touchSession(sessionId);
    const impersonating = live.session.kind === 'impersonation';
    let operatorId = live.user.id;
    if (impersonating && gate.homeId) {
      const home = await this.auth.liveSession(gate.homeId);
      if (home && home.session.scope === 'full' && home.user.layer === 'branch' && !home.user.disabledAt) operatorId = home.user.id;
    }
    const stored = await this.prisma.user.findUnique({
      where: { id: live.user.id },
      include: { role: true, extraRoles: { include: { role: true } } },
    });
    const grants = await this.grantsFor(stored);
    return {
      id: live.user.id,
      loginName: live.user.loginName,
      nickname: live.user.nickname || live.user.loginName,
      layer: live.user.layer,
      isBranchOwner: live.user.isBranchOwner,
      grants,
      operatorId,
      impersonating,
    };
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

  /** The accounts from `userId` up to the root. Empty when the user is unknown. */
  private pathOf(userId: string, accounts: Account[]): PathNode[] {
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const path: PathNode[] = [];
    let current = byId.get(userId);
    while (current && path.length <= accounts.length) {
      path.push(nodeOf(current));
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  }

  private async termsFor(packageId: string): Promise<{ terms: TermRow[]; sells: SellRow[] }> {
    const [terms, sells] = await Promise.all([
      this.prisma.userPackage.findMany({ where: { packageId }, select: { userId: true, hidden: true, price: true, renewalPrice: true } }),
      this.prisma.sellPrice.findMany({ where: { packageId }, select: { ownerId: true, price: true, renewalPrice: true } }),
    ]);
    return { terms, sells };
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

  private canEditTerms(actor: Actor, target: Account): boolean {
    if (actor.impersonating) return false;
    if (target.parentId === actor.id) return true;
    return actor.layer === 'branch' && (actor.isBranchOwner || actor.grants.includes('edit'));
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

  /**
   * The rows behind what points of sale pay: the price columns of the packages named by `codes`, and
   * the custom rows and sell prices written on them for the accounts in `pathIds`. One read per table,
   * however many packages and paths are asked for, so a batch loads once and stamps every number from it.
   */
  private async ladderRows(codes: string[], pathIds: string[], db: Prisma.TransactionClient | PrismaClient): Promise<LadderRows> {
    const packages = await db.package.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, ...PRICE_COLUMNS },
    });
    const ids = packages.map((row) => row.id);
    const [termRows, sellRows] = await Promise.all([
      db.userPackage.findMany({
        where: { packageId: { in: ids }, userId: { in: pathIds } },
        select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
      }),
      db.sellPrice.findMany({
        where: { packageId: { in: ids }, ownerId: { in: pathIds } },
        select: { packageId: true, ownerId: true, price: true, renewalPrice: true },
      }),
    ]);
    return { packages, termRows, sellRows };
  }

  /**
   * `stampFor` once the rows are loaded: no database. `rows` may hold the rows of many paths. Each
   * price is resolved through `path` alone, so the rows of other accounts are never read for it.
   */
  private stampWith(terms: LineTerms, path: PathNode[], rows: LadderRows): LineTerms {
    if (path.length === 0) return terms;
    return stampRenewal(terms, (code) => {
      const pkg = rows.packages.find((row) => row.code === code);
      if (!pkg) return null;
      const termsOf = rows.termRows.filter((row) => row.packageId === pkg.id);
      const sellsOf = rows.sellRows.filter((row) => row.packageId === pkg.id);
      return buyPriceFor(path, termsOf, sellsOf, pkg, 'renewal');
    });
  }

  private noteLog(current: string, line: string) {
    return stampTaskLog(current, line);
  }

  private async branchActor(gate: Gate): Promise<Actor> {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    return actor;
  }

  private chainIds(actorId: string, accounts: Account[]): string[] {
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const ids: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(actorId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      ids.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return ids;
  }

  private async grantsFor(stored: {
    isBranchOwner?: boolean;
    liveGrants?: string | null;
    layer?: string;
    roleId?: string | null;
    extraGrants?: string | null;
    deniedGrants?: string | null;
    role?: { grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean } | null;
    extraRoles?: { role: { grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean } }[];
  } | null): Promise<string[]> {
    if (stored?.isBranchOwner) return [...GRANT_CODES];
    if (!stored?.layer || !this.prisma.role) return (stored?.liveGrants ?? '').split(',').filter(Boolean);
    const staff = stored.layer === 'branch' && Boolean(stored.roleId);
    const layerRole = staff ? null : await this.prisma.role.findUnique({ where: { layer: stored.layer } });
    return effectiveGrantCodes({
      owner: false,
      staff,
      layer: stored.layer,
      layerRole,
      roles: [stored.role, ...(stored.extraRoles ?? []).map((link) => link.role)],
      extra: stored.extraGrants,
      denied: stored.deniedGrants,
    });
  }

  private async ensureLayerRoles() {
    for (const layer of LAYER_ORDER) {
      const existing = await this.prisma.role.findUnique({ where: { layer } });
      if (existing) continue;
      const grants = LAYER_GRANTS[layer] ?? [];
      await this.prisma.role.create({
        data: { name: layer, kind: 'layer', layer, grants: grants.join(','), ...flagsFor(grants) },
      });
    }
  }

  private async visibleAccount(actor: Actor, loginName: string) {
    const target = await this.prisma.user.findUnique({ where: { loginName }, include: { role: true } });
    if (!target) fail(404, 'NOT_FOUND');
    const accounts = await this.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(403, 'FORBIDDEN');
    return target;
  }

  private async accounts(): Promise<Account[]> {
    return this.prisma.user.findMany({
      select: { id: true, loginName: true, nickname: true, layer: true, parentId: true, deniedOps: true, disabledAt: true },
      orderBy: { loginName: 'asc' },
    });
  }

  private async visibleLine(actor: Actor, lineId: string) {
    const line = await this.prisma.line.findUnique({
      where: { id: lineId },
      include: { package: { include: { company: true, provider: true } } },
    });
    if (!line) fail(404, 'NOT_FOUND');
    if (!line.package.company || !line.package.provider) fail(400, 'INVALID');
    const accounts = await this.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(line.posId)) fail(403, 'FORBIDDEN');
    // The stop belongs to the selling account that owns the line, not to whoever clicks. The path
    // travels with the line so later price and visibility checks do not load the accounts again.
    const posPath = this.pathOf(line.posId, accounts);
    return Object.assign(line, { denied: deniedOpsFor(posPath), posPath });
  }

  private async openTask(input: {
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
    const { task, written } = await this.runTx(async (tx) => {
      const created = await tx.officeTask.create({
        data: {
          action: input.action,
          status: 'pending',
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
        },
      });
      const named = await tx.package.findUnique({ where: { id: input.nextPackageId ?? input.packageId }, select: { name: true } });
      const notices = await this.taskNotice(tx, 'opened', created, input.actor, {
        packageName: named?.name ?? '',
        amount: input.posDelta,
      });
      return { task: created, written: notices };
    });
    await this.publishQuietly(written);
    return task;
  }

  /** Branch users who may take a task: the owner and anyone holding the handling grant. */
  private async handlerIds(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { layer: 'branch', disabledAt: null },
      include: { role: true, extraRoles: { include: { role: true } } },
    });
    const ids: string[] = [];
    for (const user of users) {
      if (user.isBranchOwner || (await this.grantsFor(user)).includes('tasks')) ids.push(user.id);
    }
    return ids;
  }

  private async taskNotice(
    tx: Prisma.TransactionClient,
    event: TaskEvent,
    task: { id: string; action: string; msisdn: string | null; submitterId: string; posId: string; assigneeId: string | null },
    actor: Actor,
    extra: Partial<TaskNoticePayload> = {},
  ): Promise<WrittenNotice[]> {
    const handlers = await this.handlerIds();
    const audience = taskAudience(event, task, handlers, { id: actor.id, handler: canHandleTasks(actor) });
    const payload: TaskNoticePayload = { taskId: task.id, action: task.action, msisdn: task.msisdn, ...extra };
    return this.notice.write(tx, audience, actor, { kind: `task.${event}`, payload });
  }

  async notices(gate: Gate, query: { cursor?: string; group?: string; unread?: string } = {}) {
    const actor = await this.actor(gate);
    const group = noticeGroupOf(query.group);
    const onlyUnread = query.unread === '1' || query.unread === 'true';
    const position = query.cursor ? feedPosition(query.cursor) : undefined;
    const where = {
      userId: actor.id,
      ...(group ? { kind: { in: [...NOTICE_GROUPS[group]] } } : {}),
      ...(onlyUnread ? { readAt: null } : {}),
    };
    const [rows, unread, total] = await Promise.all([
      this.prisma.notice.findMany({
        where: { ...where, AND: afterFeed(position) },
        orderBy: [...NEWEST_FIRST],
        take: NOTICES_PAGE + 1,
      }),
      this.prisma.notice.count({ where: { userId: actor.id, readAt: null } }),
      this.prisma.notice.count({ where }),
    ]);
    const { page, nextCursor } = mergeFeed([rows], NOTICES_PAGE);
    return {
      unread,
      total,
      notices: page.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        actorName: row.actorName,
        href: row.href,
        read: Boolean(row.readAt),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  async readNotices(gate: Gate, id?: string) {
    const actor = await this.actor(gate);
    await this.prisma.notice.updateMany({
      where: { userId: actor.id, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true as const };
  }

  /** One live channel per signed-in user. Resolves an unsubscribe function. */
  async subscribeNotices(gate: Gate, handler: (message: string) => void) {
    const actor = await this.actor(gate);
    return this.notice.subscribe(actor.id, handler);
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

  private async recordOp(tx: Prisma.TransactionClient, userId: string, actorId: string, kind: string, sale: Sale) {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) fail(404, 'NOT_FOUND');
    await tx.walletEntry.create({
      data: {
        userId,
        actorId,
        amount: 0,
        balanceAfter: wallet.balance,
        kind,
        msisdn: sale.msisdn,
        lineId: sale.lineId,
        companyName: sale.companyName,
        packageName: sale.packageName,
        packagePrice: sale.packagePrice,
        providerCost: sale.providerCost ?? 0,
        periodDays: sale.period?.days ?? null,
        periodEndsAt: sale.period?.endsAt ?? null,
      },
    });
  }

  /** Notices written inside a transaction wait here until that transaction commits. */
  private readonly queued = new WeakMap<object, WrittenNotice[]>();

  private queueNotices(tx: Prisma.TransactionClient, rows: WrittenNotice[]) {
    if (rows.length === 0) return;
    const list = this.queued.get(tx) ?? [];
    list.push(...rows);
    this.queued.set(tx, list);
  }

  /** Runs a transaction and publishes the notices it queued once it has committed. */
  private async runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let inner: Prisma.TransactionClient | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      inner = tx;
      return fn(tx);
    });
    const rows = inner ? this.queued.get(inner) ?? [] : [];
    if (inner) this.queued.delete(inner);
    if (rows.length > 0) await this.publishQuietly(rows);
    return result;
  }

  // The row is committed; the live push is a courtesy. The 60s poll in the browser picks up what Redis missed.
  private async publishQuietly(rows: WrittenNotice[]) {
    try {
      await this.notice.publish(rows);
    } catch (error) {
      console.warn('notice publish failed', error instanceof Error ? error.message : error);
    }
  }

  private async actorName(id: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { nickname: true, loginName: true } });
    return user?.nickname || user?.loginName || '';
  }

  private async move(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, kind: string, note: string, sale?: Sale) {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!wallet || !user) fail(404, 'NOT_FOUND');
    const debit = amount < 0 ? -amount : 0;
    if (!withinCeiling(user.layer, wallet.balance, wallet.ceiling, debit)) {
      // The transaction rolls back, so this notice is written on its own and published at once.
      const actor = { id: actorId, nickname: await this.actorName(actorId) };
      const audience = [userId, ...(user.parentId ? [user.parentId] : [])];
      const rows = await this.notice.write(this.prisma, audience, actor, {
        kind: 'wallet.ceiling',
        payload: { balance: wallet.balance, ceiling: wallet.ceiling, attempted: debit, loginName: user.loginName },
      });
      await this.publishQuietly(rows);
      fail(400, 'BALANCE_CEILING');
    }
    const balanceAfter = wallet.balance + amount;
    if (wallet.balance >= 0 && balanceAfter < 0) {
      const actor = { id: actorId, nickname: await this.actorName(actorId) };
      const audience = [userId, ...(user.parentId ? [user.parentId] : [])];
      this.queueNotices(tx, await this.notice.write(tx, audience, actor, {
        kind: 'wallet.negative',
        payload: { balance: balanceAfter, ceiling: wallet.ceiling, loginName: user.loginName },
      }));
    }
    await tx.wallet.update({ where: { userId }, data: { balance: balanceAfter } });
    await tx.walletEntry.create({
      data: {
        userId,
        actorId,
        amount,
        balanceAfter,
        kind,
        note: note || null,
        msisdn: sale?.msisdn,
        lineId: sale?.lineId,
        companyName: sale?.companyName,
        packageName: sale?.packageName,
        packagePrice: sale?.packagePrice,
        providerCost: sale?.providerCost ?? null,
        esimPrice: sale?.esimPrice ?? null,
        periodDays: sale?.period?.days ?? null,
        periodEndsAt: sale?.period?.endsAt ?? null,
      },
    });
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

function saleOf(
  line: { id: string; msisdn: string; package: { name: string; posPrice: number; company: { name: string } | null } },
  pkg?: { name: string; posPrice: number; company: { name: string } | null },
  price?: number,
): Sale {
  const chosen = pkg ?? line.package;
  return {
    msisdn: line.msisdn,
    lineId: line.id,
    companyName: chosen.company?.name ?? '',
    packageName: chosen.name,
    packagePrice: price ?? chosen.posPrice,
  };
}

function pricesOf(row: Prices): Prices {
  return {
    branchCost: row.branchCost,
    mainPrice: row.mainPrice,
    agentPrice: row.agentPrice,
    posPrice: row.posPrice,
    subscriberPrice: row.subscriberPrice,
  };
}

function lineTermsOf(value: unknown, pkg: PackagePriceRow): LineTerms {
  if (value === null) return captureTerms(packageTermsOf(pkg), []);
  if (!isLineTerms(value)) throw new Error(`Invalid saved terms for package ${pkg.code}`);
  return value;
}

function isLineTerms(value: unknown): value is LineTerms {
  if (!isRecord(value)) return false;
  return (
    typeof value.packageCode === 'string' &&
    isPositiveInteger(value.months) &&
    (value.windowMonths === undefined || isPositiveInteger(value.windowMonths)) &&
    isPrices(value.subscription) &&
    isPrices(value.renewal) &&
    Array.isArray(value.renewalTargets) &&
    value.renewalTargets.every(
      (target) =>
        isRecord(target) &&
        typeof target.code === 'string' &&
        isPositiveInteger(target.months) &&
        isPrices(target.renewal),
    )
  );
}

function isPrices(value: unknown): value is Prices {
  if (!isRecord(value)) return false;
  return ['branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice'].every(
    (field) => typeof value[field] === 'number' && Number.isInteger(value[field]) && value[field] >= 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function positive(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100_000_000) return null;
  return value;
}

/** A QR picture as a data URL. `undefined` when absent, `null` when cleared, otherwise the checked URL. */
function readQr(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > QR_LIMIT || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) fail(400, 'QR_INVALID');
  return value;
}

function nonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100_000_000) return null;
  return value;
}

/** `undefined` means invalid; `null` means "clear". */
function optionalPrice(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  return nonNegative(value) ?? undefined;
}

/** Validates a user-package patch body. `null` when any field is malformed or nothing is set. */
function termPatch(body: { hidden?: unknown; price?: unknown; renewalPrice?: unknown }): TermPatch | null {
  const patch: TermPatch = {};
  if (body.hidden !== undefined) {
    if (typeof body.hidden !== 'boolean') return null;
    patch.hidden = body.hidden;
  }
  for (const key of ['price', 'renewalPrice'] as const) {
    if (body[key] === undefined) continue;
    const price = optionalPrice(body[key]);
    if (price === undefined) return null;
    patch[key] = price;
  }
  return Object.keys(patch).length ? patch : null;
}

function summarize(rows: UserPackageRow[]) {
  return {
    total: rows.length,
    visible: rows.filter((row) => !row.hidden && !row.hiddenAbove).length,
    custom: rows.filter((row) => row.price !== null || row.renewalPrice !== null).length,
  };
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
