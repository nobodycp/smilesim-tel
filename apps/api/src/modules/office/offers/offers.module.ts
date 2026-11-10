import { OffersRepository } from './offers.repository';
import { KernelModule } from '../kernel/kernel.module';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';
import { Module } from '@nestjs/common';

/** The offers shown on the home page. */
export const OFFERS_CONTROLLERS = [OffersController];
export const OFFERS_PROVIDERS = [OffersRepository, OffersService];

@Module({
  imports: [KernelModule],
  controllers: OFFERS_CONTROLLERS,
  providers: OFFERS_PROVIDERS,
  exports: [],
})
export class OffersModule {}
