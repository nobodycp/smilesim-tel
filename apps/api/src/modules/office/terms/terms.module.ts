import { TermsRepository } from './terms.repository';
import { KernelModule } from '../kernel/kernel.module';
import { PriceLadder } from './price-ladder';
import { TermsController } from './terms.controller';
import { TermsService } from './terms.service';
import { Module } from '@nestjs/common';

/** What each account pays and may do: custom prices, stops, line prices, the price ladder. */
export const TERMS_CONTROLLERS = [TermsController];
export const TERMS_PROVIDERS = [TermsRepository, TermsService, PriceLadder];

@Module({
  imports: [KernelModule],
  controllers: TERMS_CONTROLLERS,
  providers: TERMS_PROVIDERS,
  exports: [TermsService, PriceLadder],
})
export class TermsModule {}
