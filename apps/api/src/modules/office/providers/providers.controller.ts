import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, param } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { ProviderDispatchService } from './dispatch/provider-dispatch.service';
import { ProviderCredentialBody, ProviderEsimPriceBody, ProviderModeBody } from './providers.schemas';
import { ProvidersService } from './providers.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class ProvidersController {
  constructor(private readonly providerDesk: ProvidersService, private readonly dispatch: ProviderDispatchService) {}

  // A provider's dispatch switch (ADR 0019, D18): the branch owner in a session of its own, and nobody else.

  @Get('providers/:code/dispatch')
  @ApiOperation({ summary: 'Where each condition of dispatching this provider stands on this deployment; never a credential' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  dispatchStatus(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.dispatch.status(actor, code);
  }

  @Post('providers/:code/dispatch/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve dispatching this provider on this deployment, for its target' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404, 409)
  @Activity('provider_dispatch_approve', 'provider', param('code'))
  approveDispatch(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.dispatch.approve(actor, code);
  }

  @Post('providers/:code/dispatch/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause dispatching this provider: nothing more is sent, new sales take the manual route' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('provider_dispatch_pause', 'provider', param('code'))
  pauseDispatch(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.dispatch.pause(actor, code);
  }

  @Post('providers/:code/dispatch/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lift the pause, once the conditions are judged again' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404, 409)
  @Activity('provider_dispatch_resume', 'provider', param('code'))
  resumeDispatch(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.dispatch.resume(actor, code);
  }

  @Put('providers/:code/dispatch/credential')
  @ApiOperation({ summary: 'Store or replace the provider credential for this deployment target; write-only' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(ProviderCredentialBody)
  @ApiErrorResponse(401, 403, 400, 404, 409)
  @Activity('provider_credential', 'provider', param('code'))
  saveCredential(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: ProviderCredentialBody) {
    return this.dispatch.saveCredential(actor, code, body);
  }

  @Get('providers')
  @ApiOperation({ summary: 'Provider list' })
  @ApiErrorResponse(401, 403)
  providers(@Actor() actor: ActorShape) {
    return this.providerDesk.list(actor);
  }

  @Get('providers/:code/settings')
  @ApiOperation({ summary: 'Provider settings including default run modes' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  providerSettings(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.providerDesk.settings(actor, code);
  }

  @Patch('providers/:code/esim-price')
  @ApiOperation({ summary: 'Set or clear the provider eSIM price override' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(ProviderEsimPriceBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_esim_price', 'provider', param('code'))
  setProviderEsimPrice(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: ProviderEsimPriceBody,
  ) {
    return this.providerDesk.setEsimPrice(actor, code, body);
  }

  @Patch('providers/:code/settings')
  @ApiOperation({ summary: 'Set one provider default run mode; the packages that inherit that action follow' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(ProviderModeBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_mode', 'provider', param('code'))
  setProviderMode(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: ProviderModeBody,
  ) {
    return this.providerDesk.setMode(actor, code, body);
  }
}
