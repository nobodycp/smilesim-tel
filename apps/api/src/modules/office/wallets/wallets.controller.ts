import { ApiZodBody } from '../../../openapi/body';
import { CeilingBody, DeductBody, FundBody } from './wallets.schemas';
import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, param } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { text } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { summaryDays } from './finance-summary';
import { WalletsService } from './wallets.service';
import type { Response } from 'express';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class WalletsController {
  constructor(private readonly walletDesk: WalletsService) {}

  @Get('wallets')
  @ApiOperation({ summary: 'One page of the wallets visible to the session ({ items, nextCursor, total })' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiErrorResponse(400, 401, 403)
  wallets(@Actor() actor: ActorShape, @Query('cursor') cursor?: string) {
    return this.walletDesk.list(actor, text(cursor));
  }

  @Post('wallets/:loginName/deduct')
  @ApiOperation({ summary: 'Take money back from a child: return, correction or settlement (note required)' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(DeductBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('deduct', 'account', param('loginName'))
  deduct(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: DeductBody,
  ) {
    return this.walletDesk.deduct(actor, loginName, body);
  }

  @Post('wallets/:loginName/fund')
  @ApiOperation({ summary: 'Fund a wallet (note required)' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(FundBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('fund', 'account', param('loginName'))
  fund(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: FundBody,
  ) {
    return this.walletDesk.fund(actor, loginName, body);
  }

  @Patch('wallets/:loginName/ceiling')
  @Activity('ceiling', 'account', param('loginName'))
  @ApiOperation({ summary: 'Set wallet overdraft ceiling' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(CeilingBody)
  @ApiErrorResponse(401, 403, 400, 404)
  ceiling(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: CeilingBody,
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
    @Query('match') match?: string,
  ) {
    return this.walletDesk.providerOperations(actor, {
      match: text(match),
      cursor: text(cursor),
      kind: text(kind),
      provider: text(provider),
      q: text(q),
      from: text(from),
      to: text(to),
    });
  }

  @Get('finance/summary')
  @ApiOperation({ summary: "The signed-in account's wallet over the last 7, 30 (default) or 90 days (cards and chart)" })
  @ApiErrorResponse(401, 403)
  financeSummary(@Actor() actor: ActorShape, @Query('days') days?: string) {
    return this.walletDesk.financeSummary(actor, new Date(), summaryDays(text(days)));
  }

  @Get('finance/export')
  @ApiOperation({ summary: 'The financial movements with the same filters, as CSV (at most 10,000 rows)' })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'layer', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'scope', required: false })
  @ApiErrorResponse(401, 403)
  async financeExport(
    @Res({ passthrough: true }) res: Response,
    @Actor() actor: ActorShape,
    @Query('kind') kind?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope?: string,
  ) {
    const csv = await this.walletDesk.financeCsv(actor, { kind: text(kind), layer: text(layer), q: text(q), from: text(from), to: text(to), scope: text(scope) });
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
  @ApiQuery({ name: 'scope', required: false, description: '`money` keeps the money movements, `operations` the line operations; every entry otherwise' })
  @ApiErrorResponse(401, 403)
  finance(
    @Actor() actor: ActorShape,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope?: string,
  ) {
    return this.walletDesk.finance(actor, {
      cursor: text(cursor),
      kind: text(kind),
      layer: text(layer),
      q: text(q),
      from: text(from),
      to: text(to),
      scope: text(scope),
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
