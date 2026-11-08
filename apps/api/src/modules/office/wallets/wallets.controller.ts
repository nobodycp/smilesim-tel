import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { Activity, param } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { text } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { CeilingBodyDto, FundBodyDto } from '../office.dto';
import { WalletsService } from './wallets.service';
import type { Response } from 'express';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class WalletsController {
  constructor(private readonly walletDesk: WalletsService) {}

  @Get('wallets')
  @ApiOperation({ summary: 'List wallets visible to the session' })
  @ApiErrorResponse(401, 403)
  wallets(@Actor() actor: ActorShape) {
    return this.walletDesk.list(actor);
  }

  @Post('wallets/:loginName/fund')
  @ApiOperation({ summary: 'Fund a wallet (note required)' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: FundBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('fund', 'account', param('loginName'))
  fund(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: FundBodyDto,
  ) {
    return this.walletDesk.fund(actor, loginName, body);
  }

  @Patch('wallets/:loginName/ceiling')
  @ApiOperation({ summary: 'Set wallet overdraft ceiling' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: CeilingBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  ceiling(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: CeilingBodyDto,
  ) {
    return this.walletDesk.setCeiling(actor, loginName, body);
  }

  @Get('provider-operations')
  @ApiOperation({ summary: 'Line operations with the branch cost at the provider (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiErrorResponse(401, 403)
  providerOperations(
    @Actor() actor: ActorShape,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: string,
    @Query('provider') provider?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.walletDesk.providerOperations(actor, {
      cursor: text(cursor),
      kind: text(kind),
      provider: text(provider),
      q: text(q),
      from: text(from),
      to: text(to),
    });
  }

  @Get('finance/summary')
  @ApiOperation({ summary: "The signed-in account's wallet over the last 30 days (cards and chart)" })
  @ApiErrorResponse(401, 403)
  financeSummary(@Actor() actor: ActorShape) {
    return this.walletDesk.financeSummary(actor);
  }

  @Get('finance/export')
  @ApiOperation({ summary: 'The financial movements with the same filters, as CSV (at most 10,000 rows)' })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'layer', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiErrorResponse(401, 403)
  async financeExport(
    @Res({ passthrough: true }) res: Response,
    @Actor() actor: ActorShape,
    @Query('kind') kind?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.walletDesk.financeCsv(actor, { kind: text(kind), layer: text(layer), q: text(q), from: text(from), to: text(to) });
    // Set only once the file exists: a refusal before it still answers as JSON.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="finance.csv"');
    return csv;
  }

  @Get('finance/profits')
  @ApiOperation({ summary: "The signed-in account's profit by package over a period" })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiErrorResponse(401, 403)
  profits(@Actor() actor: ActorShape, @Query('from') from?: string, @Query('to') to?: string, @Query('q') q?: string) {
    return this.walletDesk.profitReport(actor, { from: text(from), to: text(to), q: text(q) });
  }

  @Get('finance/profits/export')
  @ApiOperation({ summary: 'The profit report as CSV' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiErrorResponse(401, 403)
  async profitsExport(
    @Res({ passthrough: true }) res: Response,
    @Actor() actor: ActorShape,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    const csv = await this.walletDesk.profitCsv(actor, { from: text(from), to: text(to), q: text(q) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="profits.csv"');
    return csv;
  }

  @Get('finance')
  @ApiOperation({ summary: 'Financial movements for the visible accounts (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'layer', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiErrorResponse(401, 403)
  finance(
    @Actor() actor: ActorShape,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.walletDesk.finance(actor, {
      cursor: text(cursor),
      kind: text(kind),
      layer: text(layer),
      q: text(q),
      from: text(from),
      to: text(to),
    });
  }

  @Get('ledger/:scope')
  @ApiOperation({ summary: 'Ledger for a scope' })
  @ApiParam({ name: 'scope' })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'direction', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiErrorResponse(401, 403)
  ledger(
    @Actor() actor: ActorShape,
    @Param('scope') scope: string,
    @Query('kind') kind?: string,
    @Query('direction') direction?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.walletDesk.ledger(actor, scope, { kind, direction, from, to, cursor: text(cursor) });
  }
}
