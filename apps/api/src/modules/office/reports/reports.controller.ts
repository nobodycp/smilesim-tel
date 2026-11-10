import { Controller, Get, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { text } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { InsightsService } from './insights.service';
import { ReportsService } from './reports.service';

/** The filters a report's CSV export reads from the query, the same names as its page. */
const filtersOf = (query: Record<string, unknown>) =>
  Object.fromEntries(['from', 'to', 'q', 'layer', 'negative'].map((key) => [key, text(query[key])]));

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly insights: InsightsService,
  ) {}

  // The «التقارير» pages (spec 2026-11-08-reports): one fixed route a report, its CSV export beside it.
  @Get('reports/balances')
  @ApiOperation({ summary: 'Wallets of the accounts under the signed-in account' })
  @ApiErrorResponse(401, 403)
  balances(@Actor() actor: ActorShape, @Query('q') q?: string, @Query('layer') layer?: string, @Query('negative') negative?: string, @Query('cursor') cursor?: string) {
    return this.insights.balances(actor, { q: text(q), layer: text(layer), negative: text(negative), cursor: text(cursor) });
  }

  @Get('reports/supply')
  @ApiOperation({ summary: 'Per provider over the dates: operations, cost and branch profit (branch, reports grant)' })
  @ApiErrorResponse(401, 403)
  supply(@Actor() actor: ActorShape, @Query('from') from?: string, @Query('to') to?: string) {
    return this.insights.supply(actor, { from: text(from), to: text(to) });
  }

  @Get('reports/balances/export')
  @ApiOperation({ summary: 'The balances report as CSV, with the same filters' })
  @ApiErrorResponse(401, 403)
  async balancesExport(@Res({ passthrough: true }) res: Response, @Actor() actor: ActorShape, @Query() query: Record<string, unknown>) {
    return this.csv(res, 'balances', await this.insights.csv(actor, 'balances', filtersOf(query)));
  }

  @Get('reports/supply/export')
  @ApiOperation({ summary: 'The providers report over the dates as CSV' })
  @ApiErrorResponse(401, 403)
  async supplyExport(@Res({ passthrough: true }) res: Response, @Actor() actor: ActorShape, @Query() query: Record<string, unknown>) {
    return this.csv(res, 'supply', await this.insights.csv(actor, 'supply', filtersOf(query)));
  }

  @Get('reports/providers')
  @ApiOperation({ summary: 'Every package by provider with its cost and its numbers ({ items, nextCursor, total }; branch, reports grant)' })
  @ApiErrorResponse(401, 403)
  providers(@Actor() actor: ActorShape) {
    return this.reports.providers(actor);
  }

  @Get('reports/operations')
  @ApiOperation({ summary: 'One page of the provider operations ledger ({ items, nextCursor, total }; branch, reports grant)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiErrorResponse(400, 401, 403)
  operations(@Actor() actor: ActorShape, @Query('cursor') cursor?: string) {
    return this.reports.operations(actor, text(cursor));
  }

  private csv(res: Response, name: string, csv: string) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return csv;
  }
}
