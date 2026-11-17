import { Controller, Get, HttpCode, Post, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ActivityInterceptor, ApiErrorResponse, NoActivity, RESOURCE_CONTROLLER_PREFIXES } from '../platform';
import { Actor, ActorInterceptor } from '../access';
import type { Actor as ActorShape } from '../access';
import { VersionsService } from './versions.service';

/** The versions page: read, and checked now, by the branch owner alone (spec 2026-11-17-system-monitor, section 5, D1). */
@ApiTags('monitoring')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class VersionsController {
  constructor(private readonly versionsOf: VersionsService) {}

  @Get('system/versions')
  @ApiOperation({ summary: 'Versions: each component in use and the newest published, how far behind, and its support' })
  @ApiErrorResponse(401, 403)
  versions(@Actor() actor: ActorShape) {
    return this.versionsOf.versions(actor);
  }

  @Post('system/versions/check')
  @HttpCode(200)
  @NoActivity('asks the npm registry and endoflife.date for the newest versions and stores their answer: no account, line, money or setting changes, and each component keeps when it was checked (checkedAt)')
  @ApiOperation({ summary: 'Check the newest versions now (429 within a minute of the last check); answers the page' })
  @ApiErrorResponse(401, 403, 429)
  check(@Actor() actor: ActorShape) {
    return this.versionsOf.check(actor);
  }
}
