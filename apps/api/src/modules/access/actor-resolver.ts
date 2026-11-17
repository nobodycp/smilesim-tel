import { Inject, Injectable } from '@nestjs/common';
import { AUTH_STORE, type AuthStore } from '../auth';
import type { Gate } from '../platform';
import { fail, UnitOfWork, type Db } from '../platform';
import { GRANT_CODES, effectiveGrantCodes } from './grants';
import type { Actor } from './types';

type RoleFlags = { grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean };

/** A layer's role as read for that layer; `role` null when the layer has none. */
type LayerRole = { layer: string; role: RoleFlags | null };

/** What decides an account's grants, as stored. */
export type GrantSource = {
  isBranchOwner?: boolean;
  liveGrants?: string | null;
  layer?: string;
  roleId?: string | null;
  extraGrants?: string | null;
  deniedGrants?: string | null;
  role?: RoleFlags | null;
  extraRoles?: { role: RoleFlags }[];
};

/** Turns the session cookies of a request into the actor: who is signed in, on which layer, with which grants. */
@Injectable()
export class ActorResolver {
  constructor(@Inject(AUTH_STORE) private readonly auth: AuthStore, private readonly uow: UnitOfWork) {}

  /** The signed-in account of a full session; 401 for anything else. Slides the session's idle window. */
  async actor(gate: Gate): Promise<Actor> {
    const sessionId = gate.sessionId;
    if (!sessionId) fail(401, 'LOGIN_REQUIRED');
    const live = await this.auth.liveSession(sessionId);
    if (!live || live.session.scope !== 'full' || live.user.disabledAt) fail(401, 'LOGIN_REQUIRED');
    await this.auth.touchSession(sessionId, live.rules.idleSeconds, live.session.lastSeenAt);
    const impersonating = live.session.kind === 'impersonation';
    // Who really acted is kept on the entered session itself, never read from a cookie (rule 3.5).
    const operatorId = (impersonating && live.session.operatorId) || live.user.id;
    const { stored, layerRole } = await this.grantSource(live.user);
    return {
      id: live.user.id,
      loginName: live.user.loginName,
      nickname: live.user.nickname || live.user.loginName,
      layer: live.user.layer,
      isBranchOwner: live.user.isBranchOwner,
      grants: await this.grantsFor(stored, this.uow.prisma, layerRole),
      operatorId,
      impersonating,
    };
  }

  /**
   * What decides the grants of the session's account, in one round trip (plan 2026-11-17-speed, PF.9). The branch
   * owner holds every grant, so its row is read without its roles; should the row no longer be the owner's, it is
   * read whole. An account below the branch always counts its layer's role, which is read beside its row.
   */
  private async grantSource(user: { id: string; layer: string; isBranchOwner: boolean }): Promise<{ stored: GrantSource | null; layerRole?: LayerRole }> {
    const users = this.uow.prisma.user;
    if (user.isBranchOwner) {
      const row = await users.findUnique({ where: { id: user.id } });
      if (row?.isBranchOwner) return { stored: row };
    }
    const whole = users.findUnique({ where: { id: user.id }, include: { role: true, extraRoles: { include: { role: true } } } });
    const roles = this.uow.prisma.role;
    if (user.layer === 'branch' || !roles) return { stored: await whole };
    const [stored, role] = await Promise.all([whole, roles.findUnique({ where: { layer: user.layer } })]);
    return { stored, layerRole: { layer: user.layer, role } };
  }

  /**
   * The grant codes an account holds: every one for the owner, else its layer's role or its staff roles. `layerRole`
   * is the layer's role when the caller has read it already; it counts only for the layer it was read for.
   */
  async grantsFor(stored: GrantSource | null, db: Db = this.uow.prisma, layerRole?: LayerRole): Promise<string[]> {
    if (stored?.isBranchOwner) return [...GRANT_CODES];
    if (!stored?.layer || !db.role) return (stored?.liveGrants ?? '').split(',').filter(Boolean);
    const staff = stored.layer === 'branch' && Boolean(stored.roleId);
    const known = layerRole?.layer === stored.layer ? layerRole.role : undefined;
    const layerRoleFlags = staff ? null : known !== undefined ? known : await db.role.findUnique({ where: { layer: stored.layer } });
    return effectiveGrantCodes({
      owner: false,
      staff,
      layer: stored.layer,
      layerRole: layerRoleFlags,
      roles: [stored.role, ...(stored.extraRoles ?? []).map((link) => link.role)],
      extra: stored.extraGrants,
      denied: stored.deniedGrants,
    });
  }
}
