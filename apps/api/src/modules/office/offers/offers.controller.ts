import { Body, Controller, Delete, Get, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, param } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { OfferBody, OfferMoveBody, OfferUpdateBody } from './offers.schemas';
import { OffersService } from './offers.service';

/** Offers on the home hero (spec 2026-11-09-offers-tasks-addons-wallet-esim, 1). */
@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get('offers/live')
  @ApiOperation({ summary: 'The offers the signed-in account sees on its home now, in order' })
  @ApiErrorResponse(401, 403)
  live(@Actor() actor: ActorShape) {
    return this.offers.live(actor);
  }

  @Get('offers')
  @ApiOperation({ summary: 'Every offer (branch owner or edit grant)' })
  @ApiErrorResponse(401, 403)
  list(@Actor() actor: ActorShape) {
    return this.offers.list(actor);
  }

  @Post('offers')
  @ApiOperation({ summary: 'Add an offer: title, text, picture (data URL), action, seconds, layers, dates' })
  @ApiZodBody(OfferBody)
  @ApiErrorResponse(401, 403, 400)
  @Activity('offer', 'offer', () => '')
  create(@Actor() actor: ActorShape, @Body() body: OfferBody) {
    return this.offers.save(actor, body);
  }

  @Patch('offers/:id')
  @ApiOperation({ summary: 'Change an offer, or switch it on or off' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(OfferUpdateBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('offer', 'offer', param('id'))
  update(@Actor() actor: ActorShape, @Param('id') id: string, @Body() body: OfferUpdateBody) {
    return this.offers.save(actor, body, id);
  }

  @Post('offers/:id/move')
  @ApiOperation({ summary: 'Move an offer one place up or down' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(OfferMoveBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('offer', 'offer', param('id'))
  move(@Actor() actor: ActorShape, @Param('id') id: string, @Body() body: OfferMoveBody) {
    return this.offers.move(actor, id, body);
  }

  @Delete('offers/:id')
  @ApiOperation({ summary: 'Delete an offer' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('offer', 'offer', param('id'))
  remove(@Actor() actor: ActorShape, @Param('id') id: string) {
    return this.offers.remove(actor, id);
  }
}
