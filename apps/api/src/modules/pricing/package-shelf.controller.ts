import { Body, Controller, Delete, Get, Param, Put, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../openapi/body';
import { ApiErrorResponse } from '../../openapi/responses';
import { Activity, param } from '../platform/activity.decorator';
import { ActivityInterceptor } from '../platform/activity.interceptor';
import { Actor, ActorInterceptor } from '../access/actor.interceptor';
import type { Actor as ActorShape } from '../access/types';
import { SellPriceBody } from '../catalog/packages/packages.schemas';
import { PackageShelfService } from './package-shelf.service';

@ApiTags('pricing')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class PackageShelfController {
  constructor(private readonly shelf: PackageShelfService) {}

  // Slice R.8: from `PackagesController`, the same paths, decorators and answers.
  @Get('packages')
  @ApiOperation({ summary: 'Package catalogue for the door' })
  @ApiErrorResponse(401, 403)
  packages(@Actor() actor: ActorShape) {
    return this.shelf.list(actor);
  }

  @Put('sell-prices/:code')
  @ApiOperation({ summary: "Set the caller's own sell price for a package (main agent or agent)" })
  @ApiParam({ name: 'code' })
  @ApiZodBody(SellPriceBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('sell_price', 'package', param('code'))
  setSellPrice(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: SellPriceBody,
  ) {
    return this.shelf.setSellPrice(actor, code, body);
  }

  @Delete('sell-prices/:code')
  @ApiOperation({ summary: "Clear the caller's own sell price for a package; the layer column applies again" })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('sell_price', 'package', param('code'))
  clearSellPrice(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.shelf.clearSellPrice(actor, code);
  }
}
