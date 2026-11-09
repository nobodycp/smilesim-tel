import { Body, Controller, Get, Param, Post, Query, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { Activity, bodyField, param } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { freeFormObject, text } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { CompleteTaskBodyDto, ExtendBodyDto, OutcomeBodyDto, RenameLineBodyDto, SwapSimBodyDto, SwitchPackageBodyDto } from '../office.dto';
import { LineReads } from './line-reads';
import { LinesService } from './lines.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class LinesController {
  constructor(private readonly lineDesk: LinesService, private readonly reads: LineReads) {}

  @Get('lines')
  @ApiOperation({ summary: 'Paged lines / SIMs' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'packageCode', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'company', required: false })
  @ApiQuery({ name: 'account', required: false, description: "One account's numbers: its own, or every point of sale below it" })
  @ApiErrorResponse(401, 403)
  lines(
    @Actor() actor: ActorShape,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('packageCode') packageCode?: string,
    @Query('provider') provider?: string,
    @Query('company') company?: string,
    @Query('account') account?: string,
  ) {
    return this.reads.list(actor, {
      account: text(account),
      cursor: text(cursor),
      q: text(q),
      status: text(status),
      packageCode: text(packageCode),
      provider: text(provider),
      company: text(company),
    });
  }

  @Get('lines/:id')
  @ApiOperation({ summary: 'Single line detail' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  line(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.reads.detail(actor, id);
  }

  @Post('lines')
  @ApiOperation({ summary: 'Activate a new line' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400)
  @Activity('activate', 'line', bodyField('msisdn'))
  activate(@Actor() actor: ActorShape, @Body() body: Record<string, unknown>) {
    return this.lineDesk.activate(actor, body);
  }

  @Post('lines/:id/charge')
  @ApiOperation({ summary: 'Charge / top-up a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('charge', 'line', param('id'))
  charge(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.lineDesk.operate(actor, id, 'charge', body);
  }

  @Post('lines/:id/refresh')
  @ApiOperation({ summary: 'Update a line without changing its fields' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('refresh', 'line', param('id'))
  refresh(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.lineDesk.refresh(actor, id, body);
  }

  @Get('lines/:id/disconnect-quote')
  @ApiOperation({ summary: 'What a disconnect would return to the point of sale now, and whether it runs at once' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  disconnectQuote(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.lineDesk.disconnectQuote(actor, id);
  }

  @Post('lines/:id/disconnect')
  @ApiOperation({ summary: 'Disconnect a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('disconnect', 'line', param('id'))
  disconnect(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.lineDesk.operate(actor, id, 'disconnect', body);
  }

  @Post('lines/:id/unfreeze')
  @ApiOperation({ summary: 'Unfreeze a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('unfreeze', 'line', param('id'))
  unfreeze(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.lineDesk.operate(actor, id, 'unfreeze', body);
  }

  @Post('lines/:id/freeze')
  @ApiOperation({ summary: 'Freeze a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('freeze', 'line', param('id'))
  freeze(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.lineDesk.operate(actor, id, 'freeze', body);
  }

  @Post('lines/:id/extend')
  @ApiOperation({ summary: 'Extend a line subscription' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: ExtendBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('extend', 'line', param('id'))
  extend(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: ExtendBodyDto,
  ) {
    return this.lineDesk.extend(actor, id, body);
  }

  @Post('lines/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('reactivate', 'line', param('id'))
  reactivate(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.lineDesk.reactivate(actor, id, body);
  }

  @Post('lines/:id/rename')
  @ApiOperation({ summary: 'Rename / change MSISDN on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: RenameLineBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('rename', 'line', param('id'))
  rename(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: RenameLineBodyDto,
  ) {
    return this.lineDesk.rename(actor, id, body);
  }

  @Post('lines/:id/esim')
  @ApiOperation({ summary: 'Request an eSIM for a line; always a branch task priced from the company, provider, or package' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('esim', 'line', param('id'))
  requestEsim(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.lineDesk.requestEsim(actor, id);
  }

  @Post('lines/:id/addon')
  @ApiOperation({ summary: "Request one of the package's extra operations; always a manual branch task holding its price" })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('addon', 'line', param('id'))
  requestAddon(@Actor() actor: ActorShape, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.lineDesk.requestAddon(actor, id, body ?? {});
  }

  @Post('lines/:id/sim')
  @ApiOperation({ summary: 'Swap to a SIM the branch already holds (physical or eSIM); free' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwapSimBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('sim', 'line', param('id'))
  swapSim(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: SwapSimBodyDto,
  ) {
    return this.lineDesk.swapSim(actor, id, body);
  }

  @Post('lines/:id/switch')
  @ApiOperation({ summary: 'Switch package on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwitchPackageBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('switch', 'line', param('id'))
  switchPackage(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: SwitchPackageBodyDto,
  ) {
    return this.lineDesk.switchPackage(actor, id, body);
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Complete a task; an eSIM request takes the serial and QR, a number change takes the new number' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: CompleteTaskBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('task_complete', 'task', param('id'))
  complete(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: CompleteTaskBodyDto,
  ) {
    return this.lineDesk.completeTask(actor, id, body);
  }

  @Post('lines/:id/company-switch')
  @ApiOperation({ summary: 'Switch the carrier. Fields are not defined yet, so the request is rejected.' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('company_switch', 'line', param('id'))
  companySwitch() {
    return this.lineDesk.companySwitch();
  }
}
