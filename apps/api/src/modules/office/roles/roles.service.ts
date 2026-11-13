import { LIST_CAP, capList } from '../../shared/paging';
import { RolesRepository } from './roles.repository';
import { isOwner, requireOwner } from '../policy';
import { Injectable } from '@nestjs/common';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/api-failure';
import type { Actor } from '../kernel/types';
import { LAYER_ORDER } from '../kernel/values';
import { FLAG_CODES, flagsFor, roleGrantCodes, splitGrants } from '../rules/office-grants';
import { RoleBody } from './roles.schemas';

/** Roles, for the branch owner: the four layer roles and the job roles, with their grants. */
@Injectable()
export class RolesService {
  constructor(private readonly repo: RolesRepository) {}

  async list(actor: Actor) {
    if (!isOwner(actor)) fail(403, 'FORBIDDEN');
    const { rows: roles, capped } = capList(await this.repo.roles(LIST_CAP + 1));
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
      capped,
    };
  }

  /** A new job role. */
  async create(actor: Actor, body: unknown) {
    requireOwner(actor);
    const { name, listed, flags } = this.read(body);
    if (name.length < 2) fail(400, 'INVALID');
    await this.repo.createRole({ name, kind: 'job', ...flags, grants: listed.join(',') });
    return { ok: true as const };
  }

  /** A role's grants, and its name unless it is a layer role (a layer role keeps the name it was made with). */
  async update(actor: Actor, id: string, body: unknown) {
    requireOwner(actor);
    const { name: sent, listed, flags } = this.read(body);
    const existing = await this.repo.roleById(id);
    if (!existing) fail(404, 'NOT_FOUND');
    const name = existing.kind === 'layer' ? existing.name : sent;
    if (name.length < 2) fail(400, 'INVALID');
    await this.repo.updateRole(id, { name, ...flags, grants: listed.join(',') });
    return { ok: true as const };
  }

  private read(body: unknown) {
    const input = parseInput(RoleBody, body);
    // `splitGrants` drops a code named twice.
    const listed = input.grants ? splitGrants(input.grants.join(',')) : FLAG_CODES.filter((code) => input[code] === true);
    return { name: input.name ?? '', listed, flags: flagsFor(listed) };
  }
}
