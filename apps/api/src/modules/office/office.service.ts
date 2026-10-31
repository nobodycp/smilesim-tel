import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AUTH_STORE, AuthStore } from '../auth/auth.store';
import { hashPassword } from '../auth/password';
import { ERROR_MESSAGES, type ErrorCode } from '../../errors';
import { newPasswordProblem, nicknameProblem } from '../auth/validators';
import { catalog, companies, packageCode, packageName } from './office-catalog';
import {
  FEED_PAGE,
  LINES_PAGE,
  NEWEST_FIRST,
  TASKS_PAGE,
  afterFeed,
  decodeFeedCursor,
  idCursorArgs,
  linesWhere,
  mergeFeed,
  pageOf,
  taskStatusOf,
  type LineFilter,
} from './office-paging';
import {
  ESIM_FEE,
  Prices,
  captureTerms,
  chainHolds,
  chargeDebit,
  editableField,
  actionMode,
  flagsForMode,
  isAutomatic,
  periodEnd,
  renewOnto,
  renewStay,
  subscriptionDebit,
  switchOnto,
  visibleAccountIds,
  withPrice,
  withinCeiling,
  type LineTerms,
} from './office-rules';
import { packageTermsOf, type PackagePriceRow } from './office-terms';


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
const ALL_GRANTS = ['read', 'edit', 'accounting', 'tasks', 'reports', 'staff', 'enter'];

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
type Account = { id: string; loginName: string; nickname: string; layer: string; parentId: string | null };
type Action = 'activate' | 'charge' | 'extend' | 'reactivate' | 'disconnect' | 'freeze' | 'unfreeze' | 'switch' | 'rename' | 'sim';
type Sale = { msisdn: string; lineId: string; companyName: string; packageName: string; packagePrice: number };

export class OfficeFailure extends Error {
  constructor(readonly status: number, readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code]);
  }
}

function fail(status: number, code: ErrorCode): never {
  throw new OfficeFailure(status, code);
}

function feedPosition(raw: string | undefined) {
  const position = decodeFeedCursor(raw);
  if (position === null) fail(400, 'INVALID');
  return position;
}

@Injectable()
export class OfficeService implements OnModuleInit {
  private prismaClient: PrismaClient | null = null;

  private get prisma(): PrismaClient {
    this.prismaClient ??= new PrismaClient();
    return this.prismaClient;
  }

  constructor(@Inject(AUTH_STORE) private readonly auth: AuthStore) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) return;
    await this.ensureCatalog();
  }

  async me(gate: Gate) {
    const actor = await this.actor(gate);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: actor.id } });
    return {
      loginName: actor.loginName,
      nickname: actor.nickname,
      layer: actor.layer,
      isBranchOwner: actor.isBranchOwner,
      grants: actor.grants,
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
    const seesTasks = actor.isBranchOwner || actor.grants.includes('tasks');
    const taskWhere = actor.layer === 'branch' && seesTasks ? { status: 'pending' } : { submitterId: actor.id, status: 'pending' };
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
    await this.prisma.announcement.create({ data: { authorId: actor.id, body: text } });
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
    await this.prisma.$transaction(async (tx) => {
      if (!self) await this.move(tx, actor.id, -amount, actor.operatorId, 'fund', note);
      await this.move(tx, target.id, amount, actor.operatorId, self ? 'self_fund' : 'fund', note);
    });
    return { ok: true };
  }

  async setCeiling(gate: Gate, loginName: string, body: { ceiling?: unknown }) {
    const actor = await this.actor(gate);
    const ceiling = nonNegative(body.ceiling);
    if (ceiling === null || ceiling > 1_000_000) fail(400, 'INVALID');
    const accounts = await this.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target || target.parentId !== actor.id) fail(403, 'FORBIDDEN');
    await this.prisma.wallet.update({ where: { userId: target.id }, data: { ceiling } });
    return { ok: true };
  }

  async packages(gate: Gate) {
    const actor = await this.actor(gate);
    const field = editableField(actor.layer);
    const rows = await this.prisma.package.findMany({
      where: { companyId: { not: null }, enabled: true },
      include: { provider: true, company: true },
      orderBy: [{ provider: { name: 'asc' } }, { code: 'asc' }],
    });
    const images = new Map<string, string>();
    for (const row of rows) {
      const name = row.company?.name ?? '';
      if (name && row.company?.image) images.set(name, row.company.image);
    }
    return {
      companies: [...images].map(([name, image]) => ({ name, image })),
      packages: rows.map((row) => ({
        code: row.code,
        name: row.name,
        providerName: actor.layer === 'branch' ? row.provider.name : '',
        companyName: row.company?.name ?? '',
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

  async setPrice(gate: Gate, code: string, body: { price?: unknown }) {
    const actor = await this.actor(gate);
    const field = editableField(actor.layer);
    const price = nonNegative(body.price);
    if (!field || price === null) fail(400, 'INVALID');
    const row = await this.prisma.package.findUnique({ where: { code } });
    if (!row) fail(404, 'NOT_FOUND');
    const next = withPrice(pricesOf(row), field, price);
    if (field === 'pos') next.subscriberPrice = next.posPrice;
    if (!chainHolds(next)) fail(400, 'PRICE_BELOW_FLOOR');
    await this.prisma.package.update({
      where: { id: row.id },
      data: { mainPrice: next.mainPrice, agentPrice: next.agentPrice, posPrice: next.posPrice, subscriberPrice: next.subscriberPrice },
    });
    return { ok: true };
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

  async providers(gate: Gate) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const rows = await this.prisma.provider.findMany({
      where: { companies: { some: {} } },
      include: { companies: { include: { packages: true }, orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return {
      providers: rows.map((row) => ({
        code: row.code,
        name: row.name,
        companies: row.companies.map((company) => ({
          name: company.name,
          image: company.image ?? '',
          packages: company.packages.map((item) => ({
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
          })),
        })),
      })),
    };
  }

  async lines(gate: Gate, query: LineFilter & { cursor?: string } = {}) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const rows = await this.prisma.line.findMany({
      where: linesWhere(posIds, query),
      include: { package: { include: { company: true } }, pos: true },
      orderBy: [...NEWEST_FIRST],
      ...idCursorArgs(query.cursor || undefined, LINES_PAGE),
    });
    const { page, nextCursor } = pageOf(rows, LINES_PAGE);
    return {
      lines: page.map((row) => ({
        id: row.id,
        msisdn: row.msisdn,
        iccid: row.iccid,
        esim: row.esim,
        status: row.status,
        packageCode: row.package.code,
        packageName: row.package.name,
        companyName: row.package.company?.name ?? '',
        posLogin: row.pos.loginName,
        posPrice: row.package.posPrice,
        createdAt: row.createdAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
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
      include: { package: { include: { company: true } }, pos: true },
    });
    if (!line) fail(404, 'NOT_FOUND');
    const accounts = await this.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(line.posId)) fail(403, 'FORBIDDEN');
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
        .filter((task) => !(task.status === 'done' && task.posDelta !== 0))
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
    return {
      line: {
        id: line.id,
        msisdn: line.msisdn,
        iccid: line.iccid,
        esim: line.esim,
        status: line.status,
        packageCode: line.package.code,
        packageName: line.package.name,
        companyName: line.package.company?.name ?? '',
        posLogin: actor.layer === 'pos' ? '' : line.pos.loginName,
        posPrice: line.package.posPrice,
        opsLocked: line.opsLocked,
        createdAt: line.createdAt.toISOString(),
        endsAt: line.endsAt.toISOString(),
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
    if (!outcome || !packageCode || !posLogin || (!esim && !iccid)) fail(400, 'INVALID');
    if (requested && !/^05\d{8}$/.test(requested)) fail(400, 'INVALID');
    const accounts = await this.accounts();
    const pos = accounts.find((account) => account.loginName === posLogin && account.layer === 'pos');
    if (!pos || !canActivateFor(actor, pos, accounts)) fail(403, 'FORBIDDEN');
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
    this.assertRunnable(pkg, 'activate');
    if (!pkg.forSale) fail(400, 'PACKAGE_HIDDEN');
    const pkgTerms = packageTermsOf(pkg);
    const terms = captureTerms(pkgTerms, pkg.renewals.map((renewal) => packageTermsOf(renewal.target)));
    const unit = await this.buyPrice(pkg.id, pos.id, subscriptionDebit(pkgTerms));
    const posDelta = -(unit + (esim ? ESIM_FEE : 0));
    const msisdn = requested || (await this.freshMsisdn());
    if (requested) {
      const existing = await this.prisma.line.findUnique({ where: { msisdn } });
      if (existing) fail(400, 'NUMBER_TAKEN');
    }
    if (outcome === 'fail' || !isAutomatic(pkg, 'activate')) {
      const task = await this.openTask({
        action: 'activate', actor, posId: pos.id, packageId: pkg.id, posDelta, msisdn, iccid: esim ? null : iccid, esim,
        note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.line.create({
        data: {
          msisdn,
          iccid: esim ? null : iccid,
          esim,
          status: 'active',
          packageId: pkg.id,
          posId: pos.id,
          terms: terms as unknown as Prisma.InputJsonValue,
          endsAt: periodEnd(new Date(), pkg.months),
        },
      });
      await this.move(tx, pos.id, posDelta, actor.operatorId, 'activate', pkg.name, {
        msisdn,
        lineId: created.id,
        companyName: pkg.company?.name ?? '',
        packageName: pkg.name,
        packagePrice: unit,
      });
    });
    return { applied: true };
  }

  async operate(gate: Gate, lineId: string, action: Exclude<Action, 'activate' | 'switch'>, body: { outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    if (!outcome) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, action);
    if (line.status === 'disconnected') fail(400, 'INVALID');
    if (action === 'charge' && line.status !== 'active') fail(400, 'INVALID');
    if (action === 'freeze' && line.status !== 'active') fail(400, 'INVALID');
    if (action === 'unfreeze' && line.status !== 'frozen') fail(400, 'INVALID');
    const charged =
      action === 'charge'
        ? await this.buyPrice(line.packageId, line.posId, chargeDebit(lineTermsOf(line.terms, line.package)))
        : 0;
    const posDelta = action === 'charge' ? -charged : 0;
    if (outcome === 'fail' || !isAutomatic(line.package, action)) {
      const task = await this.openTask({
        action, actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.prisma.$transaction(async (tx) => {
      if (posDelta !== 0) await this.move(tx, line.posId, posDelta, actor.operatorId, action, line.package.name, saleOf(line, undefined, charged));
      if (action === 'disconnect') await tx.line.update({ where: { id: line.id }, data: { status: 'disconnected' } });
      if (action === 'freeze') await tx.line.update({ where: { id: line.id }, data: { status: 'frozen' } });
      if (action === 'unfreeze') await tx.line.update({ where: { id: line.id }, data: { status: 'active' } });
    });
    return { applied: true };
  }

  async switchPackage(gate: Gate, lineId: string, body: { packageCode?: unknown; outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const packageCode = typeof body.packageCode === 'string' ? body.packageCode : '';
    if (!outcome || !packageCode) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (!line.opsLocked && line.status !== 'active') fail(400, 'INVALID');
    this.assertRunnable(line.package, 'switch');
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
      new Date(),
    );
    if ('error' in switched) fail(400, 'INVALID');
    this.assertRunnable(next, 'switch');
    const nextPrice = await this.buyPrice(next.id, line.posId, switched.debit);
    const posDelta = -nextPrice;
    if (outcome === 'fail' || !isAutomatic(line.package, 'switch')) {
      const task = await this.openTask({
        action: 'switch', actor, posId: line.posId, packageId: line.packageId, nextPackageId: next.id, lineId: line.id,
        posDelta, msisdn: line.msisdn, note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.prisma.$transaction(async (tx) => {
      if (posDelta !== 0) await this.move(tx, line.posId, posDelta, actor.operatorId, 'switch', next.name, saleOf(line, next, nextPrice));
      await tx.line.update({
        where: { id: line.id },
        data: {
          endsAt: switched.endsAt,
          terms: switched.terms as unknown as Prisma.InputJsonValue,
          packageId: next.id,
          opsLocked: false,
        },
      });
    });
    return { applied: true };
  }

  async extend(gate: Gate, lineId: string, body: { outcome?: unknown; targetCode?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const targetCode = body.targetCode === undefined ? '' : typeof body.targetCode === 'string' ? body.targetCode : null;
    if (!outcome) fail(400, 'INVALID');
    if (targetCode === null) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'active') fail(400, 'INVALID');
    this.assertRunnable(line.package, 'extend');
    const terms = lineTermsOf(line.terms, line.package);
    const base = line.endsAt > new Date() ? line.endsAt : new Date();
    const target = targetCode
      ? await this.prisma.package.findUnique({ where: { code: targetCode }, include: { company: true, provider: true } })
      : null;
    if (targetCode && (!target || !target.company || !target.provider)) fail(400, 'INVALID');
    const renewal = target ? renewOnto(terms, packageTermsOf(target), base) : renewStay(terms, base);
    if ('error' in renewal) fail(400, 'INVALID');
    const posDelta = -(await this.buyPrice(line.packageId, line.posId, renewal.debit));
    if (outcome === 'fail' || !isAutomatic(line.package, 'extend')) {
      const task = await this.openTask({
        action: 'extend', actor, posId: line.posId, packageId: line.packageId, nextPackageId: target?.id,
        lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.prisma.$transaction(async (tx) => {
      await this.move(tx, line.posId, posDelta, actor.operatorId, 'extend', line.package.name, saleOf(line, undefined, -posDelta));
      await tx.line.update({
        where: { id: line.id },
        data: {
          endsAt: renewal.endsAt,
          terms: renewal.terms as unknown as Prisma.InputJsonValue,
          ...(target ? { packageId: target.id } : {}),
        },
      });
    });
    return { applied: true };
  }

  async reactivate(gate: Gate, lineId: string, body: { outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    if (!outcome) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    if (line.status !== 'disconnected') fail(400, 'INVALID');
    this.assertRunnable(line.package, 'reactivate');
    const posDelta = -(await this.buyPrice(line.packageId, line.posId, line.package.posPrice));
    if (outcome === 'fail' || !isAutomatic(line.package, 'activate')) {
      const task = await this.openTask({
        action: 'reactivate', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta, msisdn: line.msisdn,
        note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
      });
      return { applied: false, taskId: task.id };
    }
    await this.prisma.$transaction(async (tx) => {
      await this.move(tx, line.posId, posDelta, actor.operatorId, 'reactivate', line.package.name, saleOf(line, undefined, -posDelta));
      await tx.line.update({
        where: { id: line.id },
        data: { status: 'active', endsAt: periodEnd(new Date(), line.package.months) },
      });
    });
    return { applied: true };
  }

  async renameLine(gate: Gate, lineId: string, body: { msisdn?: unknown; outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const msisdn = typeof body.msisdn === 'string' ? body.msisdn.trim() : '';
    if (!outcome || !/^05\d{8}$/.test(msisdn)) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, 'rename');
    if (line.status !== 'active') fail(400, 'INVALID');
    if (msisdn === line.msisdn) fail(400, 'INVALID');
    const taken = await this.prisma.line.findUnique({ where: { msisdn } });
    if (taken) fail(400, 'NUMBER_TAKEN');
    if (outcome === 'success' && isAutomatic(line.package, 'rename')) {
      await this.prisma.line.update({ where: { id: line.id }, data: { msisdn } });
      return { applied: true as const };
    }
    const task = await this.openTask({
      action: 'rename', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn,
      note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
    });
    return { applied: false, taskId: task.id };
  }

  async swapSim(gate: Gate, lineId: string, body: { iccid?: unknown; outcome?: unknown }) {
    const actor = await this.actor(gate);
    const outcome = asOutcome(body.outcome);
    const iccid = typeof body.iccid === 'string' ? body.iccid.trim() : '';
    if (!outcome || iccid.length < 8) fail(400, 'INVALID');
    const line = await this.visibleLine(actor, lineId);
    if (line.opsLocked) fail(400, 'SWITCH_PACKAGE_FIRST');
    this.assertRunnable(line.package, 'sim');
    if (line.status !== 'active') fail(400, 'INVALID');
    if (outcome === 'success' && isAutomatic(line.package, 'sim')) {
      await this.prisma.line.update({ where: { id: line.id }, data: { iccid, esim: false } });
      return { applied: true as const };
    }
    const task = await this.openTask({
      action: 'sim', actor, posId: line.posId, packageId: line.packageId, lineId: line.id, posDelta: 0, msisdn: line.msisdn, iccid,
      note: outcome === 'fail' ? 'فشل المزود' : 'مهمة فرع',
    });
    return { applied: false, taskId: task.id };
  }

  async tasks(gate: Gate, query: { cursor?: string; status?: string } = {}) {
    const actor = await this.actor(gate);
    const seesTasks = actor.isBranchOwner || actor.grants.includes('tasks');
    const branch = actor.layer === 'branch' && seesTasks;
    const status = taskStatusOf(query.status);
    const read = await this.prisma.officeTask.findMany({
      where: {
        ...(branch ? {} : { submitterId: actor.id }),
        ...(status ? { status } : {}),
        AND: afterFeed(feedPosition(query.cursor)),
      },
      include: { submitter: true, assignee: true },
      orderBy: [...NEWEST_FIRST],
      take: TASKS_PAGE + 1,
    });
    const { page: rows, nextCursor } = mergeFeed([read], TASKS_PAGE);
    const accounts = await this.accounts();
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const packages = await this.prisma.package.findMany();
    const byPackage = new Map(packages.map((row) => [row.id, row.name]));
    return {
      tasks: rows.map((row) => ({
        id: row.id,
        action: row.action,
        status: row.status,
        posLogin: byId.get(row.posId)?.loginName ?? '',
        submitterLogin: row.submitter.loginName,
        assigneeLogin: row.assignee?.loginName ?? null,
        posDelta: row.posDelta,
        msisdn: row.msisdn,
        packageName: byPackage.get(row.packageId) ?? '',
        note: row.note,
        resultNote: row.status === 'pending' && !seesTasks ? null : row.resultNote,
        log: seesTasks ? row.log : '',
        canTake: branch && row.status === 'pending',
        canWork: branch && row.assigneeId === actor.id && row.status === 'working',
        canCancel: row.submitterId === actor.id && (row.status === 'pending' || row.status === 'working'),
      })),
      nextCursor,
    };
  }

  async takeTask(gate: Gate, id: string) {
    const actor = await this.branchActor(gate);
    if (!actor.isBranchOwner && !actor.grants.includes('tasks')) fail(403, 'FORBIDDEN');
    const current = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!current || current.status !== 'pending') fail(400, 'INVALID');
    const updated = await this.prisma.officeTask.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'working', assigneeId: actor.id, log: this.noteLog(current.log, `أخذها ${actor.nickname}`) },
    });
    if (updated.count !== 1) fail(400, 'INVALID');
    return { ok: true };
  }

  async releaseTask(gate: Gate, id: string) {
    const actor = await this.branchActor(gate);
    if (!actor.isBranchOwner && !actor.grants.includes('tasks')) fail(403, 'FORBIDDEN');
    const current = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!current || current.status !== 'working' || current.assigneeId !== actor.id) fail(400, 'INVALID');
    const updated = await this.prisma.officeTask.updateMany({
      where: { id, status: 'working', assigneeId: actor.id },
      data: { status: 'pending', assigneeId: null, log: this.noteLog(current.log, `أرجعها ${actor.nickname}`) },
    });
    if (updated.count !== 1) fail(400, 'INVALID');
    return { ok: true };
  }

  async completeTask(gate: Gate, id: string, body: { note?: unknown }) {
    const actor = await this.branchActor(gate);
    if (!actor.isBranchOwner && !actor.grants.includes('tasks')) fail(403, 'FORBIDDEN');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const task = await this.prisma.officeTask.findUnique({ where: { id } });
    if (!task || task.status !== 'working' || task.assigneeId !== actor.id) fail(400, 'INVALID');
    await this.prisma.$transaction(async (tx) => {
      let sale: Sale | undefined;
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
        const terms = captureTerms(
          packageTermsOf(pkg),
          pkg.renewals.map((renewal) => packageTermsOf(renewal.target)),
        );
        const created = await tx.line.create({
          data: {
            msisdn: task.msisdn || (await this.freshMsisdn()),
            iccid: task.esim ? null : task.iccid,
            esim: task.esim,
            status: 'active',
            packageId: task.packageId,
            posId: task.posId,
            terms: terms as unknown as Prisma.InputJsonValue,
            endsAt: periodEnd(new Date(), pkg.months),
          },
        });
        sale = {
          msisdn: created.msisdn,
          lineId: created.id,
          companyName: pkg.company?.name ?? '',
          packageName: pkg.name,
          packagePrice: await this.buyPrice(pkg.id, task.posId, subscriptionDebit(packageTermsOf(pkg))),
        };
      }
      if (task.lineId && task.action === 'disconnect') await tx.line.update({ where: { id: task.lineId }, data: { status: 'disconnected' } });
      if (task.lineId && task.action === 'freeze') await tx.line.update({ where: { id: task.lineId }, data: { status: 'frozen' } });
      if (task.lineId && task.action === 'unfreeze') await tx.line.update({ where: { id: task.lineId }, data: { status: 'active' } });
      if (task.lineId && (task.action === 'extend' || task.action === 'reactivate')) {
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
          await tx.line.update({
            where: { id: current.id },
            data: {
              status: task.action === 'reactivate' ? 'active' : current.status,
              endsAt: renewal?.endsAt ?? periodEnd(base, current.package.months),
              ...(renewal ? { terms: renewal.terms as unknown as Prisma.InputJsonValue } : {}),
              ...(target ? { packageId: target.id } : {}),
            },
          });
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
          new Date(),
        );
        if ('error' in switched) fail(400, 'INVALID');
        await tx.line.update({
          where: { id: current.id },
          data: {
            endsAt: switched.endsAt,
            terms: switched.terms as unknown as Prisma.InputJsonValue,
            packageId: target.id,
            opsLocked: false,
          },
        });
      }
      if (task.lineId && task.action === 'rename' && task.msisdn) {
        await tx.line.update({ where: { id: task.lineId }, data: { msisdn: task.msisdn } });
      }
      if (task.lineId && task.action === 'sim' && task.iccid) {
        await tx.line.update({ where: { id: task.lineId }, data: { iccid: task.iccid, esim: false } });
      }
      if (!sale && task.lineId) {
        const current = await tx.line.findUnique({ where: { id: task.lineId }, include: { package: { include: { company: true } } } });
        if (current) sale = saleOf(current);
      }
      if (task.posDelta !== 0) await this.move(tx, task.posId, task.posDelta, actor.operatorId, task.action, note, sale);
      await tx.officeTask.update({ where: { id }, data: { status: 'done', resultNote: note || null } });
    });
    if (task.submitterId !== actor.id) {
      await this.notifyUsers([task.submitterId], {
        kind: 'task_reply',
        action: task.action,
        msisdn: task.msisdn,
        refId: task.id,
        href: '/tasks',
      });
    }
    return { ok: true };
  }

  async rejectTask(gate: Gate, id: string, body: { reason?: unknown }) {
    const actor = await this.branchActor(gate);
    if (!actor.isBranchOwner && !actor.grants.includes('tasks')) fail(403, 'FORBIDDEN');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) fail(400, 'INVALID');
    const task = await this.prisma.officeTask.findUnique({ where: { id } });
    const updated = await this.prisma.officeTask.updateMany({
      where: { id, status: 'working', assigneeId: actor.id },
      data: { status: 'cancelled', resultNote: reason },
    });
    if (updated.count !== 1) fail(400, 'INVALID');
    if (task && task.submitterId !== actor.id) {
      await this.notifyUsers([task.submitterId], {
        kind: 'task_reply',
        action: task.action,
        msisdn: task.msisdn,
        refId: task.id,
        href: '/tasks',
      });
    }
    return { ok: true };
  }

  async cancelTask(gate: Gate, id: string) {
    const actor = await this.actor(gate);
    const updated = await this.prisma.officeTask.updateMany({
      where: { id, submitterId: actor.id, status: { in: ['pending', 'working'] } },
      data: { status: 'cancelled', resultNote: null, assigneeId: null },
    });
    if (updated.count !== 1) fail(400, 'INVALID');
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

  async createAccount(gate: Gate, body: { loginName?: unknown; nickname?: unknown; password?: unknown; layer?: unknown; parentLogin?: unknown; roleId?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    const loginName = typeof body.loginName === 'string' ? body.loginName.trim().toLowerCase() : '';
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const layer = typeof body.layer === 'string' ? body.layer : '';
    const parentLogin = typeof body.parentLogin === 'string' ? body.parentLogin.trim() : '';
    if (!/^[a-z0-9._-]{3,32}$/.test(loginName)) fail(400, 'INVALID');
    const nickError = nicknameProblem(nickname);
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
    const roles = await this.prisma.role.findMany({ orderBy: { name: 'asc' } });
    return { roles };
  }

  async saveRole(gate: Gate, body: { id?: unknown; name?: unknown; read?: unknown; edit?: unknown; accounting?: unknown; tasks?: unknown; reports?: unknown; staff?: unknown; enter?: unknown }) {
    const actor = await this.actor(gate);
    if (!actor.isBranchOwner || actor.impersonating) fail(403, 'FORBIDDEN');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 2) fail(400, 'INVALID');
    const flags = {
      name,
      read: body.read === true,
      edit: body.edit === true,
      accounting: body.accounting === true,
      tasks: body.tasks === true,
      reports: body.reports === true,
      staff: body.staff === true,
      enter: body.enter === true,
    };
    const id = typeof body.id === 'string' ? body.id : '';
    if (id) await this.prisma.role.update({ where: { id }, data: flags });
    else await this.prisma.role.create({ data: flags });
    return { ok: true as const };
  }

  async transferPos(gate: Gate, loginName: string, body: { parentLogin?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.impersonating || (actor.layer !== 'branch' && actor.layer !== 'main_agent')) fail(403, 'FORBIDDEN');
    const parentLogin = typeof body.parentLogin === 'string' ? body.parentLogin : '';
    const accounts = await this.accounts();
    const pos = accounts.find((account) => account.loginName === loginName && account.layer === 'pos');
    const next = accounts.find((account) => account.loginName === parentLogin && account.layer === 'agent');
    if (!pos || !next || pos.parentId === next.id) fail(400, 'INVALID');
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    if (!visible.has(pos.id) || !visible.has(next.id)) fail(403, 'FORBIDDEN');
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: pos.id } });
    if (!wallet || wallet.balance !== 0) fail(400, 'ZERO_WALLET_FIRST');
    await this.prisma.$transaction(async (tx) => {
      await tx.line.updateMany({ where: { posId: pos.id, originAgentId: null }, data: { originAgentId: pos.parentId } });
      await tx.user.update({ where: { id: pos.id }, data: { parentId: next.id } });
    });
    return { ok: true as const };
  }

  async transferLine(gate: Gate, lineId: string, body: { posLogin?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.layer === 'pos' || actor.impersonating) fail(403, 'FORBIDDEN');
    const posLogin = typeof body.posLogin === 'string' ? body.posLogin : '';
    const line = await this.visibleLine(actor, lineId);
    const accounts = await this.accounts();
    const next = accounts.find((account) => account.loginName === posLogin && account.layer === 'pos');
    if (!next || next.id === line.posId) fail(400, 'INVALID');
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(next.id)) fail(403, 'FORBIDDEN');
    const locked = !line.package.companyId;
    await this.prisma.line.update({
      where: { id: line.id },
      data: { posId: next.id, opsLocked: locked },
    });
    return { ok: true as const };
  }

  async setPackageMode(gate: Gate, code: string, body: Record<string, unknown>) {
    const actor = await this.actor(gate);
    if (!actor.isBranchOwner && !actor.grants.includes('edit')) fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const keys = ['autoActivate', 'autoCharge', 'autoDisconnect', 'autoFreeze', 'autoSwitch', 'autoExtend', 'autoRename', 'autoSim', 'allowActivate', 'allowCharge', 'allowDisconnect', 'allowFreeze', 'allowSwitch', 'allowExtend', 'allowRename', 'allowSim', 'enabled'] as const;
    const data: Record<string, boolean> = {};
    for (const key of keys) if (typeof body[key] === 'boolean') data[key] = body[key] as boolean;
    const action = typeof body.action === 'string' ? body.action : '';
    const mode = body.mode === 'auto' || body.mode === 'manual' || body.mode === 'off' ? body.mode : '';
    const pair = MODE_FIELDS[action];
    if (pair && mode) {
      const flags = flagsForMode(mode);
      data[pair.auto] = flags.auto;
      data[pair.allow] = flags.allow;
    }
    if (Object.keys(data).length === 0) fail(400, 'INVALID');
    await this.prisma.package.update({ where: { code }, data: data as { autoActivate?: boolean } });
    return { ok: true as const };
  }

  async packageSheet(gate: Gate, code: string) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code }, include: { provider: true, company: true, offers: { include: { user: true } } } });
    if (!pkg) fail(404, 'NOT_FOUND');
    return {
      code: pkg.code,
      name: pkg.name,
      providerCode: pkg.provider.code,
      providerName: pkg.provider.name,
      companyName: pkg.company?.name ?? '',
      enabled: pkg.enabled,
      branchCost: pkg.branchCost,
      mainPrice: pkg.mainPrice,
      agentPrice: pkg.agentPrice,
      posPrice: pkg.posPrice,
      subscriberPrice: pkg.subscriberPrice,
      modes: {
        activate: actionMode(pkg.autoActivate, pkg.allowActivate),
        charge: actionMode(pkg.autoCharge, pkg.allowCharge),
        extend: actionMode(pkg.autoExtend, pkg.allowExtend),
        disconnect: actionMode(pkg.autoDisconnect, pkg.allowDisconnect),
        freeze: actionMode(pkg.autoFreeze, pkg.allowFreeze),
        switch: actionMode(pkg.autoSwitch, pkg.allowSwitch),
        rename: actionMode(pkg.autoRename, pkg.allowRename),
        sim: actionMode(pkg.autoSim, pkg.allowSim),
      },
      offers: pkg.offers.map((offer) => ({
        loginName: offer.user.loginName,
        nickname: offer.user.nickname,
        layer: offer.user.layer,
        price: offer.price,
      })),
    };
  }

  async setChain(gate: Gate, code: string, body: Record<string, unknown>) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || (!actor.isBranchOwner && !actor.grants.includes('edit'))) fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    if (!pkg) fail(404, 'NOT_FOUND');
    const next = { ...pricesOf(pkg) };
    for (const key of ['branchCost', 'mainPrice', 'agentPrice', 'posPrice', 'subscriberPrice'] as const) {
      if (body[key] === undefined) continue;
      const price = nonNegative(body[key]);
      if (price === null) fail(400, 'INVALID');
      next[key] = price;
    }
    if (!chainHolds(next)) fail(400, 'PRICE_BELOW_FLOOR');
    await this.prisma.package.update({ where: { id: pkg.id }, data: next });
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
    await this.prisma.$transaction(async (tx) => {
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

  async saveOffer(gate: Gate, code: string, body: { loginName?: unknown; price?: unknown }) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || (!actor.isBranchOwner && !actor.grants.includes('edit'))) fail(403, 'FORBIDDEN');
    const loginName = typeof body.loginName === 'string' ? body.loginName : '';
    const price = nonNegative(body.price);
    if (!loginName || price === null) fail(400, 'INVALID');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    const user = await this.prisma.user.findUnique({ where: { loginName } });
    if (!pkg || !user || user.layer === 'branch') fail(400, 'INVALID');
    await this.prisma.packageOffer.upsert({
      where: { packageId_userId: { packageId: pkg.id, userId: user.id } },
      update: { price },
      create: { packageId: pkg.id, userId: user.id, price },
    });
    return { ok: true as const };
  }

  async removeOffer(gate: Gate, code: string, loginName: string) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || (!actor.isBranchOwner && !actor.grants.includes('edit'))) fail(403, 'FORBIDDEN');
    const pkg = await this.prisma.package.findUnique({ where: { code } });
    const user = await this.prisma.user.findUnique({ where: { loginName } });
    if (!pkg || !user) fail(404, 'NOT_FOUND');
    await this.prisma.packageOffer.deleteMany({ where: { packageId: pkg.id, userId: user.id } });
    return { ok: true as const };
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
    const operationKinds = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim'];
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
    const read = await this.prisma.walletEntry.findMany({
      where: {
        userId: actor.id,
        kind: { in: kind ? [kind] : allowed },
        ...(query.direction === 'in' ? { amount: { gt: 0 } } : {}),
        ...(query.direction === 'out' ? { amount: { lt: 0 } } : {}),
        ...(Object.keys(createdAt).length ? { createdAt } : {}),
        AND: afterFeed(feedPosition(query.cursor)),
      },
      include: { actor: true },
      orderBy: [...NEWEST_FIRST],
      take: FEED_PAGE + 1,
    });
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
    };
  }

  async audit(gate: Gate, query: { cursor?: string; kind?: string } = {}) {
    const actor = await this.actor(gate);
    const accounts = await this.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const numberKinds = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim'];
    if (posIds.length === 0) return { entries: [], nextCursor: null };
    const showProvider = actor.layer === 'branch';
    const after = afterFeed(feedPosition(query.cursor));
    const kind = query.kind === 'enter' && showProvider ? 'enter' : numberKinds.find((item) => item === query.kind);
    const size = FEED_PAGE + 1;
    const [read1, read2, read3] = await Promise.all([
      kind === 'enter'
        ? []
        : this.prisma.walletEntry.findMany({
            where: { userId: { in: posIds }, kind: { in: kind ? [kind] : numberKinds }, AND: after },
            orderBy: [...NEWEST_FIRST],
            take: size,
            include: { actor: { select: { loginName: true, nickname: true } } },
          }),
      kind === 'enter'
        ? []
        : this.prisma.officeTask.findMany({
            // A done task that moved money is already shown by its wallet entry.
            where: {
              posId: { in: posIds },
              action: { in: kind ? [kind] : numberKinds },
              NOT: { status: 'done', posDelta: { not: 0 } },
              AND: after,
            },
            orderBy: [...NEWEST_FIRST],
            take: size,
            include: {
              submitter: { select: { loginName: true, nickname: true } },
              assignee: { select: { loginName: true, nickname: true } },
              line: { include: { package: { include: { company: true, provider: true } } } },
            },
          }),
      showProvider && (!kind || kind === 'enter')
        ? this.prisma.accessLog.findMany({
            where: { AND: after },
            orderBy: [...NEWEST_FIRST],
            take: size,
            include: { actor: { select: { nickname: true, loginName: true } } },
          })
        : [],
    ]);
    const merged = mergeFeed<{ createdAt: Date; id: string; from: 'entry' | 'task' | 'visit' }>(
      [
        read1.map((row) => ({ createdAt: row.createdAt, id: row.id, from: 'entry' as const })),
        read2.map((row) => ({ createdAt: row.createdAt, id: row.id, from: 'task' as const })),
        read3.map((row) => ({ createdAt: row.createdAt, id: row.id, from: 'visit' as const })),
      ],
      FEED_PAGE,
    );
    const keep = (from: 'entry' | 'task' | 'visit') => new Set(merged.page.filter((row) => row.from === from).map((row) => row.id));
    const entryIds = keep('entry');
    const taskIds = keep('task');
    const visitIds = keep('visit');
    const entries = read1.filter((row) => entryIds.has(row.id));
    const tasks = read2.filter((row) => taskIds.has(row.id));
    const visits = read3.filter((row) => visitIds.has(row.id));
    const packageIds = [...new Set(tasks.flatMap((task) => [task.packageId, task.nextPackageId].filter((id): id is string => !!id)))];
    const packages = packageIds.length
      ? await this.prisma.package.findMany({ where: { id: { in: packageIds } }, include: { company: true, provider: true } })
      : [];
    const byPackage = new Map(packages.map((row) => [row.id, row]));
    const lineIds = entries.map((entry) => entry.lineId).filter((id): id is string => !!id);
    const lines = lineIds.length
      ? await this.prisma.line.findMany({ where: { id: { in: lineIds } }, include: { package: { include: { provider: true } } } })
      : [];
    const providerByLine = new Map(lines.map((row) => [row.id, row.package.provider.name]));
    const rows = [
      ...entries.map((entry) => ({
        id: entry.id,
        action: entry.kind,
        status: 'done',
        at: entry.createdAt.toISOString(),
        msisdn: entry.msisdn ?? '',
        companyName: entry.companyName ?? '',
        packageName: entry.packageName ?? '',
        providerName: showProvider ? providerByLine.get(entry.lineId ?? '') ?? '' : '',
        actorName: entry.actor.nickname || entry.actor.loginName,
      })),
      ...tasks.map((task) => {
        const pkg = byPackage.get(task.nextPackageId || task.packageId);
        const named = pkg?.company ? pkg : task.line?.package;
        const who = task.status === 'done' && task.assignee ? task.assignee : task.submitter;
        return {
          id: task.id,
          action: task.action,
          status: task.status,
          at: task.createdAt.toISOString(),
          msisdn: task.msisdn ?? '',
          companyName: named?.company?.name ?? '',
          packageName: named?.name ?? '',
          providerName: showProvider ? pkg?.provider?.name || task.line?.package.provider.name || '' : '',
          actorName: who.nickname || who.loginName,
        };
      }),
      ...visits.map((visit) => ({
        id: visit.id,
        action: 'enter',
        status: 'done',
        at: visit.createdAt.toISOString(),
        msisdn: '',
        companyName: visit.targetLogin,
        packageName: '',
        providerName: '',
        actorName: `${visit.actor.nickname || visit.actor.loginName}${visit.ip ? ` · ${visit.ip}` : ''}`,
      })),
    ].sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : a.id < b.id ? 1 : -1));
    return { entries: rows, nextCursor: merged.nextCursor };
  }

  async accounting(gate: Gate, query: { cursor?: string; q?: string } = {}) {
    const actor = await this.actor(gate);
    const digits = (query.q ?? '').replace(/\s/g, '');
    const read = await this.prisma.walletEntry.findMany({
      where: {
        userId: actor.id,
        msisdn: digits ? { contains: digits } : { not: null },
        AND: afterFeed(feedPosition(query.cursor)),
      },
      orderBy: [...NEWEST_FIRST],
      take: FEED_PAGE + 1,
    });
    const { page: rows, nextCursor } = mergeFeed([read], FEED_PAGE);
    return {
      entries: rows.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        msisdn: row.msisdn ?? '',
        companyName: row.companyName ?? '',
        packageName: row.packageName ?? '',
        packagePrice: row.packagePrice ?? 0,
        balanceBefore: row.balanceAfter - row.amount,
        balanceAfter: row.balanceAfter,
      })),
      nextCursor,
    };
  }

  async report(gate: Gate, kind: string, cursor?: string) {
    const actor = await this.actor(gate);
    if (actor.layer !== 'branch' || actor.impersonating) fail(403, 'REPORTS_BRANCH_ONLY');
    if (!actor.isBranchOwner && !actor.grants.includes('reports')) fail(403, 'REPORTS_BRANCH_ONLY');
    if (kind === 'providers') return this.providerReport();
    if (kind === 'consumption') return this.entryReport(cursor);
    if (kind === 'funding') return this.entryReport(cursor, ['fund', 'self_fund']);
    if (kind === 'operations') return this.entryReport(cursor, ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim']);
    if (kind === 'tasks') {
      const listed = await this.tasks(gate, { cursor });
      return { tasks: listed.tasks, nextCursor: listed.nextCursor };
    }
    if (kind === 'numbers') {
      const listed = await this.lines(gate, { cursor });
      return { lines: listed.lines, nextCursor: listed.nextCursor };
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
    const stored = await this.prisma.user.findUnique({ where: { id: live.user.id }, select: { liveGrants: true, isBranchOwner: true } });
    const grants = stored?.isBranchOwner ? ALL_GRANTS : (stored?.liveGrants ?? '').split(',').filter(Boolean);
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
  }, action: string) {
    const selling = action === 'activate' || action === 'charge' || action === 'extend' || action === 'reactivate' || action === 'switch';
    if (!pkg.enabled && selling) fail(400, 'PACKAGE_DISABLED');
    const allow: Record<string, boolean> = {
      activate: pkg.allowActivate,
      reactivate: pkg.allowActivate,
      charge: pkg.allowCharge,
      extend: pkg.allowExtend,
      disconnect: pkg.allowDisconnect,
      freeze: pkg.allowFreeze,
      unfreeze: pkg.allowFreeze,
      switch: pkg.allowSwitch,
      rename: pkg.allowRename,
      sim: pkg.allowSim,
    };
    if (allow[action] === false) fail(400, 'OPERATION_DISABLED');
  }

  private async buyPrice(packageId: string, posId: string, fallback: number) {
    const offer = await this.prisma.packageOffer.findUnique({ where: { packageId_userId: { packageId, userId: posId } } });
    return offer?.price ?? fallback;
  }

  private noteLog(current: string, line: string) {
    return current ? `${current}\n${line}` : line;
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

  private async accounts(): Promise<Account[]> {
    return this.prisma.user.findMany({
      select: { id: true, loginName: true, nickname: true, layer: true, parentId: true },
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
    return line;
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
    note: string;
  }) {
    const task = await this.prisma.officeTask.create({
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
        note: input.note,
      },
    });
    const branch = await this.prisma.user.findMany({
      where: { layer: 'branch', id: { not: input.actor.id } },
      select: { id: true },
    });
    await this.notifyUsers(branch.map((row) => row.id), {
      kind: 'task',
      action: input.action,
      msisdn: input.msisdn ?? null,
      refId: task.id,
      href: '/tasks',
    });
    return task;
  }

  private async notifyUsers(userIds: string[], input: { kind: string; action: string; msisdn: string | null; refId: string; href: string }) {
    if (userIds.length === 0) return;
    await this.prisma.notice.createMany({
      data: userIds.map((userId) => ({ userId, ...input })),
    });
  }

  async notices(gate: Gate) {
    const actor = await this.actor(gate);
    const rows = await this.prisma.notice.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return {
      unread: rows.filter((row) => !row.readAt).length,
      notices: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        action: row.action,
        msisdn: row.msisdn,
        href: row.href,
        read: Boolean(row.readAt),
        createdAt: row.createdAt.toISOString(),
      })),
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

  private async move(tx: Prisma.TransactionClient, userId: string, amount: number, actorId: string, kind: string, note: string, sale?: Sale) {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!wallet || !user) fail(404, 'NOT_FOUND');
    const debit = amount < 0 ? -amount : 0;
    if (!withinCeiling(user.layer, wallet.balance, wallet.ceiling, debit)) fail(400, 'BALANCE_CEILING');
    const balanceAfter = wallet.balance + amount;
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
    const read = await this.prisma.walletEntry.findMany({
      where: { ...(kinds ? { kind: { in: kinds } } : {}), AND: afterFeed(feedPosition(cursor)) },
      include: { user: true, actor: true },
      orderBy: [...NEWEST_FIRST],
      take: FEED_PAGE + 1,
    });
    const { page: rows, nextCursor } = mergeFeed([read], FEED_PAGE);
    return {
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
    const seeded = await this.prisma.company.count();
    if (seeded > 0) return;
    const flags = { autoActivate: true, autoCharge: true, autoDisconnect: false, autoFreeze: false, autoSwitch: false };
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
              branchCost: item.subscription.branchCost,
              mainPrice: item.subscription.mainPrice,
              agentPrice: item.subscription.agentPrice,
              posPrice: item.subscription.posPrice,
              subscriberPrice: item.subscription.subscriberPrice,
              renewalBranchCost: item.renewal.branchCost,
              renewalMainPrice: item.renewal.mainPrice,
              renewalAgentPrice: item.renewal.agentPrice,
              renewalPosPrice: item.renewal.posPrice,
              renewalSubscriberPrice: item.renewal.subscriberPrice,
              ...flags,
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
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_000_000) return null;
  return value;
}

function nonNegative(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) return null;
  return value;
}

function asOutcome(value: unknown): 'success' | 'fail' | null {
  if (value === 'success' || value === 'fail') return value;
  return null;
}

function canActivateFor(actor: Actor, pos: Account, accounts: Account[]): boolean {
  if (!visibleAccountIds(actor.id, actor.layer, accounts).has(pos.id)) return false;
  if (actor.layer === 'pos') return actor.id === pos.id;
  return true;
}
