import { Controller, Get, Param, Query, Res, UseFilters, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { text } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { InsightsService } from './insights.service';
import { ReportsService } from './reports.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly insights: InsightsService,
  ) {}

  // The «التقارير» page (spec 2026-11-08-reports). Static paths, declared before `reports/:kind`, win over it.
  @Get('reports/balances')
  @ApiOperation({ summary: 'Wallets of the accounts under the signed-in account' })
  @ApiErrorResponse(401, 403)
  balances(@Actor() actor: ActorShape, @Query('q') q?: string, @Query('layer') layer?: string, @Query('negative') negative?: string) {
    return this.insights.balances(actor, { q: text(q), layer: text(layer), negative: text(negative) });
  }

  @Get('reports/supply')
  @ApiOperation({ summary: 'Per provider over the dates: operations, cost and branch profit (branch, reports grant)' })
  @ApiErrorResponse(401, 403)
  supply(@Actor() actor: ActorShape, @Query('from') from?: string, @Query('to') to?: string) {
    return this.insights.supply(actor, { from: text(from), to: text(to) });
  }

  @Get('reports/:kind/export')
  @ApiOperation({ summary: 'A report of the «التقارير» page as CSV, with the same filters' })
  @ApiParam({ name: 'kind' })
  @ApiErrorResponse(401, 403, 404)
  async export(
    @Res({ passthrough: true }) res: Response,
    @Actor() actor: ActorShape,
    @Param('kind') kind: string,
    @Query() query: Record<string, unknown>,
  ) {
    const filters = Object.fromEntries(['from', 'to', 'q', 'status', 'layer', 'negative', 'account', 'kind', 'action'].map((key) => [key, text(query[key])]));
    const csv = await this.insights.csv(actor, kind, filters);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`);
    return csv;
  }


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
