import { ProvidersRepository } from './providers.repository';
import { KernelModule } from '../kernel/kernel.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PROVIDER_GATEWAY } from './gateway/provider-gateway';
import { SimulatedProviderGateway } from './gateway/simulated-gateway';
import { ProviderDispatchRepository } from './dispatch/provider-dispatch.repository';
import { ProviderDispatchService } from './dispatch/provider-dispatch.service';
import { ProviderOperationsRepository } from './operations/provider-operations.repository';
import { ProviderOperationsService } from './operations/provider-operations.service';
import { ProviderAccountsController } from './provider-accounts.controller';
import { ProviderAccountsService } from './provider-accounts.service';
import { ProviderCatalogController } from './provider-catalog.controller';
import { ProviderCatalogService } from './provider-catalog.service';
import { ProviderHealthService } from './provider-health.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { Module } from '@nestjs/common';

/** Providers: settings, what they sell, what the office owes them, their health, and the gateway line operations go through. */
export const PROVIDERS_CONTROLLERS = [ProvidersController, ProviderCatalogController, ProviderAccountsController];
export const PROVIDERS_PROVIDERS = [ProvidersRepository, ProvidersService, ProviderCatalogService, ProviderAccountsService, ProviderHealthService, ProviderOperationsRepository, ProviderOperationsService, ProviderDispatchRepository, ProviderDispatchService, { provide: PROVIDER_GATEWAY, useClass: SimulatedProviderGateway }];

@Module({
  imports: [KernelModule, WalletsModule],
  controllers: PROVIDERS_CONTROLLERS,
  providers: PROVIDERS_PROVIDERS,
  exports: [ProviderAccountsService, ProviderHealthService, ProviderOperationsService, PROVIDER_GATEWAY],
})
export class ProvidersModule {}
