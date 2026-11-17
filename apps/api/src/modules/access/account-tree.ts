import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { fail, UnitOfWork, type Db } from '../platform';
import { visibleAccountIds } from './account-visibility';
import type { PathNode, Account, Actor } from './types';

/** An account as one step of a path. */
export function nodeOf(account: Account): PathNode {
  return { id: account.id, loginName: account.loginName, layer: account.layer, deniedOps: account.deniedOps ?? '' };
}

/** Every account by its id. */
export function accountsById<T extends { id: string }>(accounts: T[]): Map<string, T> {
  return new Map(accounts.map((account) => [account.id, account]));
}

/** One request's read of the tree, while the request is open. */
type TreeRead = { open: boolean; accounts?: Promise<Account[]> };

const requestTree = new AsyncLocalStorage<TreeRead>();

/**
 * Runs a read request's handler with one read of the tree shared by every `accounts()` it makes (plan
 * 2026-11-17-speed, PF.9). The read belongs to this request alone and ends with it: a timer or a stream the handler
 * leaves running reads afresh. ActorInterceptor uses it for GET only: a GET writes nothing (ADR 0015), so no account
 * can change under it by its own hand, and a route that writes reads the tree afresh after its write, as before.
 */
export function withRequestTree<T>(handle: () => Observable<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    const read: TreeRead = { open: true };
    const subscription = requestTree.run(read, () => handle().subscribe(subscriber));
    return () => {
      read.open = false;
      read.accounts = undefined;
      subscription.unsubscribe();
    };
  });
}

/** The accounts as a tree: who is above whom, and what an account may see. */
@Injectable()
export class AccountTree {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * Every account, as the tree is walked. Inside a transaction pass its client (rule 1.3): that read goes through the
   * transaction, every time. Without one, a GET request's calls share one read (`withRequestTree`).
   */
  async accounts(db: Db = this.uow.prisma): Promise<Account[]> {
    const shared = db === this.uow.prisma ? requestTree.getStore() : undefined;
    if (!shared?.open) return this.read(db);
    let read = shared.accounts;
    if (!read) {
      const first = this.read(db);
      shared.accounts = first;
      read = first;
      // A failed read is not shared: the next call reads again.
      first.catch(() => {
        if (shared.accounts === first) shared.accounts = undefined;
      });
    }
    // Each caller gets its own list; the rows are shared and read only.
    return [...(await read)];
  }

  private async read(db: Db): Promise<Account[]> {
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
  /**
   * A caller that walks many paths in one request builds `byId` once (`accountsById`) and hands it in, instead of a
   * map of every account per path (plan 2026-11-17-speed, PF.2).
   */
  pathOf(userId: string, accounts: Account[], byId: ReadonlyMap<string, Account> = accountsById(accounts)): PathNode[] {
    const path: PathNode[] = [];
    let current = byId.get(userId);
    while (current && path.length <= accounts.length) {
      path.push(nodeOf(current));
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  }
}
