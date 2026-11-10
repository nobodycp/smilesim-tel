import { KernelModule } from '../kernel/kernel.module';
import { RolesModule } from '../roles/roles.module';
import { CatalogSeed } from './catalog-seed';
import { Module } from '@nestjs/common';

/** Seeds the shipped catalog and the layer roles at boot. */
export const CATALOG_CONTROLLERS = [];
export const CATALOG_PROVIDERS = [CatalogSeed];

@Module({
  imports: [KernelModule, RolesModule],
  controllers: CATALOG_CONTROLLERS,
  providers: CATALOG_PROVIDERS,
  exports: [],
})
export class CatalogModule {}
