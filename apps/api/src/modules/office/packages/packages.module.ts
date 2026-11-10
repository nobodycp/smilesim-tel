import { KernelModule } from '../kernel/kernel.module';
import { TermsModule } from '../terms/terms.module';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { Module } from '@nestjs/common';

/** The package catalog: prices, modes, details, renewal and switch targets, add-ons. */
export const PACKAGES_CONTROLLERS = [PackagesController];
export const PACKAGES_PROVIDERS = [PackagesService];

@Module({
  imports: [KernelModule, TermsModule],
  controllers: PACKAGES_CONTROLLERS,
  providers: PACKAGES_PROVIDERS,
  exports: [],
})
export class PackagesModule {}
