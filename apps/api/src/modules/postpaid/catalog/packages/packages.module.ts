import { PackagesRepository } from './packages.repository';
import { AccessModule } from '../../../access';
import { PlatformModule } from '../../../platform';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { Module } from '@nestjs/common';

/** The package catalog: the sheet, the price chain, modes, details, renewal and switch targets, add-ons (the priced shelf and the sell prices are pricing's, slice R.8). */
export const PACKAGES_CONTROLLERS = [PackagesController];
export const PACKAGES_PROVIDERS = [PackagesRepository, PackagesService];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: PACKAGES_CONTROLLERS,
  providers: PACKAGES_PROVIDERS,
  exports: [],
})
export class PackagesModule {}
