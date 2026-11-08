import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { excerpt } from '../notice-kinds';
import { visibleAccountIds } from '../office-rules';
import { taskWhereFor } from '../task-access';
import { deniedOpsFor, parseOps, serializeOps } from '../user-terms';
import { expiringWhere } from '../office-paging';

/** The signed-in account's desk: who it is (identity, balance, grants, stops), the home board, and posting an announcement to everyone below it. */
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
      isBranchOwner: actor.isBranchOwner,
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
    const chain = this.kernel.chainIds(actor.id, accounts);
    const taskWhere = { ...taskWhereFor(actor, accounts), status: 'pending' };
    const [pendingTasks, activeLines, inactiveLines, expiringLines, entries, notes] = await Promise.all([
      this.kernel.prisma.officeTask.count({ where: taskWhere }),
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
      this.kernel.prisma.announcement.findMany({
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
      expiringLines,
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

  async postAnnouncement(actor: Actor, body: { body?: unknown }) {
    if (actor.layer === 'pos') fail(403, 'FORBIDDEN');
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (!text || text.length > 400) fail(400, 'INVALID');
    const accounts = await this.kernel.accounts();
    const audience = [...visibleAccountIds(actor.id, actor.layer, accounts)].filter((id) => id !== actor.id);
    await this.kernel.runTx(async (tx) => {
      const posted = await tx.announcement.create({ data: { authorId: actor.id, body: text } });
      this.kernel.queueNotices(tx, await this.kernel.notice.write(tx, audience, actor, {
        kind: 'announcement',
        payload: { announcementId: posted.id, authorName: actor.nickname, excerpt: excerpt(text) },
      }));
    });
    return { ok: true };
  }
}
