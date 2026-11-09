import { isOwner } from '../policy';
import { Injectable } from '@nestjs/common';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { visibleAccountIds } from '../office-rules';
import { taskWhereFor } from '../task-access';
import { deniedOpsFor, parseOps, serializeOps } from '../user-terms';
import { expiringWhere } from '../office-paging';

/** The signed-in account's desk: who it is (identity, balance, grants, stops), and the home board. */
@Injectable()
export class DeskService {
  constructor(private readonly kernel: OfficeKernel) {}

  async me(actor: Actor) {
    const [wallet, accounts] = await Promise.all([
      this.kernel.prisma.wallet.findUnique({ where: { userId: actor.id } }),
      this.kernel.accounts(),
    ]);
    return {
      loginName: actor.loginName,
      nickname: actor.nickname,
      layer: actor.layer,
      isBranchOwner: isOwner(actor),
      grants: actor.grants,
      // The stops on the actor's own path, own node included. `transfer` is judged on the actor, so the
      // browser needs them to hide what the server would refuse.
      stops: parseOps(serializeOps([...deniedOpsFor(this.kernel.pathOf(actor.id, accounts))])),
      impersonating: actor.impersonating,
      balance: wallet?.balance ?? 0,
      ceiling: wallet?.ceiling ?? 0,
    };
  }

  async home(actor: Actor) {
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const taskWhere = { ...taskWhereFor(actor, accounts), status: 'pending' };
    // Open tasks (pending or being worked on) for the sidebar's count beside «المهام» (spec 2026-11-09-graphite-identity).
    const openWhere = { ...taskWhereFor(actor, accounts), status: { in: ['pending', 'working'] } };
    const [pendingTasks, openTasks, activeLines, inactiveLines, expiringLines, entries] = await Promise.all([
      this.kernel.prisma.officeTask.count({ where: taskWhere }),
      this.kernel.prisma.officeTask.count({ where: openWhere }),
      posIds.length ? this.kernel.prisma.line.count({ where: { posId: { in: posIds }, status: 'active' } }) : 0,
      posIds.length ? this.kernel.prisma.line.count({ where: { posId: { in: posIds }, status: 'disconnected' } }) : 0,
      posIds.length ? this.kernel.prisma.line.count({ where: { posId: { in: posIds }, ...expiringWhere() } }) : 0,
      posIds.length
        ? this.kernel.prisma.walletEntry.findMany({
            where: { userId: { in: posIds }, kind: { in: ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch'] } },
            orderBy: { createdAt: 'desc' },
            take: 8,
            include: { user: true },
          })
        : [],
    ]);
    return {
      pendingTasks,
      openTasks,
      activeLines,
      inactiveLines,
      expiringLines,
      operations: entries.map((row) => ({
        id: row.id,
        at: row.createdAt.toISOString(),
        kind: row.kind,
        amount: row.amount,
        note: row.note,
        packageName: row.packageName,
        loginName: row.user.loginName,
      })),
    };
  }
}
