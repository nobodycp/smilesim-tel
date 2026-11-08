import { Injectable } from '@nestjs/common';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { LAYER_ORDER } from '../kernel/values';
import { FLAG_CODES, flagsFor, roleGrantCodes, splitGrants } from '../office-grants';

/** Roles, for the branch owner: the four layer roles and the job roles, with their grants. */
@Injectable()
export class RolesService {
  constructor(private readonly kernel: OfficeKernel) {}

  async list(actor: Actor) {
    if (!actor.isBranchOwner) fail(403, 'FORBIDDEN');
    await this.kernel.ensureLayerRoles();
    const roles = await this.kernel.prisma.role.findMany();
    const rank = (role: { kind: string; layer: string | null; name: string }) =>
      role.kind === 'layer' ? LAYER_ORDER.indexOf(role.layer ?? '') : LAYER_ORDER.length;
    roles.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return {
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        kind: role.kind === 'layer' ? 'layer' : 'job',
        layer: role.layer ?? '',
        grants: roleGrantCodes(role),
        read: role.read,
        edit: role.edit,
        accounting: role.accounting,
        tasks: role.tasks,
        reports: role.reports,
        staff: role.staff,
        enter: role.enter,
      })),
    };
  }

  async save(actor: Actor, body: { id?: unknown; name?: unknown; grants?: unknown; read?: unknown; edit?: unknown; accounting?: unknown; tasks?: unknown; reports?: unknown; staff?: unknown; enter?: unknown }) {
    if (!actor.isBranchOwner || actor.impersonating) fail(403, 'FORBIDDEN');
    const listed = Array.isArray(body.grants)
      ? splitGrants(body.grants.filter((code): code is string => typeof code === 'string').join(','))
      : FLAG_CODES.filter((code) => body[code] === true);
    const flags = flagsFor(listed);
    const id = typeof body.id === 'string' ? body.id : '';
    if (id) {
      const existing = await this.kernel.prisma.role.findUnique({ where: { id } });
      if (!existing) fail(404, 'NOT_FOUND');
      const name = existing.kind === 'layer' ? existing.name : (typeof body.name === 'string' ? body.name.trim() : '');
      if (name.length < 2) fail(400, 'INVALID');
      await this.kernel.prisma.role.update({
        where: { id },
        data: { name, ...flags, grants: listed.join(',') },
      });
    } else {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 2) fail(400, 'INVALID');
      await this.kernel.prisma.role.create({ data: { name, kind: 'job', ...flags, grants: listed.join(',') } });
    }
    return { ok: true as const };
  }
}
