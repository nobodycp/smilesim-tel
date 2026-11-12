import { Body, Controller, Get, Param, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../openapi/body';
import { ApiZodQuery } from '../../../openapi/query';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, bodyField, param } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { ActivityRecorder } from '../activity/activity-recorder';
import { gateOf } from '../../shared/cookies';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { LineReads } from './line-reads';
import { ActivateBody, AddonBody, CompleteTaskBody, ExtendBody, OutcomeBody, LinesQuery, RenameLineBody, SwapSimBody, SwitchPackageBody } from './lines.schemas';
import { LinesService } from './lines.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class LinesController {
  constructor(private readonly lineDesk: LinesService, private readonly reads: LineReads, private readonly activity: ActivityRecorder) {}

  @Get('lines')
  @ApiOperation({ summary: 'Paged lines / SIMs' })
  @ApiZodQuery(LinesQuery)
  @ApiErrorResponse(400, 401, 403)
  lines(@Actor() actor: ActorShape, @Query() query: LinesQuery) {
    return this.reads.list(actor, query);
  }

  @Get('lines/:id')
  @ApiOperation({ summary: 'Single line detail' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  async line(@Actor() actor: ActorShape, @Param('id') id: string, @Req() req: Request) {
    const answer = await this.reads.detail(actor, id);
    // An eSIM code is leaving: the read is on record before the answer goes (ADR 0019, D17: `line.esim_read`).
    // The event names who, which line, when and from where; never the code. If it cannot be written, there is no answer.
    if (answer.line.esimQr) await this.activity.recordOfficeOrFail(gateOf(req), req.ip ?? '', { action: 'esim_read', subjectKind: 'line', subjectRef: id });
    return answer;
  }

  @Post('lines')
  @ApiOperation({ summary: 'Activate a new line' })
  @ApiZodBody(ActivateBody)
  @ApiErrorResponse(401, 403, 400)
  @Activity('activate', 'line', bodyField('msisdn'))
  activate(@Actor() actor: ActorShape, @Body() body: ActivateBody) {
    return this.lineDesk.activate(actor, body);
  }

  @Post('lines/:id/charge')
  @ApiOperation({ summary: 'Charge / top-up a line' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(OutcomeBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('charge', 'line', param('id'))
  charge(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBody,
  ) {
    return this.lineDesk.operate(actor, id, 'charge', body);
  }

  @Post('lines/:id/refresh')
  @ApiOperation({ summary: 'Update a line without changing its fields' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(OutcomeBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('refresh', 'line', param('id'))
  refresh(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBody,
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
  @ApiZodBody(OutcomeBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('disconnect', 'line', param('id'))
  disconnect(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBody,
  ) {
    return this.lineDesk.operate(actor, id, 'disconnect', body);
  }

  @Post('lines/:id/unfreeze')
  @ApiOperation({ summary: 'Unfreeze a line' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(OutcomeBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('unfreeze', 'line', param('id'))
  unfreeze(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBody,
  ) {
    return this.lineDesk.operate(actor, id, 'unfreeze', body);
  }

  @Post('lines/:id/freeze')
  @ApiOperation({ summary: 'Freeze a line' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(OutcomeBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('freeze', 'line', param('id'))
  freeze(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBody,
  ) {
    return this.lineDesk.operate(actor, id, 'freeze', body);
  }

  @Post('lines/:id/extend')
  @ApiOperation({ summary: 'Extend a line subscription' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(ExtendBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('extend', 'line', param('id'))
  extend(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: ExtendBody,
  ) {
    return this.lineDesk.extend(actor, id, body);
  }

  @Post('lines/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a line' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(OutcomeBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('reactivate', 'line', param('id'))
  reactivate(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: OutcomeBody,
  ) {
    return this.lineDesk.reactivate(actor, id, body);
  }

  @Post('lines/:id/rename')
  @ApiOperation({ summary: 'Rename / change MSISDN on a line' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(RenameLineBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('rename', 'line', param('id'))
  rename(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: RenameLineBody,
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
  @ApiZodBody(AddonBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('addon', 'line', param('id'))
  requestAddon(@Actor() actor: ActorShape, @Param('id') id: string, @Body() body: AddonBody) {
    return this.lineDesk.requestAddon(actor, id, body);
  }

  @Post('lines/:id/sim')
  @ApiOperation({ summary: 'Swap to a SIM the branch already holds (physical or eSIM); free' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(SwapSimBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('sim', 'line', param('id'))
  swapSim(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: SwapSimBody,
  ) {
    return this.lineDesk.swapSim(actor, id, body);
  }

  @Post('lines/:id/switch')
  @ApiOperation({ summary: 'Switch package on a line' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(SwitchPackageBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('switch', 'line', param('id'))
  switchPackage(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: SwitchPackageBody,
  ) {
    return this.lineDesk.switchPackage(actor, id, body);
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Complete a task; an eSIM request takes the serial and QR, a number change takes the new number' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(CompleteTaskBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('task_complete', 'task', param('id'))
  complete(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: CompleteTaskBody,
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
