import { OffersRepository } from './offers.repository';
import { AccessModule } from '../../access/access.module';
import { PlatformModule } from '../../platform/platform.module';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';
import { Module } from '@nestjs/common';

/** The offers shown on the home page. */
export const OFFERS_CONTROLLERS = [OffersController];
export const OFFERS_PROVIDERS = [OffersRepository, OffersService];

@Module({
  imports: [PlatformModule, AccessModule],
  controllers: OFFERS_CONTROLLERS,
  providers: OFFERS_PROVIDERS,
  exports: [],
})
export class OffersModule {}
