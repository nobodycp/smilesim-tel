import { ApiZodQuery } from '../../../openapi/query';
import { ApiZodBody } from '../../../openapi/body';
import { CeilingBody, CursorQuery, DeductBody, FinanceQuery, FinanceSummaryQuery, FundBody, LedgerQuery, ProfitsQuery, ProviderOperationsQuery } from './wallets.schemas';
import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, param } from '../../shared/activity.decorator';
import { ActivityInterceptor } from '../../shared/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
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
  @ApiZodQuery(CursorQuery)
  @ApiErrorResponse(400, 401, 403)
  wallets(@Actor() actor: ActorShape, @Query() query: CursorQuery) {
    return this.walletDesk.list(actor, query);
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
  @ApiZodQuery(ProviderOperationsQuery)
  @ApiErrorResponse(400, 401, 403)
  providerOperations(@Actor() actor: ActorShape, @Query() query: ProviderOperationsQuery) {
    return this.walletDesk.providerOperations(actor, query);
  }

  @Get('finance/summary')
  @ApiOperation({ summary: "The signed-in account's wallet over the last 7, 30 (default) or 90 days (cards and chart)" })
  @ApiZodQuery(FinanceSummaryQuery)
  @ApiErrorResponse(400, 401, 403)
  financeSummary(@Actor() actor: ActorShape, @Query() query: FinanceSummaryQuery) {
    return this.walletDesk.financeSummary(actor, query);
  }

  @Get('finance/export')
  @ApiOperation({ summary: 'The financial movements with the same filters, as CSV (at most 10,000 rows)' })
  @ApiZodQuery(FinanceQuery)
  @ApiErrorResponse(400, 401, 403)
  async financeExport(@Res({ passthrough: true }) res: Response, @Actor() actor: ActorShape, @Query() query: FinanceQuery) {
    const csv = await this.walletDesk.financeCsv(actor, query);
    // Set only once the file exists: a refusal before it still answers as JSON.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="finance.csv"');
    return csv;
  }

  @Get('finance/profits')
  @ApiOperation({ summary: "The signed-in account's profit by package over a period" })
  @ApiZodQuery(ProfitsQuery)
  @ApiErrorResponse(400, 401, 403)
  profits(@Actor() actor: ActorShape, @Query() query: ProfitsQuery) {
    return this.walletDesk.profitReport(actor, query);
  }

  @Get('finance/profits/export')
  @ApiOperation({ summary: 'The profit report as CSV' })
  @ApiZodQuery(ProfitsQuery)
  @ApiErrorResponse(400, 401, 403)
  async profitsExport(@Res({ passthrough: true }) res: Response, @Actor() actor: ActorShape, @Query() query: ProfitsQuery) {
    const csv = await this.walletDesk.profitCsv(actor, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="profits.csv"');
    return csv;
  }

  @Get('finance')
  @ApiOperation({ summary: 'Financial movements for the visible accounts (paged)' })
  @ApiZodQuery(FinanceQuery)
  @ApiErrorResponse(400, 401, 403)
  finance(@Actor() actor: ActorShape, @Query() query: FinanceQuery) {
    return this.walletDesk.finance(actor, query);
  }

  @Get('ledger')
  @ApiOperation({ summary: 'One page of the signed-in account\'s own wallet ledger ({ items, nextCursor, total })' })
  @ApiZodQuery(LedgerQuery)
  @ApiErrorResponse(400, 401, 403)
  ledger(@Actor() actor: ActorShape, @Query() query: LedgerQuery) {
    return this.walletDesk.ledger(actor, query);
  }
}
