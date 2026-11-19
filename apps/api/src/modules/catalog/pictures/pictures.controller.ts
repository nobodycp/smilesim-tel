import { ApiErrorResponse, ApiZodQuery } from '../../platform';
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PictureQuery, sendPicture } from '../../site';
import { PicturesService } from './pictures.service';

/**
 * Company marks as bytes (speed plan PF.7). Public and read only, like `/branding/:kind`: no session, no actor, no
 * activity. Each answer is immutable for a year only under the current `?v=`, else `no-cache`, and carries the
 * version as its `ETag`, so a repeat without `?v=` is a `304`. An offer's picture is the site's
 * (`site/pictures/offer-pictures.controller.ts`), under the same `/pictures` prefix.
 */
@ApiTags('catalog')
@Controller('pictures')
export class PicturesController {
  constructor(private readonly pictures: PicturesService) {}

  @Get('postpaid/companies/:code')
  @ApiOperation({ summary: 'A company mark as bytes (public; immutable for a year only under the current ?v=version)' })
  @ApiParam({ name: 'code' })
  @ApiZodQuery(PictureQuery)
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiErrorResponse(404)
  async company(@Param('code') code: string, @Query() query: PictureQuery, @Res() res: Response) {
    sendPicture(res, await this.pictures.companyMark(code), query);
  }
}
