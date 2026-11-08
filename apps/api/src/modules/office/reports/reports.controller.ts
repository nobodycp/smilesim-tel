import { Controller, Get, Param, Query, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { text } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { ReportsService } from './reports.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/:kind')
  @ApiOperation({ summary: 'Report by kind (branch-gated kinds exist)' })
  @ApiParam({ name: 'kind' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiErrorResponse(401, 403)
  report(
    @Actor() actor: ActorShape,
    @Param('kind') kind: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.reports.report(actor, kind, text(cursor));
  }
}
