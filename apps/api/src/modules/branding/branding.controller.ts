import { gateOf } from '../shared/cookies';
import { Body, Controller, Get, Param, Put, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { errorBody } from '../../errors';
import { ApiErrorResponse } from '../../openapi/responses';
import { ActivityRecorder } from '../office/activity/activity-recorder';
import { ApiFailure } from '../shared/api-failure';
import { BrandingService, type ImageKind } from './branding.service';

export class BrandingBodyDto {
  @ApiPropertyOptional({ maxLength: 120 })
  siteName?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  tagline?: string;

  @ApiPropertyOptional({ description: 'data:image/png|webp;base64 URL, or null to clear', nullable: true })
  logo?: string | null;

  @ApiPropertyOptional({ description: 'Dark-theme copy of the logo, built by the browser', nullable: true })
  logoDark?: string | null;

  @ApiPropertyOptional({ description: 'Square data URL, or null to clear', nullable: true })
  favicon?: string | null;
}

const IMAGE_KINDS: readonly ImageKind[] = ['logo', 'logo-dark', 'favicon'];

@ApiTags('branding')
@Controller('branding')
export class BrandingController {
  constructor(
    private readonly branding: BrandingService,
    private readonly activity: ActivityRecorder,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Office identity: name, tagline, which images exist, version (public)' })
  summary() {
    return this.branding.summary();
  }

  @Get(':kind')
  @ApiOperation({ summary: 'One identity image as bytes (public, immutable by ?v=version)' })
  @ApiParam({ name: 'kind', enum: IMAGE_KINDS })
  @ApiErrorResponse(404)
  async image(@Param('kind') kind: string, @Res() res: Response) {
    if (!IMAGE_KINDS.includes(kind as ImageKind)) {
      res.status(404).json(errorBody('NOT_FOUND'));
      return;
    }
    const image = await this.branding.image(kind as ImageKind);
    if (!image) {
      res.status(404).json(errorBody('NOT_FOUND'));
      return;
    }
    res.setHeader('Content-Type', image.type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(image.bytes);
  }

  @Put()
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Replace the office identity (branch owner)' })
  @ApiBody({ type: BrandingBodyDto })
  @ApiErrorResponse(401, 403, 400)
  async save(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: BrandingBodyDto) {
    const gate = gateOf(req);
    const event = { action: 'site_branding' };
    try {
      const summary = await this.branding.save(gate, body);
      await this.activity.recordOffice(gate, req.ip ?? '', event, 'ok', '');
      return summary;
    } catch (error) {
      if (error instanceof ApiFailure) {
        await this.activity.recordOffice(gate, req.ip ?? '', event, 'fail', error.code);
        res.status(error.status);
        return { message: error.message, code: error.code };
      }
      throw error;
    }
  }
}
