import { errorBody, parseInput, ApiErrorResponse, ApiZodQuery } from '../../platform';
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { imageCacheControl } from '../../branding/branding-rules';
import { PictureQuery } from './pictures.schemas';
import { PicturesService, type Picture } from './pictures.service';

/**
 * Company marks and offer pictures as bytes (speed plan PF.7). Public and read only, like `/branding/:kind`: no
 * session, no actor, no activity. Each answer is immutable for a year only under the current `?v=`, else
 * `no-cache`, and carries the version as its `ETag`, so a repeat without `?v=` is a `304`.
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
    send(res, await this.pictures.companyMark(code), query);
  }

  @Get('offers/:id')
  @ApiOperation({ summary: 'An offer picture as bytes (public; immutable for a year only under the current ?v=version)' })
  @ApiParam({ name: 'id' })
  @ApiZodQuery(PictureQuery)
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiErrorResponse(404)
  async offer(@Param('id') id: string, @Query() query: PictureQuery, @Res() res: Response) {
    send(res, await this.pictures.offerPicture(id), query);
  }
}

function send(res: Response, picture: Picture | null, query: PictureQuery) {
  if (!picture) {
    res.status(404).json(errorBody('NOT_FOUND'));
    return;
  }
  res.setHeader('Content-Type', picture.type);
  res.setHeader('Cache-Control', imageCacheControl(parseInput(PictureQuery, query).v, picture.version));
  res.setHeader('ETag', `"${picture.version}"`);
  res.send(picture.bytes);
}
