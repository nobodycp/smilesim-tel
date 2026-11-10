import { isOwner, requireOwner } from '../policy';
import { Injectable } from '@nestjs/common';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/office-failure';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { LAYER_ORDER } from '../kernel/values';
import { FLAG_CODES, flagsFor, roleGrantCodes, splitGrants } from '../office-grants';
import { RoleBody } from './roles.schemas';

/** Roles, for the branch owner: the four layer roles and the job roles, with their grants. */
@Injectable()
export class RolesService {
  constructor(private readonly kernel: OfficeKernel) {}

  async list(actor: Actor) {
    if (!isOwner(actor)) fail(403, 'FORBIDDEN');
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

  async save(actor: Actor, body: unknown) {
    requireOwner(actor);
    const input = parseInput(RoleBody, body);
    // `splitGrants` drops a code named twice.
    const listed = input.grants ? splitGrants(input.grants.join(',')) : FLAG_CODES.filter((code) => input[code] === true);
    const flags = flagsFor(listed);
    const sent = input.name ?? '';
    if (input.id) {
      const existing = await this.kernel.prisma.role.findUnique({ where: { id: input.id } });
      if (!existing) fail(404, 'NOT_FOUND');
      const name = existing.kind === 'layer' ? existing.name : sent;
      if (name.length < 2) fail(400, 'INVALID');
      await this.kernel.prisma.role.update({
        where: { id: input.id },
        data: { name, ...flags, grants: listed.join(',') },
      });
    } else {
      if (sent.length < 2) fail(400, 'INVALID');
      await this.kernel.prisma.role.create({ data: { name: sent, kind: 'job', ...flags, grants: listed.join(',') } });
    }
    return { ok: true as const };
  }
}
