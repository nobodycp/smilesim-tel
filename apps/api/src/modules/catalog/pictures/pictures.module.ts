import { PicturesRepository } from './pictures.repository';
import { PlatformModule } from '../../platform';
import { PicturesController } from './pictures.controller';
import { PicturesService } from './pictures.service';
import { Module } from '@nestjs/common';

/** The public picture routes: a company's mark and an offer's picture by URL (speed plan PF.7). */
export const PICTURES_CONTROLLERS = [PicturesController];
export const PICTURES_PROVIDERS = [PicturesRepository, PicturesService];

@Module({
  imports: [PlatformModule],
  controllers: PICTURES_CONTROLLERS,
  providers: PICTURES_PROVIDERS,
  exports: [],
})
export class PicturesModule {}
