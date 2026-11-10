import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../kernel/unit-of-work';
import { LAYER_ORDER } from '../kernel/values';
import { LAYER_GRANTS, flagsFor } from '../rules/office-grants';

/** The role every layer has by default. */
@Injectable()
export class LayerRoles {
  constructor(private readonly uow: UnitOfWork) {}

  /** The four layer roles exist: made on first need (role screens, account access, boot). */
  async ensureLayerRoles(): Promise<void> {
    for (const layer of LAYER_ORDER) {
      const existing = await this.uow.prisma.role.findUnique({ where: { layer } });
      if (existing) continue;
      const grants = LAYER_GRANTS[layer] ?? [];
      await this.uow.prisma.role.create({
        data: { name: layer, kind: 'layer', layer, grants: grants.join(','), ...flagsFor(grants) },
      });
    }
  }
}
