import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DOOR_HOSTS } from '../../../doors';
import { hashPassword } from '../../auth/password';
import { fullNameProblem, newPasswordProblem } from '../../auth/validators';
import { fail } from '../../shared/office-failure';
import { assertBranch, OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { GRANT_CODES, effectiveGrantCodes, roleGrantCodes, splitGrants } from '../office-grants';
import { visibleAccountIds } from '../office-rules';
import { stampTaskLog } from '../task-log';
import { HANDLER_FROZEN_NOTE } from '../tasks/task-notes';
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
  constructor(private readonly kernel: OfficeKernel) {}

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
    const accounts = await this.kernel.prisma.user.findMany({
      select: { id: true, loginName: true, nickname: true, layer: true, parentId: true, disabledAt: true, isBranchOwner: true, role: { select: { name: true, staff: true } } },
      orderBy: { loginName: 'asc' },
    });
    const ids = visibleAccountIds(actor.id, actor.layer, accounts);
    return { accounts, visible: accounts.filter((account) => ids.has(account.id)) };
  }

  private async present(actor: Actor, accounts: ListedAccount[], shown: ListedAccount[]) {
    const wallets = await this.kernel.prisma.wallet.findMany({ where: { userId: { in: shown.map((account) => account.id) } } });
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
      canEnter: (actor.isBranchOwner || actor.grants.includes('enter')) && !actor.impersonating && account.id !== actor.id && account.disabledAt === null,
      canFreeze: (actor.isBranchOwner || actor.grants.includes('staff')) && !account.isBranchOwner && !(account.role?.staff && !actor.isBranchOwner),
      canDelete: branch && !account.isBranchOwner && account.id !== actor.id,
    }));
  }

  /**
   * Login name → full name for every account the actor may meet on a screen: the accounts it can
   * see (its subtree), the chain above it, and the branch layer (staff act on every ledger).
   */
  async directory(actor: Actor) {
    const accounts = await this.kernel.accounts();
    const visible = visibleAccountIds(actor.id, actor.layer, accounts);
    const chain = new Set(this.kernel.chainIds(actor.id, accounts));
    const names: Record<string, string> = {};
    for (const account of accounts) {
      if (!visible.has(account.id) && !chain.has(account.id) && account.layer !== 'branch') continue;
      names[account.loginName] = account.nickname;
    }
    return { names };
  }

  async create(actor: Actor, body: { loginName?: unknown; nickname?: unknown; password?: unknown; layer?: unknown; parentLogin?: unknown; roleId?: unknown }) {
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    const loginName = typeof body.loginName === 'string' ? body.loginName.trim().toLowerCase() : '';
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const layer = typeof body.layer === 'string' ? body.layer : '';
    const parentLogin = typeof body.parentLogin === 'string' ? body.parentLogin.trim() : '';
    if (!/^[a-z0-9._-]{3,32}$/.test(loginName)) fail(400, 'INVALID');
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
      if (actor.layer !== 'branch' || (!actor.isBranchOwner && !actor.grants.includes('staff'))) fail(403, 'FORBIDDEN');
      const roleId = typeof body.roleId === 'string' ? body.roleId : '';
      const role = roleId ? await this.kernel.prisma.role.findUnique({ where: { id: roleId } }) : null;
      if (!role || (role.staff && !actor.isBranchOwner)) fail(403, 'FORBIDDEN');
      const owner = await this.kernel.prisma.user.findFirst({ where: { isBranchOwner: true } });
      if (!owner) fail(400, 'INVALID');
      const existing = await this.kernel.prisma.user.findUnique({ where: { loginName } });
      if (existing) fail(400, 'LOGIN_TAKEN');
      await this.kernel.prisma.user.create({
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
    const accounts = await this.kernel.accounts();
    const direct: Record<string, string> = { branch: 'main_agent', main_agent: 'agent', agent: 'pos' };
    let parent = accounts.find((account) => account.id === actor.id) ?? null;
    if (layer !== direct[actor.layer]) {
      const chosen = accounts.find((account) => account.loginName === parentLogin);
      const visible = visibleAccountIds(actor.id, actor.layer, accounts);
      const parentLayer = layer === 'agent' ? 'main_agent' : 'agent';
      parent = chosen && chosen.id !== actor.id && visible.has(chosen.id) && chosen.layer === parentLayer ? chosen : null;
    }
    if (!parent) fail(400, 'INVALID');
    const existing = await this.kernel.prisma.user.findUnique({ where: { loginName } });
    if (existing) fail(400, 'LOGIN_TAKEN');
    await this.kernel.prisma.user.create({
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

  async setPassword(actor: Actor, loginName: string, body: { password?: unknown }) {
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    const password = typeof body.password === 'string' ? body.password : '';
    const passError = newPasswordProblem(password);
    if (passError) fail(400, passError);
    const target = await this.kernel.prisma.user.findUnique({ where: { loginName } });
    if (!target || target.isBranchOwner || target.id === actor.id) fail(403, 'FORBIDDEN');
    const accounts = await this.kernel.accounts();
    if (!visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(403, 'FORBIDDEN');
    const rank: Record<string, number> = { branch: 0, main_agent: 1, agent: 2, pos: 3 };
    if (target.roleId) {
      if (!actor.isBranchOwner && !actor.grants.includes('staff')) fail(403, 'FORBIDDEN');
    } else if ((rank[target.layer] ?? 9) <= (rank[actor.layer] ?? 9)) fail(403, 'FORBIDDEN');
    await this.kernel.prisma.user.update({
      where: { id: target.id },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true },
    });
    return { ok: true as const };
  }

  async detail(actor: Actor, loginName: string) {
    await this.kernel.ensureLayerRoles();
    const target = await this.kernel.visibleAccount(actor, loginName);
    const [layerRole, jobs, extra] = await Promise.all([
      this.kernel.prisma.role.findUnique({ where: { layer: target.layer } }),
      this.kernel.prisma.role.findMany({ where: { kind: 'job' }, orderBy: { name: 'asc' } }),
      this.kernel.prisma.userRole.findMany({ where: { userId: target.id }, include: { role: true } }),
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
      ? await this.kernel.prisma.user.findUnique({ where: { id: target.parentId }, select: { loginName: true } })
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
      canEdit: actor.isBranchOwner && !actor.impersonating && !target.isBranchOwner,
      listed,
    };
  }

  async saveAccess(actor: Actor, loginName: string, body: { extraGrants?: unknown; deniedGrants?: unknown; extraRoleIds?: unknown; roleId?: unknown }) {
    if (!actor.isBranchOwner || actor.impersonating) fail(403, 'FORBIDDEN');
    const target = await this.kernel.visibleAccount(actor, loginName);
    if (target.isBranchOwner) fail(403, 'FORBIDDEN');
    const extraGrants = splitGrants(Array.isArray(body.extraGrants) ? body.extraGrants.filter((code): code is string => typeof code === 'string').join(',') : '');
    const denied = new Set(splitGrants(Array.isArray(body.deniedGrants) ? body.deniedGrants.filter((code): code is string => typeof code === 'string').join(',') : ''));
    for (const code of extraGrants) denied.delete(code);
    const wanted = Array.isArray(body.extraRoleIds) ? body.extraRoleIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
    const jobs = wanted.length === 0
      ? []
      : await this.kernel.prisma.role.findMany({ where: { id: { in: wanted }, kind: 'job' }, select: { id: true } });
    if (jobs.length !== new Set(wanted).size) fail(400, 'INVALID');
    const staff = target.layer === 'branch' && Boolean(target.roleId);
    let roleId = target.roleId;
    if (staff) {
      const next = typeof body.roleId === 'string' ? body.roleId : '';
      const primary = next ? await this.kernel.prisma.role.findUnique({ where: { id: next } }) : null;
      if (!primary || primary.kind === 'layer') fail(400, 'INVALID');
      roleId = primary.id;
    }
    const extraIds = jobs.map((role) => role.id).filter((id) => id !== roleId);
    await this.kernel.runTx(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: { extraGrants: extraGrants.join(','), deniedGrants: [...denied].join(','), roleId },
      });
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      if (extraIds.length > 0) {
        await tx.userRole.createMany({ data: extraIds.map((id) => ({ userId: target.id, roleId: id })) });
      }
    });
    return { ok: true as const };
  }

  async setFrozen(actor: Actor, loginName: string, frozen: boolean) {
    assertBranch(actor);
    if (actor.impersonating) fail(403, 'FORBIDDEN');
    const target = await this.kernel.prisma.user.findUnique({ where: { loginName }, include: { role: true } });
    if (!target || target.isBranchOwner) fail(403, 'FORBIDDEN');
    if (!actor.isBranchOwner && !actor.grants.includes('staff')) fail(403, 'FORBIDDEN');
    if (target.role?.staff && !actor.isBranchOwner) fail(403, 'FORBIDDEN');
    await this.kernel.prisma.user.update({ where: { id: target.id }, data: { disabledAt: frozen ? new Date() : null } });
    if (frozen) {
      // The tasks it was handling go back to the pool: still open, nobody's (rule 2.4 — no status nothing handles).
      // One guarded write, so a task finished at this moment is left as it is.
      const handled = await this.kernel.prisma.officeTask.findMany({ where: { assigneeId: target.id, status: 'working' }, select: { id: true, log: true } });
      for (const task of handled) {
        await this.kernel.prisma.officeTask.updateMany({
          where: { id: task.id, assigneeId: target.id, status: 'working' },
          data: { assigneeId: null, log: stampTaskLog(task.log, HANDLER_FROZEN_NOTE) },
        });
      }
      await this.kernel.auth.dropLiveSessions(target.id);
    }
    return { ok: true };
  }

  async remove(actor: Actor, loginName: string) {
    assertBranch(actor);
    if (actor.impersonating) fail(403, 'FORBIDDEN');
    const target = await this.kernel.prisma.user.findUnique({ where: { loginName } });
    if (!target || target.isBranchOwner || target.id === actor.id) fail(403, 'FORBIDDEN');
    const [children, lines, tasks, entries] = await Promise.all([
      this.kernel.prisma.user.count({ where: { parentId: target.id } }),
      this.kernel.prisma.line.count({ where: { posId: target.id } }),
      this.kernel.prisma.officeTask.count({ where: { OR: [{ submitterId: target.id }, { posId: target.id }, { assigneeId: target.id }] } }),
      this.kernel.prisma.walletEntry.count({ where: { OR: [{ userId: target.id }, { actorId: target.id }] } }),
    ]);
    if (children + lines + tasks + entries > 0) fail(400, 'HAS_HISTORY');
    await this.kernel.auth.dropLiveSessions(target.id);
    await this.kernel.prisma.session.deleteMany({ where: { userId: target.id } });
    await this.kernel.prisma.wallet.deleteMany({ where: { userId: target.id } });
    await this.kernel.prisma.userPackage.deleteMany({ where: { userId: target.id } });
    await this.kernel.prisma.sellPrice.deleteMany({ where: { ownerId: target.id } });
    await this.kernel.prisma.user.delete({ where: { id: target.id } });
    return { ok: true };
  }

  async enter(actor: Actor, loginName: string, meta: { userAgent: string; ip: string; homeId?: string }) {
    if (actor.impersonating || actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    if (!actor.isBranchOwner && !actor.grants.includes('enter')) fail(403, 'FORBIDDEN');
    const target = await this.kernel.prisma.user.findUnique({ where: { loginName } });
    if (!target || target.disabledAt || target.id === actor.id) fail(400, 'INVALID');
    await this.kernel.prisma.accessLog.create({ data: { actorId: actor.operatorId, targetLogin: target.loginName, ip: meta.ip } });
    const sessionId = await this.kernel.auth.saveImpersonation({ userId: target.id, userAgent: meta.userAgent, ip: meta.ip });
    // The entered account opens on its own layer's door. Cookies there are set by `handoff`, so the browser carries
    // a one-time code to that host instead of the session itself (the admin host's cookies are left as they are).
    const code = randomBytes(32).toString('base64url');
    await this.kernel.auth.putSecret(handoffKey(code), JSON.stringify({ sessionId, homeId: meta.homeId ?? null }), HANDOFF_SECONDS);
    return { door: doorOfLayer(target.layer), code };
  }
}
