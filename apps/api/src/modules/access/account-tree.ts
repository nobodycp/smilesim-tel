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
   * transaction, every time. Without one, a GET request's calls share one read (`withRequestTree`). A money path
   * does not read it inside its transaction: it passes the path it read before and `confirmedPath` checks it (DB.9).
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

  /**
   * The path from `userId` up to the root inside a transaction, without reading the whole tree (database plan
   * DB.9, ADR 0023). A money path reads the tree before its transaction opens and passes the path in as `known`;
   * here, under the wallet lock, one statement reads those accounts' rows by id (`WHERE id IN (path ids)`) and the
   * path must still be the account's: every account there, each one's parent the next one on the path (the last
   * one the root), each one's layer what it was. Those are what a price and a ladder are built on. When it is not,
   * the account was moved meanwhile (or one above it was): `409 DUPLICATE_REQUEST`, as a line that changed under
   * a request is refused (`lockUnchanged`), and the transaction rolls back. The caller asks again and reads the
   * new path. A login, a stop or a freeze is not compared: none of them prices or credits anything, and a sale
   * judged them before its transaction, as it did before DB.9.
   *
   * Without a known path (a refund's ladder of an older sale, a caller that read none) the path is read up the
   * parent links one account at a time, by id: the accounts on the path and no others.
   *
   * No row is locked: under Read Committed this is what the whole-tree read it replaces gave, the path as it stood
   * after the wallet lock was taken.
   */
  async confirmedPath(db: Db, userId: string, known?: PathNode[]): Promise<PathNode[]> {
    if (!known || known.length === 0 || known[0].id !== userId) return this.pathById(db, userId);
    const rows = await db.user.findMany({ where: { id: { in: known.map((node) => node.id) } }, select: { id: true, parentId: true, layer: true } });
    const byId = accountsById(rows);
    const holds = known.every((node, index) => {
      const row = byId.get(node.id);
      return row !== undefined && row.layer === node.layer && row.parentId === (known[index + 1]?.id ?? null);
    });
    if (!holds) fail(409, 'DUPLICATE_REQUEST');
    return known;
  }

  /** The path up the parent links, one account by id at a time; stops at an account it has met (never loops). */
  private async pathById(db: Db, userId: string): Promise<PathNode[]> {
    const path: PathNode[] = [];
    const seen = new Set<string>();
    let id: string | null = userId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const row: { id: string; loginName: string; layer: string; deniedOps: string; parentId: string | null } | null = await db.user.findUnique({
        where: { id },
        select: { id: true, loginName: true, layer: true, deniedOps: true, parentId: true },
      });
      if (!row) break;
      path.push({ id: row.id, loginName: row.loginName, layer: row.layer, deniedOps: row.deniedOps ?? '' });
      id = row.parentId;
    }
    return path;
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
