import { ProviderCatalogRepository } from './provider-catalog.repository';
import { AccessModule } from '../../access';
import { PlatformModule } from '../../platform';
import { ProviderCatalogController } from './provider-catalog.controller';
import { ProviderCatalogService } from './provider-catalog.service';
import { Module } from '@nestjs/common';

/** Adding to the catalog from a provider: query its companies and products, then add a company or a package. */
export const PROVIDER_CATALOG_CONTROLLERS = [ProviderCatalogController];
export const PROVIDER_CATALOG_PROVIDERS = [ProviderCatalogRepository, ProviderCatalogService];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: PROVIDER_CATALOG_CONTROLLERS,
  providers: PROVIDER_CATALOG_PROVIDERS,
  exports: [],
})
export class ProviderCatalogModule {}
