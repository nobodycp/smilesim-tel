import { OfferPicturesRepository } from './offer-pictures.repository';
import { PlatformModule } from '../../platform';
import { OfferPicturesController } from './offer-pictures.controller';
import { OfferPicturesService } from './offer-pictures.service';
import { Module } from '@nestjs/common';

/** The public route of an offer's picture by URL (speed plan PF.7). */
export const OFFER_PICTURES_CONTROLLERS = [OfferPicturesController];
export const OFFER_PICTURES_PROVIDERS = [OfferPicturesRepository, OfferPicturesService];

@Module({
  imports: [PlatformModule],
  controllers: OFFER_PICTURES_CONTROLLERS,
  providers: OFFER_PICTURES_PROVIDERS,
  exports: [],
})
export class OfferPicturesModule {}
