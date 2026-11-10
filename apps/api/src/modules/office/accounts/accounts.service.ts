import { AccountsRepository } from './accounts.repository';
import { AUTH_STORE, type AuthStore } from '../../auth/auth.store';
import { LayerRoles } from '../roles/layer-roles';
import { AccountTree } from '../kernel/account-tree';
import { UnitOfWork } from '../kernel/unit-of-work';
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DOOR_HOSTS } from '../../../doors';
import { hashPassword } from '../../auth/password';
import { fullNameProblem, newPasswordProblem } from '../../auth/validators';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import { GRANT_CODES, effectiveGrantCodes, roleGrantCodes, splitGrants } from '../rules/office-grants';
import { visibleAccountIds } from '../rules/office-rules';
import { holds, isBranch, isOwner, layerRank, requireGrant, requireOwner, assertBranch } from '../policy';
import { stampTaskLog } from '../tasks/task-log';
import { HANDLER_FROZEN_NOTE } from '../stored-text';
import { AccessBody, CreateUserBody, SetAccountPasswordBody } from './accounts.schemas';
import { HANDOFF_SECONDS, handoffKey } from './handoff';
import { usersPage, type UsersFilter } from './users-page';

const doorOfLayer = (layer: string) => DOOR_HOSTS.find((door) => door.layer === layer)?.host ?? 'admin';

type ListedAccount = {
  id: string; loginName: string; nickname: string; layer: string; parentId: string | null; disabledAt: Date | null; isBranchOwner: boolean;
  role: { name: string; staff: boolean } | null;
};

/** Accounts below the signed-in one: the list and the name directory, opening an account, resetting its password, its access (grants and roles), freezing, deleting, and entering it. */
@Injectable()
export class AccountsService {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree, private readonly layerRoles: LayerRoles, @Inject(AUTH_STORE) private readonly auth: AuthStore, private readonly repo: AccountsRepository) {}

  /** Every account the actor may see, unpaged: the shell search, the dialogs and the line card read it. */
  async list(actor: Actor) {
    const { accounts, visible } = await this.visibleAccounts(actor);
    return { users: await this.present(actor, accounts, visible) };
  }

  /** One page of the users table, filtered and ordered by the server (`users-page.ts`). */
  async page(actor: Actor, filter: UsersFilter) {
    const { accounts, visible } = await this.visibleAccounts(actor);
    const { page, nextCursor, total } = usersPage(visible, filter);
    return { users: await this.present(actor, accounts, page), nextCursor, total };
  }

  private async visibleAccounts(actor: Actor) {
    const accounts = await this.repo.listedAccounts();
    const ids = visibleAccountIds(actor.id, actor.layer, accounts);
    return { accounts, visible: accounts.filter((account) => ids.has(account.id)) };
  }

  private async present(actor: Actor, accounts: ListedAccount[], shown: ListedAccount[]) {
    const wallets = await this.repo.walletsOf(shown.map((account) => account.id));
    const byWallet = new Map(wallets.map((row) => [row.userId, row]));
    const byId = new Map(accounts.map((account) => [account.id, account]));
    const branch = actor.layer === 'branch' && !actor.impersonating;
    return shown.map((account) => ({
      loginName: account.loginName,
      nickname: account.nickname,
      layer: account.layer,
      roleName: account.role?.name ?? '',
      parentLogin: account.parentId ? byId.get(account.parentId)?.loginName ?? null : null,
      balance: byWallet.get(account.id)?.balance ?? 0,
      ceiling: byWallet.get(account.id)?.ceiling ?? 0,
      held: byWallet.get(account.id)?.held ?? 0,
      frozen: account.disabledAt !== null,
      self: account.id === actor.id,
      directChild: account.parentId === actor.id,
      canEnter: holds(actor, 'enter') && !actor.impersonating && account.layer !== 'branch' && account.disabledAt === null,
      canFreeze: holds(actor, 'staff') && !account.isBranchOwner && !(account.role?.staff && !isOwner(actor)),
      canDelete: branch && !account.isBranchOwner && account.id !== actor.id,
    }));
  }

  /**
   * Login name → full name for every account the actor may meet on a screen: the accounts it can
   * see (its subtree), the chain above it, and the branch layer (staff act on every ledger).
   */
  async directory(actor: Actor) {
    const accounts = await this.tree.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const chain = new Set(this.tree.chainIds(actor.id, accounts));
    const names: Record<string, string> = {};
    for (const account of accounts) {
      if (!visible.has(account.id) && !chain.has(account.id) && account.layer !== 'branch') continue;
      names[account.loginName] = account.nickname;
    }
    return { names };
  }

  /** `body` is a `CreateUserBody`, judged after the permission checks; only its layer is read before that. */
  async create(actor: Actor, body: { layer?: unknown }) {
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    // In the branch, opening an account is an edit and opening an employee is staff work (review S11).
    if (isBranch(actor)) requireGrant(actor, body.layer === 'staff' ? 'staff' : 'edit');
    const { loginName, nickname, password, layer, parentLogin, roleId } = parseInput(CreateUserBody, body);
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
      requireGrant(actor, 'staff');
      const role = roleId ? await this.repo.roleById(roleId) : null;
      if (!role || (role.staff && !isOwner(actor))) fail(403, 'FORBIDDEN');
      const owner = await this.repo.branchOwner();
      if (!owner) fail(400, 'INVALID');
      const existing = await this.repo.accountByLogin(loginName);
      if (existing) fail(409, 'LOGIN_TAKEN');
      await this.repo.openEmployee({ loginName, nickname, passwordHash: await hashPassword(password), parentId: owner.id, roleId: role.id });
      return { ok: true as const };
    }
    if (!allowed[actor.layer]?.includes(layer)) fail(403, 'FORBIDDEN');
    const accounts = await this.tree.accounts();
    const direct: Record<string, string> = { branch: 'main_agent', main_agent: 'agent', agent: 'pos' };
    // A main agent opened by an employee hangs under the owner, as every main agent does: the tree has one root.
    const self = isBranch(actor) && !isOwner(actor) ? await this.repo.branchOwnerId() : { id: actor.id };
    let parent = accounts.find((account) => account.id === self?.id) ?? null;
    if (layer !== direct[actor.layer]) {
      const chosen = accounts.find((account) => account.loginName === parentLogin);
      const visible = visibleAccountIds(actor.id, actor.layer, accounts);
      const parentLayer = layer === 'agent' ? 'main_agent' : 'agent';
      parent = chosen && chosen.id !== actor.id && visible.has(chosen.id) && chosen.layer === parentLayer ? chosen : null;
    }
    if (!parent) fail(400, 'INVALID');
    const existing = await this.repo.accountByLogin(loginName);
    if (existing) fail(409, 'LOGIN_TAKEN');
    await this.repo.openAccount({ loginName, nickname, passwordHash: await hashPassword(password), layer, parentId: parent.id });
    return { ok: true as const };
  }

  async setPassword(actor: Actor, loginName: string, body: unknown) {
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    // In the branch a reset is staff work (review S3). Permission before anything is read (rule 3).
    if (isBranch(actor)) requireGrant(actor, 'staff');
    const { password } = parseInput(SetAccountPasswordBody, body);
    const passError = newPasswordProblem(password);
    if (passError) fail(400, passError);
    const target = await this.repo.accountByLogin(loginName);
    if (!target || target.isBranchOwner || target.id === actor.id) fail(403, 'FORBIDDEN');
    const accounts = await this.tree.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(403, 'FORBIDDEN');
    if (isBranch(actor)) {
      // An employee's password is the owner's alone to reset.
      if (target.layer === 'branch' && !isOwner(actor)) fail(403, 'FORBIDDEN');
    } else if (layerRank(target.layer) <= layerRank(actor.layer)) fail(403, 'FORBIDDEN');
    await this.repo.resetPassword(target.id, await hashPassword(password));
    // Whoever held the old password is signed out (rule 3.6).
    await this.auth.dropLiveSessions(target.id);
    return { ok: true as const };
  }

  async detail(actor: Actor, loginName: string) {
    await this.layerRoles.ensureLayerRoles();
    const target = await this.tree.visibleAccount(actor, loginName);
    const [layerRole, jobs, extra] = await Promise.all([
      this.repo.layerRole(target.layer),
      this.repo.jobRoles(),
      this.repo.extraRolesOf(target.id),
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
      ? await this.repo.loginOf(target.parentId)
      : null;
    // The account as the users list shows it (wallet and what the actor may do), for the page's head and cards.
    const { accounts, visible } = await this.visibleAccounts(actor);
    const shown = visible.find((account) => account.id === target.id);
    const listed = shown ? (await this.present(actor, accounts, [shown]))[0] ?? null : null;
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
      canEdit: isOwner(actor) && !actor.impersonating && !target.isBranchOwner,
      listed,
    };
  }

  async saveAccess(actor: Actor, loginName: string, body: unknown) {
    requireOwner(actor);
    const target = await this.tree.visibleAccount(actor, loginName);
    if (target.isBranchOwner) fail(403, 'FORBIDDEN');
    const input = parseInput(AccessBody, body);
    const extraGrants = splitGrants(input.extraGrants.join(','));
    const denied = new Set(splitGrants(input.deniedGrants.join(',')));
    for (const code of extraGrants) denied.delete(code);
    const wanted = input.extraRoleIds.filter((id) => id.length > 0);
    const jobs = wanted.length === 0
      ? []
      : await this.repo.jobRoleIdsAmong(wanted);
    if (jobs.length !== new Set(wanted).size) fail(400, 'INVALID');
    const staff = target.layer === 'branch' && Boolean(target.roleId);
    let roleId = target.roleId;
    if (staff) {
      const next = input.roleId;
      const primary = next ? await this.repo.roleById(next) : null;
      if (!primary || primary.kind === 'layer') fail(400, 'INVALID');
      roleId = primary.id;
    }
    const extraIds = jobs.map((role) => role.id).filter((id) => id !== roleId);
    await this.uow.runTx(async (tx) => {
      await this.repo.saveGrants(tx, target.id, { extraGrants: extraGrants.join(','), deniedGrants: [...denied].join(','), roleId });
      await this.repo.clearExtraRoles(tx, target.id);
      if (extraIds.length > 0) {
        await this.repo.addExtraRoles(tx, target.id, extraIds);
      }
    });
    return { ok: true as const };
  }

  async setFrozen(actor: Actor, loginName: string, frozen: boolean) {
    assertBranch(actor);
    if (actor.impersonating) fail(403, 'FORBIDDEN');
    const target = await this.repo.accountWithRoleByLogin(loginName);
    if (!target || target.isBranchOwner) fail(403, 'FORBIDDEN');
    requireGrant(actor, 'staff');
    if (target.role?.staff && !isOwner(actor)) fail(403, 'FORBIDDEN');
    await this.repo.setFrozenAt(target.id, frozen ? new Date() : null);
    if (frozen) {
      // The tasks it was handling go back to the pool: still open, nobody's (rule 2.4 — no status nothing handles).
      // One guarded write, so a task finished at this moment is left as it is.
      const handled = await this.repo.openTasksHandledBy(target.id);
      for (const task of handled) {
        await this.repo.releaseTask(task.id, target.id, stampTaskLog(task.log, HANDLER_FROZEN_NOTE));
      }
      await this.auth.dropLiveSessions(target.id);
    }
    return { ok: true };
  }

  async remove(actor: Actor, loginName: string) {
    assertBranch(actor);
    if (actor.impersonating) fail(403, 'FORBIDDEN');
    const target = await this.repo.accountByLogin(loginName);
    if (!target || target.isBranchOwner || target.id === actor.id) fail(403, 'FORBIDDEN');
    // Removing an employee is staff work; removing any other account is an edit (review S11).
    requireGrant(actor, target.layer === 'branch' ? 'staff' : 'edit');
    const [children, lines, tasks, entries] = await Promise.all([
      this.repo.childCount(target.id),
      this.repo.lineCount(target.id),
      this.repo.taskCount(target.id),
      this.repo.walletEntryCount(target.id),
    ]);
    if (children + lines + tasks + entries > 0) fail(400, 'HAS_HISTORY');
    await this.auth.dropLiveSessions(target.id);
    await this.repo.removeSessions(target.id);
    await this.repo.removeWallet(target.id);
    await this.repo.removePackages(target.id);
    await this.repo.removeSellPrices(target.id);
    await this.repo.removeAccount(target.id);
    return { ok: true };
  }

  async enter(actor: Actor, loginName: string, meta: { userAgent: string; ip: string; homeId?: string }) {
    if (actor.impersonating || actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    requireGrant(actor, 'enter');
    const target = await this.repo.accountByLogin(loginName);
    if (!target || target.disabledAt || target.id === actor.id) fail(400, 'INVALID');
    // Only an account below the branch is entered: never the owner, never another employee (review S1).
    if (target.layer === 'branch') fail(403, 'FORBIDDEN');
    await this.repo.logEntry({ actorId: actor.operatorId, targetLogin: target.loginName, ip: meta.ip });
    const sessionId = await this.auth.saveImpersonation({ userId: target.id, operatorId: actor.id, userAgent: meta.userAgent, ip: meta.ip });
    // The entered account opens on its own layer's door. Cookies there are set by `handoff`, so the browser carries
    // a one-time code to that host instead of the session itself (the admin host's cookies are left as they are).
    const code = randomBytes(32).toString('base64url');
    await this.auth.putSecret(handoffKey(code), JSON.stringify({ sessionId, homeId: meta.homeId ?? null }), HANDOFF_SECONDS);
    return { door: doorOfLayer(target.layer), code };
  }
}
