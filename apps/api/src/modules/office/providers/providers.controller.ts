import { Body, Controller, Get, Param, Patch, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, param } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { ProviderEsimPriceBodyDto, ProviderModeBodyDto } from '../office.dto';
import { ProvidersService } from './providers.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class ProvidersController {
  constructor(private readonly providerDesk: ProvidersService) {}

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
  @ApiBody({ type: ProviderEsimPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_esim_price', 'provider', param('code'))
  setProviderEsimPrice(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: ProviderEsimPriceBodyDto,
  ) {
    return this.providerDesk.setEsimPrice(actor, code, body);
  }

  @Patch('providers/:code/settings')
  @ApiOperation({ summary: 'Set one provider default run mode; the packages that inherit that action follow' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: ProviderModeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_mode', 'provider', param('code'))
  setProviderMode(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: ProviderModeBodyDto,
  ) {
    return this.providerDesk.setMode(actor, code, body as Record<string, unknown>);
  }
}
