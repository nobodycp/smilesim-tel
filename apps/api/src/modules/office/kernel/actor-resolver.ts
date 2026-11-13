import { Inject, Injectable } from '@nestjs/common';
import { AUTH_STORE, type AuthStore } from '../../auth/auth.store';
import type { Gate } from '../../shared/cookies';
import { fail } from '../../shared/api-failure';
import { GRANT_CODES, effectiveGrantCodes } from '../rules/office-grants';
import type { Actor } from './types';
import { UnitOfWork, type Db } from './unit-of-work';

type RoleFlags = { grants: string; read: boolean; edit: boolean; accounting: boolean; tasks: boolean; reports: boolean; staff: boolean; enter: boolean };

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
    await this.auth.touchSession(sessionId, live.rules.idleSeconds);
    const impersonating = live.session.kind === 'impersonation';
    // Who really acted is kept on the entered session itself, never read from a cookie (rule 3.5).
    const operatorId = (impersonating && live.session.operatorId) || live.user.id;
    const stored = await this.uow.prisma.user.findUnique({
      where: { id: live.user.id },
      include: { role: true, extraRoles: { include: { role: true } } },
    });
    return {
      id: live.user.id,
      loginName: live.user.loginName,
      nickname: live.user.nickname || live.user.loginName,
      layer: live.user.layer,
      isBranchOwner: live.user.isBranchOwner,
      grants: await this.grantsFor(stored),
      operatorId,
      impersonating,
    };
  }

  /** The grant codes an account holds: every one for the owner, else its layer's role or its staff roles. */
  async grantsFor(stored: GrantSource | null, db: Db = this.uow.prisma): Promise<string[]> {
    if (stored?.isBranchOwner) return [...GRANT_CODES];
    if (!stored?.layer || !db.role) return (stored?.liveGrants ?? '').split(',').filter(Boolean);
    const staff = stored.layer === 'branch' && Boolean(stored.roleId);
    const layerRole = staff ? null : await db.role.findUnique({ where: { layer: stored.layer } });
    return effectiveGrantCodes({
      owner: false,
      staff,
      layer: stored.layer,
      layerRole,
      roles: [stored.role, ...(stored.extraRoles ?? []).map((link) => link.role)],
      extra: stored.extraGrants,
      denied: stored.deniedGrants,
    });
  }
}
