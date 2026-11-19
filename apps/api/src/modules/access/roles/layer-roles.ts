import { Injectable } from '@nestjs/common';
import { UnitOfWork, LAYER_ORDER } from '../../platform';
import { LAYER_GRANTS, flagsFor } from '../grants';

/** The role every layer has by default. */
@Injectable()
export class LayerRoles {
  constructor(private readonly uow: UnitOfWork) {}

  /**
   * The four layer roles exist. Run when the API starts (`postpaid/catalog/shipped/catalog-seed.ts`), before it
   * serves anything, so no read has to make them (plan backend-loose-ends A.3: a GET writes nothing).
   */
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
