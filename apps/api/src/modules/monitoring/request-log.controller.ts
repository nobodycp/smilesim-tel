import { Controller, Delete, Get, HttpCode, Query, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Activity, ActivityInterceptor, ApiErrorResponse, ApiZodQuery, RESOURCE_CONTROLLER_PREFIXES, answerField } from '../platform';
import { Actor, ActorInterceptor } from '../access';
import type { Actor as ActorShape } from '../access';
import { RequestErrorsQuery, RequestLogFilterQuery, RequestLogQuery } from './request-log.schemas';
import { RequestLogService } from './request-log.service';

/** The request log and its server errors: read and cleared by the branch owner alone (spec 2026-11-17-system-monitor, D1, D5). */
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
  @ApiOperation({ summary: 'Clear the request log and its server errors; recorded in the activity log with the number of requests removed' })
  @ApiErrorResponse(401, 403)
  @Activity('request_log_clear', 'request_log', undefined, answerField('removed'))
  clear(@Actor() actor: ActorShape) {
    return this.requests.clear(actor);
  }
  @Get('system/errors')
  @ApiOperation({ summary: 'Server errors (5xx), grouped by route and message: count, first and last seen, the last request' })
  @ApiZodQuery(RequestErrorsQuery)
  @ApiErrorResponse(400, 401, 403)
  errors(@Actor() actor: ActorShape, @Query() query: RequestErrorsQuery) {
    return this.requests.errors(actor, query);
  }
  // The same action as the log's clearing (the errors are part of the log, D5); the subject says which was cleared.
  @Delete('system/errors')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the server errors alone; recorded in the activity log with the number removed' })
  @ApiErrorResponse(401, 403)
  @Activity('request_log_clear', 'request_errors', undefined, answerField('removed'))
  clearErrors(@Actor() actor: ActorShape) {
    return this.requests.clearErrors(actor);
  }
}
