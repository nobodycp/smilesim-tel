import { DeskRepository } from './desk.repository';
import { AccountTree, isOwner, visibleAccountIds } from '../../access';
import { Injectable } from '@nestjs/common';
import type { Actor } from '../../access';
import { taskWhereFor } from '../../tasks';
import { deniedOpsFor, parseOps, serializeOps } from '../../postpaid/pricing';
import { expiringWhere } from '../../postpaid/sales';

/** The signed-in account's desk: who it is (identity, balance, grants, stops), and the home board. */
@Injectable()
export class DeskService {
  constructor(private readonly tree: AccountTree, private readonly repo: DeskRepository) {}

  async me(actor: Actor) {
    // The branch owner in person sees the open, unseen alerts' count (system monitor M.6, D1); every other account
    // gets no `openAlerts` at all.
    const owner = isOwner(actor) && !actor.impersonating;
    const [wallet, accounts, openAlerts] = await Promise.all([
      this.repo.walletOf(actor.id),
      this.tree.accounts(),
      owner ? this.repo.openUnseenAlerts() : Promise.resolve(null),
    ]);
    return {
      loginName: actor.loginName,
      nickname: actor.nickname,
      layer: actor.layer,
      isBranchOwner: isOwner(actor),
      grants: actor.grants,
      // The stops on the actor's own path, own node included. `transfer` is judged on the actor, so the
      // browser needs them to hide what the server would refuse.
      stops: parseOps(serializeOps([...deniedOpsFor(this.tree.pathOf(actor.id, accounts))])),
      impersonating: actor.impersonating,
      balance: wallet?.balance ?? 0,
      ceiling: wallet?.ceiling ?? 0,
      ...(openAlerts === null ? {} : { openAlerts }),
    };
  }

  async home(actor: Actor) {
    const accounts = await this.tree.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const posIds = accounts.filter((account) => account.layer === 'pos' && visible.has(account.id)).map((account) => account.id);
    const taskWhere = { ...taskWhereFor(actor, accounts), status: 'pending' };
    // Open tasks (pending or being worked on) for the sidebar's count beside «المهام» (spec 2026-11-09-graphite-identity).
    const openWhere = { ...taskWhereFor(actor, accounts), status: { in: ['pending', 'working'] } };
    // The branch sees every point of sale and sends no id list (database plan DB.10): every line and every line
    // operation is a point of sale's (a line is only ever opened on or moved to one, and an operation is written on
    // the line's point of sale). Another layer sends its own points of sale, and reads nothing when it has none.
    const scoped = actor.layer === 'branch' ? null : posIds;
    const reads = scoped === null || scoped.length > 0;
    const [pendingTasks, openTasks, activeLines, inactiveLines, expiringLines, entries] = await Promise.all([
      this.repo.taskCount(taskWhere),
      this.repo.taskCount(openWhere),
      reads ? this.repo.lineCountInStatus(scoped, 'active') : 0,
      reads ? this.repo.lineCountInStatus(scoped, 'disconnected') : 0,
      reads ? this.repo.lineCount({ ...(scoped ? { posId: { in: scoped } } : {}), ...expiringWhere() }) : 0,
      reads ? this.repo.latestOperations(scoped) : [],
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
