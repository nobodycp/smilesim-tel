import { Controller, Delete, Get, HttpCode, Query, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Activity, ActivityInterceptor, ApiErrorResponse, ApiZodQuery, RESOURCE_CONTROLLER_PREFIXES, answerField } from '../platform';
import { Actor, ActorInterceptor } from '../access';
import type { Actor as ActorShape } from '../access';
import { RequestLogFilterQuery, RequestLogQuery } from './request-log.schemas';
import { RequestLogService } from './request-log.service';

/** The request log: read and cleared by the branch owner alone (spec 2026-11-17-system-monitor, D1, D5). */
@ApiTags('monitoring')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class RequestLogController {
  constructor(private readonly requests: RequestLogService) {}

  @Get('system/requests')
  @ApiOperation({ summary: 'Request log (paged, newest first)' })
  @ApiZodQuery(RequestLogQuery)
  @ApiErrorResponse(400, 401, 403)
  list(@Actor() actor: ActorShape, @Query() query: RequestLogQuery) {
    return this.requests.list(actor, query);
  }

  @Get('system/requests/summary')
  @ApiOperation({ summary: 'Request log figures under the same filters: count, error rate, slowest and busiest routes' })
  @ApiZodQuery(RequestLogFilterQuery)
  @ApiErrorResponse(400, 401, 403)
  summary(@Actor() actor: ActorShape, @Query() query: RequestLogFilterQuery) {
    return this.requests.summary(actor, query);
  }

  @Delete('system/requests')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the request log; recorded in the activity log with the number of rows removed' })
  @ApiErrorResponse(401, 403)
  @Activity('request_log_clear', 'request_log', undefined, answerField('removed'))
  clear(@Actor() actor: ActorShape) {
    return this.requests.clear(actor);
  }
}
