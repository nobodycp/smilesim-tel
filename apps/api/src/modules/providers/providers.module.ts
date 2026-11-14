import { ProvidersRepository } from './providers.repository';
import { AccessModule } from '../access/access.module';
import { PlatformModule } from '../platform/platform.module';
import { WalletsModule } from '../office/wallets/wallets.module';
import { PROVIDER_GATEWAY } from './integration/gateway/provider-gateway';
import { SimulatedProviderGateway } from './integration/gateway/simulated-gateway';
import { ProviderDispatchRepository } from './integration/dispatch/provider-dispatch.repository';
import { ProviderDispatchService } from './integration/dispatch/provider-dispatch.service';
import { ProviderOperationsRepository } from './integration/operations/provider-operations.repository';
import { ProviderOperationsService } from './integration/operations/provider-operations.service';
import { ProviderAccountsController } from './account/provider-accounts.controller';
import { ProviderAccountsService } from './account/provider-accounts.service';
import { ProviderCatalogController } from './directory/provider-catalog.controller';
import { ProviderCatalogService } from './directory/provider-catalog.service';
import { ProviderHealthService } from './directory/provider-health.service';
import { ProvidersController } from './directory/providers.controller';
import { ProvidersService } from './directory/providers.service';
import { Module } from '@nestjs/common';

/** Providers: settings, what they sell, what the office owes them, their health, and the gateway line operations go through. */
export const PROVIDERS_CONTROLLERS = [ProvidersController, ProviderCatalogController, ProviderAccountsController];
export const PROVIDERS_PROVIDERS = [ProvidersRepository, ProvidersService, ProviderCatalogService, ProviderAccountsService, ProviderHealthService, ProviderOperationsRepository, ProviderOperationsService, ProviderDispatchRepository, ProviderDispatchService, { provide: PROVIDER_GATEWAY, useClass: SimulatedProviderGateway }];

@Module({
  imports: [PlatformModule, AccessModule, WalletsModule],
  controllers: PROVIDERS_CONTROLLERS,
  providers: PROVIDERS_PROVIDERS,
  exports: [ProviderAccountsService, ProviderHealthService, ProviderOperationsService, PROVIDER_GATEWAY],
})
export class ProvidersModule {}
