import { ApiErrorResponse, ApiZodQuery } from '../../platform';
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PictureQuery } from './pictures.schemas';
import { OfferPicturesService } from './offer-pictures.service';
import { sendPicture } from './send-picture';

/**
 * Offer pictures as bytes (speed plan PF.7). Public and read only, like `/branding/:kind`: no session, no actor, no
 * activity. Each answer is immutable for a year only under the current `?v=`, else `no-cache`, and carries the
 * version as its `ETag`, so a repeat without `?v=` is a `304`. A company's mark is the postpaid catalog's
 * (`postpaid/catalog/pictures/pictures.controller.ts`), under the same `/pictures` prefix.
 */
@ApiTags('catalog')
@Controller('pictures')
export class OfferPicturesController {
  constructor(private readonly pictures: OfferPicturesService) {}

  @Get('offers/:id')
  @ApiOperation({ summary: 'An offer picture as bytes (public; immutable for a year only under the current ?v=version)' })
  @ApiParam({ name: 'id' })
  @ApiZodQuery(PictureQuery)
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiErrorResponse(404)
  async offer(@Param('id') id: string, @Query() query: PictureQuery, @Res() res: Response) {
    sendPicture(res, await this.pictures.offerPicture(id), query);
  }
}
