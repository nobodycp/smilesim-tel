import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ActivityInterceptor, ApiErrorResponse, RESOURCE_CONTROLLER_PREFIXES } from '../platform';
import { Actor, ActorInterceptor } from '../access';
import type { Actor as ActorShape } from '../access';
import { StatusService } from './status.service';

/** The system status: read by the branch owner alone (spec 2026-11-17-system-monitor, section 1, D1). */
@ApiTags('monitoring')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class StatusController {
  constructor(private readonly statusOf: StatusService) {}

  @Get('system/status')
  @ApiOperation({ summary: 'System status: the nine parts, each ok, warn or down with its figures' })
  @ApiErrorResponse(401, 403)
  status(@Actor() actor: ActorShape) {
    return this.statusOf.status(actor);
  }
}
