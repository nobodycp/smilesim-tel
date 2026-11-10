import { LinesRepository } from './lines.repository';
import { AccountTree } from '../kernel/account-tree';
import { UnitOfWork } from '../kernel/unit-of-work';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { LINES_PAGE, NEWEST_FIRST, idCursorArgs, isSuspended, linesWhere, pageOf, type LineFilter } from '../rules/office-paging';
import { esimPriceOf, offeredOperations, refreshMode, resolvePackageMode, simRulesOf, visibleAccountIds } from '../rules/office-rules';
import { deniedOpsFor, visibleTo, type OpKey, type PathNode } from '../rules/user-terms';
import { lineHistory } from './line-history';
import { canActivateFor, opKeyOf, type RunnablePackage } from './line-ops';

/** Entries that put time on a line: the newest one is the last recharge shown on the card. */
const RECHARGE_KINDS = ['activate', 'charge', 'extend', 'reactivate'];

/** Numbers as they are read: the paged list and one number's card with its history and the operations it offers. */
@Injectable()
export class LineReads {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree, readonly repo: LinesRepository) {}

  /** The suspension periods the packages use, so the suspended filter has one cut-off per period. */
  async suspendPeriods(): Promise<number[]> {
    const rows = await this.uow.prisma.package.findMany({ distinct: ['suspendAfterDays'], select: { suspendAfterDays: true } });
    return rows.map((row) => row.suspendAfterDays);
  }

  async list(actor: Actor, query: LineFilter & { cursor?: string; account?: string } = {}) {
    const accounts = await this.tree.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    // `account` narrows to one account's numbers: its own if it is a point of sale, else every point of sale below
    // it (the user page's «الأرقام»). An account outside the viewer's tree gives nothing.
    const target = query.account ? accounts.find((account) => account.loginName === query.account) : undefined;
    const within = query.account ? (target && visible.has(target.id) ? visibleAccountIds(target.id, target.layer === 'branch' ? 'none' : target.layer, accounts) : new Set<string>()) : visible;
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id) && within.has(account.id)).map((account) => account.id);
    const periods = query.status === 'suspended' ? await this.suspendPeriods() : [];
    const where = linesWhere(posIds, query, periods);
    const [rows, total] = await Promise.all([
      this.uow.prisma.line.findMany({
        where,
        include: { package: { include: { company: true } }, pos: true },
        orderBy: [...NEWEST_FIRST],
        ...idCursorArgs(query.cursor || undefined, LINES_PAGE),
      }),
      this.uow.prisma.line.count({ where }),
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
        operations: this.operationsFor({ ...row, denied: deniedOpsFor(this.tree.pathOf(row.posId, accounts)) }),
      })),
      nextCursor,
      poses: accounts
        .filter((account) => account.layer === 'pos' && visible.has(account.id) && canActivateFor(actor, account, accounts))
        .map((account) => ({ loginName: account.loginName, nickname: account.nickname })),
    };
  }

  async detail(actor: Actor, id: string) {
    const line = await this.uow.prisma.line.findUnique({
      where: { id },
      include: { package: { include: { company: true, provider: true } }, pos: true },
    });
    if (!line) fail(404, 'NOT_FOUND');
    const accounts = await this.tree.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(line.posId)) fail(403, 'FORBIDDEN');
    const posPath = this.tree.pathOf(line.posId, accounts);
    const denied = deniedOpsFor(posPath);
    const [tasks, entries] = await Promise.all([
      this.uow.prisma.officeTask.findMany({
        where: { lineId: line.id },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: {
          submitter: { select: { loginName: true, nickname: true } },
          assignee: { select: { loginName: true, nickname: true } },
        },
      }),
      this.uow.prisma.walletEntry.findMany({
        where: { lineId: line.id },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { actor: { select: { loginName: true, nickname: true } } },
      }),
    ]);
    const packageIds = [...new Set(tasks.flatMap((task) => [task.packageId, task.nextPackageId].filter((id): id is string => !!id)))];
    const packages = packageIds.length
      ? await this.uow.prisma.package.findMany({ where: { id: { in: packageIds } }, include: { company: true } })
      : [];
    const byPackage = new Map(packages.map((row) => [row.id, row]));
    const history = lineHistory(line, entries, tasks, byPackage);
    const recharge = entries.find((entry) => RECHARGE_KINDS.includes(entry.kind))
      ?? (entries.length >= 40
        ? await this.uow.prisma.walletEntry.findFirst({ where: { lineId: line.id, kind: { in: RECHARGE_KINDS } }, orderBy: { createdAt: 'desc' }, select: { kind: true, createdAt: true } })
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
        // The package's extra operations the number may ask for (spec 2026-11-09, 3).
        addons: line.status === 'disconnected' ? [] : (await this.uow.prisma.packageAddon.findMany({
          where: { packageId: line.packageId, active: true },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, name: true, price: true },
        })),
      },
      history,
    };
  }

  private operationsFor(line: {
    status: string;
    endsAt: Date;
    opsLocked?: boolean;
    package: RunnablePackage & { company?: { esim?: boolean } | null; esimAvailable?: boolean };
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

  /** Switch targets saved on the package that the selling account may see. */
  private async visibleSwitchTargets(packageId: string, posPath: PathNode[]): Promise<string[]> {
    const saved = await this.uow.prisma.packageSwitch.findMany({
      where: { packageId },
      select: { target: { select: { id: true, code: true, enabled: true, forSale: true } } },
    });
    if (saved.length === 0) return [];
    const terms = await this.uow.prisma.userPackage.findMany({
      where: { packageId: { in: saved.map((item) => item.target.id) }, userId: { in: posPath.map((node) => node.id) } },
      select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
    });
    return saved
      .filter((item) => visibleTo(posPath, terms.filter((row) => row.packageId === item.target.id), item.target))
      .map((item) => item.target.code);
  }
}
