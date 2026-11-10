import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { visibleAccountIds } from '../rules/office-rules';
import type { PathNode } from '../rules/user-terms';
import type { Account, Actor } from './types';
import { UnitOfWork, type Db } from './unit-of-work';

/** An account as one step of a path. */
export function nodeOf(account: Account): PathNode {
  return { id: account.id, loginName: account.loginName, layer: account.layer, deniedOps: account.deniedOps ?? '' };
}

/** The accounts as a tree: who is above whom, and what an account may see. */
@Injectable()
export class AccountTree {
  constructor(private readonly uow: UnitOfWork) {}

  /** Every account, as the tree is walked. Inside a transaction pass its client (rule 1.3). */
  async accounts(db: Db = this.uow.prisma): Promise<Account[]> {
    return db.user.findMany({
      select: { id: true, loginName: true, nickname: true, layer: true, parentId: true, deniedOps: true, disabledAt: true },
      orderBy: { loginName: 'asc' },
    });
  }

  /**
   * The account by its login, when the actor may see it. One that does not exist and one outside the actor's tree
   * answer the same 404, so a refusal never tells which logins exist (backend-engineering.mdc 4.8).
   */
  async visibleAccount(actor: Actor, loginName: string) {
    const target = await this.uow.prisma.user.findUnique({ where: { loginName }, include: { role: true } });
    if (!target) fail(404, 'NOT_FOUND');
    const accounts = await this.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(404, 'NOT_FOUND');
    return target;
  }

  /** The ids from an account up to the root, the account first. */
  chainIds(actorId: string, accounts: Account[]): string[] {
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

  /** The accounts from `userId` up to the root. Empty when the user is unknown. */
  pathOf(userId: string, accounts: Account[]): PathNode[] {
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const path: PathNode[] = [];
    let current = byId.get(userId);
    while (current && path.length <= accounts.length) {
      path.push(nodeOf(current));
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  }
}
