import { PicturesRepository } from './pictures.repository';
import { PlatformModule } from '../../../platform';
import { PicturesController } from './pictures.controller';
import { PicturesService } from './pictures.service';
import { Module } from '@nestjs/common';

/** The public route of a company's mark by URL (speed plan PF.7); an offer's picture is the site's. */
export const PICTURES_CONTROLLERS = [PicturesController];
export const PICTURES_PROVIDERS = [PicturesRepository, PicturesService];

@Module({
  imports: [PlatformModule],
  controllers: PICTURES_CONTROLLERS,
  providers: PICTURES_PROVIDERS,
  exports: [],
})
export class PicturesModule {}
