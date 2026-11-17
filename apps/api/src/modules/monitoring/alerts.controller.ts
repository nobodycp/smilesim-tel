import { Controller, Delete, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Activity, ActivityInterceptor, ApiErrorResponse, ApiZodQuery, NoActivity, RESOURCE_CONTROLLER_PREFIXES, answerField } from '../platform';
import { Actor, ActorInterceptor } from '../access';
import type { Actor as ActorShape } from '../access';
import { AlertsQuery } from './alerts.schemas';
import { AlertsService } from './alerts.service';

/** The early warnings: read, marked seen and cleared by the branch owner alone (spec 2026-11-17-system-monitor, section 4, D1). */
@ApiTags('monitoring')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('system/alerts')
  @ApiOperation({ summary: 'Alerts: open first, then closed, newest first (paged); each with the request-log filters behind it' })
  @ApiZodQuery(AlertsQuery)
  @ApiErrorResponse(400, 401, 403)
  list(@Actor() actor: ActorShape, @Query() query: AlertsQuery) {
    return this.alerts.list(actor, query);
  }

  @Post('system/alerts/:id/seen')
  @HttpCode(200)
  @NoActivity('an acknowledgement, not a change: the alert itself keeps who saw it and when (seenByLoginName, seenAt), and nothing is removed')
  @ApiOperation({ summary: 'Mark an alert seen: it leaves the open count of /v1/me; an open one stays open' })
  @ApiErrorResponse(401, 403, 404)
  seen(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.alerts.markSeen(actor, id);
  }

  @Delete('system/alerts')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete the closed alerts (never an open one); recorded in the activity log with the number removed' })
  @ApiErrorResponse(401, 403)
  @Activity('alert_clear', 'alerts', undefined, answerField('removed'))
  clear(@Actor() actor: ActorShape) {
    return this.alerts.clear(actor);
  }
}
