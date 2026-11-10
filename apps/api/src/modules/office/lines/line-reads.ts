import { LinesRepository } from './lines.repository';
import { AccountTree } from '../kernel/account-tree';
import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { after, cursorPosition, page } from '../../shared/paging';
import { LINES_PAGE, isSuspended, linesWhere, type LineFilter } from '../rules/office-paging';
import { esimPriceOf, offeredOperations, refreshMode, resolvePackageMode, simRulesOf, visibleAccountIds } from '../rules/office-rules';
import { deniedOpsFor, visibleTo, type OpKey, type PathNode } from '../rules/user-terms';
import { lineHistory } from './line-history';
import { canActivateFor, opKeyOf, type RunnablePackage } from './line-ops';

/** Entries that put time on a line: the newest one is the last recharge shown on the card. */
const RECHARGE_KINDS = ['activate', 'charge', 'extend', 'reactivate'];

/** Numbers as they are read: the paged list and one number's card with its history and the operations it offers. */
@Injectable()
export class LineReads {
  constructor(private readonly tree: AccountTree, private readonly repo: LinesRepository) {}

  /** The suspension periods the packages use, so the suspended filter has one cut-off per period. */
  async suspendPeriods(): Promise<number[]> {
    const rows = await this.repo.suspendPeriods();
    return rows.map((row) => row.suspendAfterDays);
  }

  async list(actor: Actor, query: LineFilter & { cursor?: string; loginName?: string } = {}) {
    const accounts = await this.tree.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    // `loginName` narrows to one account's numbers: its own if it is a point of sale, else every point of sale below
    // it (the user page's «الأرقام»). An account outside the viewer's tree gives nothing.
    const target = query.loginName ? accounts.find((account) => account.loginName === query.loginName) : undefined;
    const within = query.loginName ? (target && visible.has(target.id) ? visibleAccountIds(target.id, target.layer === 'branch' ? 'none' : target.layer, accounts) : new Set<string>()) : visible;
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id) && within.has(account.id)).map((account) => account.id);
    const periods = query.status === 'suspended' ? await this.suspendPeriods() : [];
    const where = linesWhere(posIds, query, periods);
    const [rows, total] = await Promise.all([
      this.repo.linesPage({ ...where, AND: after(cursorPosition(query.cursor)) }, LINES_PAGE + 1),
      this.repo.countLines(where),
    ]);
    const { items, nextCursor } = page(rows, LINES_PAGE);
    return {
      total,
      items: items.map((row) => ({
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
        posLoginName: row.pos.loginName,
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
    const line = await this.repo.lineCard(id);
    if (!line) fail(404, 'NOT_FOUND');
    const accounts = await this.tree.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(line.posId)) fail(404, 'NOT_FOUND');
    const posPath = this.tree.pathOf(line.posId, accounts);
    const denied = deniedOpsFor(posPath);
    const [tasks, entries] = await Promise.all([
      this.repo.tasksOfLine(line.id),
      this.repo.entriesOfLine(line.id),
    ]);
    const packageIds = [...new Set(tasks.flatMap((task) => [task.packageId, task.nextPackageId].filter((id): id is string => !!id)))];
    const packages = packageIds.length
      ? await this.repo.packagesByIds(packageIds)
      : [];
    const byPackage = new Map(packages.map((row) => [row.id, row]));
    const history = lineHistory(line, entries, tasks, byPackage);
    const recharge = entries.find((entry) => RECHARGE_KINDS.includes(entry.kind))
      ?? (entries.length >= 40
        ? await this.repo.lastEntryOfKinds(line.id, RECHARGE_KINDS)
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
        posLoginName: actor.layer === 'pos' ? '' : line.pos.loginName,
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
        addons: line.status === 'disconnected' ? [] : (await this.repo.activeAddons(line.packageId)),
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
    const saved = await this.repo.switchTargets(packageId);
    if (saved.length === 0) return [];
    const terms = await this.repo.accountTerms(saved.map((item) => item.target.id), posPath.map((node) => node.id));
    return saved
      .filter((item) => visibleTo(posPath, terms.filter((row) => row.packageId === item.target.id), item.target))
      .map((item) => item.target.code);
  }
}
