import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { UnitOfWork } from '../kernel/unit-of-work';

/**
 * The database as this domain reads and writes it: the roles. One method per query, named for what it returns or
 * changes. No rule and no permission lives here (backend-engineering.mdc 5.1).
 */
@Injectable()
export class RolesRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** The roles, at most `take`. */
  roles(take: number) {
    return this.uow.prisma.role.findMany({ take });
  }

  roleById(id: string) {
    return this.uow.prisma.role.findUnique({ where: { id } });
  }

  createRole(data: Prisma.RoleCreateInput) {
    return this.uow.prisma.role.create({ data });
  }

  updateRole(id: string, data: Prisma.RoleUpdateInput) {
    return this.uow.prisma.role.update({ where: { id }, data });
  }
}
