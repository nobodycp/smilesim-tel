import { PeriodQuery } from '../../shared/schemas';
import { CursorQuery } from '../wallets/wallets.schemas';
import { BalancesQuery } from './reports.schemas';
import { ApiZodQuery } from '../../../openapi/query';
import { Controller, Get, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { InsightsService } from './insights.service';
import { ReportsService } from './reports.service';

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
  @ApiZodQuery(BalancesQuery)
  @ApiErrorResponse(400, 401, 403)
  balances(@Actor() actor: ActorShape, @Query() query: BalancesQuery) {
    return this.insights.balances(actor, query);
  }

  @Get('reports/supply')
  @ApiOperation({ summary: 'Per provider over the dates: operations, cost and branch profit (branch, reports grant)' })
  @ApiZodQuery(PeriodQuery)
  @ApiErrorResponse(400, 401, 403)
  supply(@Actor() actor: ActorShape, @Query() query: PeriodQuery) {
    return this.insights.supply(actor, query);
  }

  @Get('reports/balances/export')
  @ApiOperation({ summary: 'The balances report as CSV, with the same filters' })
  @ApiZodQuery(BalancesQuery)
  @ApiErrorResponse(400, 401, 403)
  async balancesExport(@Res({ passthrough: true }) res: Response, @Actor() actor: ActorShape, @Query() query: BalancesQuery) {
    return this.csv(res, 'balances', await this.insights.balancesCsv(actor, query));
  }

  @Get('reports/supply/export')
  @ApiOperation({ summary: 'The providers report over the dates as CSV' })
  @ApiZodQuery(PeriodQuery)
  @ApiErrorResponse(400, 401, 403)
  async supplyExport(@Res({ passthrough: true }) res: Response, @Actor() actor: ActorShape, @Query() query: PeriodQuery) {
    return this.csv(res, 'supply', await this.insights.supplyCsv(actor, query));
  }

  @Get('reports/providers')
  @ApiOperation({ summary: 'Every package by provider with its cost and its numbers ({ items, nextCursor, total }; branch, reports grant)' })
  @ApiErrorResponse(401, 403)
  providers(@Actor() actor: ActorShape) {
    return this.reports.providers(actor);
  }

  @Get('reports/operations')
  @ApiOperation({ summary: 'One page of the provider operations ledger ({ items, nextCursor, total }; branch, reports grant)' })
  @ApiZodQuery(CursorQuery)
  @ApiErrorResponse(400, 401, 403)
  operations(@Actor() actor: ActorShape, @Query() query: CursorQuery) {
    return this.reports.operations(actor, query);
  }

  private csv(res: Response, name: string, csv: string) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return csv;
  }
}
