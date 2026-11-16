import { TermsRepository } from './terms.repository';
import { AccessModule } from '../access';
import { PlatformModule } from '../platform';
import { PriceLadder } from './price-ladder';
import { TermsController } from './terms.controller';
import { TermsService } from './terms.service';
import { PackageShelfController } from './package-shelf.controller';
import { PackageShelfService } from './package-shelf.service';
import { Module } from '@nestjs/common';

/** What each account pays and may do: custom prices, stops, line prices, the price ladder, and the priced shelf with the sell prices (slice R.8). */
export const TERMS_CONTROLLERS = [TermsController, PackageShelfController];
export const TERMS_PROVIDERS = [TermsRepository, TermsService, PriceLadder, PackageShelfService];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: TERMS_CONTROLLERS,
  providers: TERMS_PROVIDERS,
  exports: [TermsService, PriceLadder],
})
export class TermsModule {}
