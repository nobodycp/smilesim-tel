import { RolesRepository } from './roles.repository';
import { AccessModule } from '../access.module';
import { PlatformModule } from '../../platform';
import { LayerRoles } from './layer-roles';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { Module } from '@nestjs/common';

/** Roles and their grants; the default role of each layer. */
export const ROLES_CONTROLLERS = [RolesController];
export const ROLES_PROVIDERS = [RolesRepository, RolesService, LayerRoles];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: ROLES_CONTROLLERS,
  providers: ROLES_PROVIDERS,
  exports: [LayerRoles],
})
export class RolesModule {}
