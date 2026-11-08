import { Body, Controller, Get, Param, Post, Query, Req, UseFilters, UseInterceptors } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorResponse } from '../../openapi/responses';
import { Activity, bodyField, param } from './activity.decorator';
import { ActivityInterceptor } from './activity.interceptor';
import { gateOf } from './gate';
import { freeFormObject } from './kernel/query';
import { OfficeFailureFilter } from '../shared/office-failure.filter';
import { OfficeService } from './office.service';
import {
  ExtendBodyDto,
  OutcomeBodyDto,
  RenameLineBodyDto,
  SwapSimBodyDto,
  CompleteTaskBodyDto,
  SwitchPackageBodyDto,
} from './office.dto';

/** A query value is a string or nothing; a repeated or nested one is ignored. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor)
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  @Get('lines')
  @ApiOperation({ summary: 'Paged lines / SIMs' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'packageCode', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'company', required: false })
  @ApiErrorResponse(401, 403)
  lines(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('packageCode') packageCode?: string,
    @Query('provider') provider?: string,
    @Query('company') company?: string,
  ) {
    return this.office.lines(gateOf(req), {
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
  line(@Req() req: Request, @Param('id') id: string) {
    return this.office.line(gateOf(req), id);
  }

  @Post('lines')
  @ApiOperation({ summary: 'Activate a new line' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400)
  @Activity('activate', 'line', bodyField('msisdn'))
  activate(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.office.activate(gateOf(req), body);
  }

  @Post('lines/:id/company-switch')
  @ApiOperation({ summary: 'Switch the carrier. Fields are not defined yet, so the request is rejected.' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('company_switch', 'line', param('id'))
  companySwitch() {
    return this.office.companySwitch();
  }

  @Post('lines/:id/charge')
  @ApiOperation({ summary: 'Charge / top-up a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('charge', 'line', param('id'))
  charge(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.operate(gateOf(req), id, 'charge', body);
  }

  @Post('lines/:id/refresh')
  @ApiOperation({ summary: 'Update a line without changing its fields' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('refresh', 'line', param('id'))
  refresh(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.refreshLine(gateOf(req), id, body);
  }

  @Get('lines/:id/disconnect-quote')
  @ApiOperation({ summary: 'What a disconnect would return to the point of sale now, and whether it runs at once' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  disconnectQuote(@Req() req: Request, @Param('id') id: string) {
    return this.office.disconnectQuote(gateOf(req), id);
  }

  @Post('lines/:id/disconnect')
  @ApiOperation({ summary: 'Disconnect a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('disconnect', 'line', param('id'))
  disconnect(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.operate(gateOf(req), id, 'disconnect', body);
  }

  @Post('lines/:id/unfreeze')
  @ApiOperation({ summary: 'Unfreeze a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('unfreeze', 'line', param('id'))
  unfreeze(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.operate(gateOf(req), id, 'unfreeze', body);
  }

  @Post('lines/:id/freeze')
  @ApiOperation({ summary: 'Freeze a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('freeze', 'line', param('id'))
  freeze(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.operate(gateOf(req), id, 'freeze', body);
  }

  @Post('lines/:id/extend')
  @ApiOperation({ summary: 'Extend a line subscription' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: ExtendBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('extend', 'line', param('id'))
  extend(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ExtendBodyDto,
  ) {
    return this.office.extend(gateOf(req), id, body);
  }

  @Post('lines/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('reactivate', 'line', param('id'))
  reactivate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.reactivate(gateOf(req), id, body);
  }

  @Post('lines/:id/rename')
  @ApiOperation({ summary: 'Rename / change MSISDN on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: RenameLineBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('rename', 'line', param('id'))
  rename(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RenameLineBodyDto,
  ) {
    return this.office.renameLine(gateOf(req), id, body);
  }

  @Post('lines/:id/esim')
  @ApiOperation({ summary: 'Request an eSIM for a line; always a branch task priced from the company, provider, or package' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('esim', 'line', param('id'))
  requestEsim(@Req() req: Request, @Param('id') id: string) {
    return this.office.requestEsim(gateOf(req), id);
  }

  @Post('lines/:id/sim')
  @ApiOperation({ summary: 'Swap to a SIM the branch already holds (physical or eSIM); free' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwapSimBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('sim', 'line', param('id'))
  swapSim(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SwapSimBodyDto,
  ) {
    return this.office.swapSim(gateOf(req), id, body);
  }

  @Post('lines/:id/switch')
  @ApiOperation({ summary: 'Switch package on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwitchPackageBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('switch', 'line', param('id'))
  switchPackage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SwitchPackageBodyDto,
  ) {
    return this.office.switchPackage(gateOf(req), id, body);
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Complete a task; an eSIM request takes the serial and QR, a number change takes the new number' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: CompleteTaskBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('task_complete', 'task', param('id'))
  complete(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CompleteTaskBodyDto,
  ) {
    return this.office.completeTask(gateOf(req), id, body);
  }

  @Get('reports/:kind')
  @ApiOperation({ summary: 'Report by kind (branch-gated kinds exist)' })
  @ApiParam({ name: 'kind' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiErrorResponse(401, 403)
  report(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.office.report(gateOf(req), kind, text(cursor));
  }

}
