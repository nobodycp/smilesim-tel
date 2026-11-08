import { Body, Controller, Delete, Get, Param, Patch, Put, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { Activity, param } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { freeFormObject } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { PackageTargetsBodyDto, SellPriceBodyDto } from '../office.dto';
import { PackagesService } from './packages.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class PackagesController {
  constructor(private readonly packageDesk: PackagesService) {}

  @Get('packages')
  @ApiOperation({ summary: 'Package catalogue for the door' })
  @ApiErrorResponse(401, 403)
  packages(@Actor() actor: ActorShape) {
    return this.packageDesk.list(actor);
  }

  @Get('packages/:code/sheet')
  @ApiOperation({ summary: 'Package pricing / chain sheet' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  packageSheet(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.packageDesk.sheet(actor, code);
  }

  @Patch('packages/:code/details')
  @ApiOperation({ summary: 'Set package details: GB, minutes, messages (null not stated, -1 unlimited) and extra text' })
  @ApiParam({ name: 'code' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_details', 'package', param('code'))
  packageDetails(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: Record<string, unknown>) {
    return this.packageDesk.setDetails(actor, code, body);
  }

  @Patch('packages/:code/chain')
  @ApiOperation({ summary: 'Update package price chain' })
  @ApiParam({ name: 'code' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_chain', 'package', param('code'))
  packageChain(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.packageDesk.setChain(actor, code, body);
  }

  @Put('packages/:code/renewals')
  @ApiOperation({ summary: 'Set renewal targets for a package' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: PackageTargetsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  packageRenewals(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: PackageTargetsBodyDto,
  ) {
    return this.packageDesk.setTargets(actor, code, 'renewals', body);
  }

  @Put('packages/:code/switches')
  @ApiOperation({ summary: 'Set switch targets for a package' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: PackageTargetsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  packageSwitches(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: PackageTargetsBodyDto,
  ) {
    return this.packageDesk.setTargets(actor, code, 'switches', body);
  }

  @Patch('packages/:code/mode')
  @ApiOperation({ summary: 'Set package sale/visibility mode flags' })
  @ApiParam({ name: 'code' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_mode', 'package', param('code'))
  packageMode(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.packageDesk.setMode(actor, code, body);
  }

  @Put('sell-prices/:code')
  @ApiOperation({ summary: "Set the caller's own sell price for a package (main agent or agent)" })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: SellPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('sell_price', 'package', param('code'))
  setSellPrice(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: SellPriceBodyDto,
  ) {
    return this.packageDesk.setSellPrice(actor, code, body);
  }

  @Delete('sell-prices/:code')
  @ApiOperation({ summary: "Clear the caller's own sell price for a package; the layer column applies again" })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('sell_price', 'package', param('code'))
  clearSellPrice(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.packageDesk.clearSellPrice(actor, code);
  }
}
