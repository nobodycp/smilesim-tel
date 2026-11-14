import { TermsRepository } from './terms.repository';
import { AccessModule } from '../../access/access.module';
import { PlatformModule } from '../../platform/platform.module';
import { PriceLadder } from './price-ladder';
import { TermsController } from './terms.controller';
import { TermsService } from './terms.service';
import { Module } from '@nestjs/common';

/** What each account pays and may do: custom prices, stops, line prices, the price ladder. */
export const TERMS_CONTROLLERS = [TermsController];
export const TERMS_PROVIDERS = [TermsRepository, TermsService, PriceLadder];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: TERMS_CONTROLLERS,
  providers: TERMS_PROVIDERS,
  exports: [TermsService, PriceLadder],
})
export class TermsModule {}
