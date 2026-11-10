import { KernelModule } from '../kernel/kernel.module';
import { LayerRoles } from './layer-roles';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { Module } from '@nestjs/common';

/** Roles and their grants; the default role of each layer. */
export const ROLES_CONTROLLERS = [RolesController];
export const ROLES_PROVIDERS = [RolesService, LayerRoles];

@Module({
  imports: [KernelModule],
  controllers: ROLES_CONTROLLERS,
  providers: ROLES_PROVIDERS,
  exports: [LayerRoles],
})
export class RolesModule {}
