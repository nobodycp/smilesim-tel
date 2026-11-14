import { PeriodQuery } from '../../shared/schemas';
import { ApiZodQuery } from '../../../openapi/query';
import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, NoActivity, param } from '../../shared/activity.decorator';
import { ActivityInterceptor } from '../../shared/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { ProviderAccountsService } from './provider-accounts.service';
import { ProviderCreditBody, ProviderEntryBody, ProviderMatchingBody, ReconciliationBody, ReconciliationItemBody, StatementFileBody } from './providers.schemas';

/** Our account with each provider (spec 2026-11-08-provider-accounts). */
@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class ProviderAccountsController {
  constructor(private readonly accounts: ProviderAccountsService) {}

  @Get('provider-accounts')
  @ApiOperation({ summary: 'Our balance, credit, held and available money with every provider' })
  @ApiErrorResponse(401, 403)
  list(@Actor() actor: ActorShape) {
    return this.accounts.list(actor);
  }

  @Get('provider-accounts/:code')
  @ApiOperation({ summary: 'One provider: summary and ledger with the running balance' })
  @ApiParam({ name: 'code' })
  @ApiZodQuery(PeriodQuery)
  @ApiErrorResponse(400, 401, 403, 404)
  detail(@Actor() actor: ActorShape, @Param('code') code: string, @Query() query: PeriodQuery) {
    return this.accounts.detail(actor, code, query);
  }

  @Get('provider-accounts/:code/export')
  @ApiZodQuery(PeriodQuery)
  @ApiOperation({ summary: 'One provider ledger as CSV' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  async export(@Res({ passthrough: true }) res: Response, @Actor() actor: ActorShape, @Param('code') code: string, @Query() query: PeriodQuery) {
    const csv = await this.accounts.ledgerCsv(actor, code, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="provider-${code}.csv"`);
    return csv;
  }

  @Post('provider-accounts/:code/entries')
  @ApiOperation({ summary: 'Record a payment (positive) or a settlement (either sign) with a note' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(ProviderEntryBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_payment', 'provider', param('code'))
  addEntry(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: ProviderEntryBody) {
    return this.accounts.addEntry(actor, code, body);
  }

  @Patch('provider-accounts/:code/credit')
  @ApiOperation({ summary: 'Set how far we may owe this provider' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(ProviderCreditBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_credit', 'provider', param('code'))
  setCredit(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: ProviderCreditBody) {
    return this.accounts.setCredit(actor, code, body);
  }

  @Patch('provider-accounts/:code/matching')
  @ApiOperation({ summary: 'Set how this provider is matched: `api` at once or `statement` every N days (simulated for now)' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(ProviderMatchingBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_matching', 'provider', param('code'))
  setMatching(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: ProviderMatchingBody) {
    return this.accounts.setMatching(actor, code, body);
  }

  @Post('provider-accounts/:code/simulate-statement')
  @ApiOperation({ summary: 'Simulated statement match: covers every operation up to now (until real statements arrive)' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_statement', 'provider', param('code'))
  simulateStatement(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.accounts.simulateStatement(actor, code);
  }

  @Post('provider-accounts/:code/statements/preview')
  @NoActivity('reads a statement file and shows what it holds; nothing is stored')
  @ApiOperation({ summary: 'Read a statement file: its columns, a few rows, and the columns to use' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(StatementFileBody)
  @ApiErrorResponse(401, 403, 400, 404)
  preview(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: StatementFileBody) {
    return this.accounts.previewStatement(actor, code, body);
  }

  @Post('provider-accounts/:code/reconciliations')
  @ApiOperation({ summary: 'Compare a statement with our operations at this provider and save the run' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(ReconciliationBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_reconcile', 'provider', param('code'))
  reconcile(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: ReconciliationBody) {
    return this.accounts.runReconciliation(actor, code, body);
  }

  @Get('provider-accounts/:code/reconciliations')
  @ApiOperation({ summary: 'Earlier reconciliations with this provider' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  runs(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.accounts.reconciliations(actor, code);
  }

  @Get('reconciliations/:id')
  @ApiOperation({ summary: 'One reconciliation with its rows that did not match' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  run(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.accounts.reconciliation(actor, id);
  }

  @Patch('reconciliation-items/:id')
  @ApiOperation({ summary: 'Mark a difference handled (with a note) or open it again' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(ReconciliationItemBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_reconcile_item', 'provider', param('id'))
  updateItem(@Actor() actor: ActorShape, @Param('id') id: string, @Body() body: ReconciliationItemBody) {
    return this.accounts.updateItem(actor, id, body);
  }
}
