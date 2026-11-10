import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, param } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { PackageAddonBody, PackageAddonUpdateBody, PackageChainBody, PackageDetailsBody, PackageModeBody, PackageTargetsBody, SellPriceBody } from './packages.schemas';
import { PackagesService } from './packages.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
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
  @ApiZodBody(PackageDetailsBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_details', 'package', param('code'))
  packageDetails(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: PackageDetailsBody) {
    return this.packageDesk.setDetails(actor, code, body);
  }

  @Get('packages/:code/addons')
  @ApiOperation({ summary: "A package's extra operations (branch)" })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  packageAddons(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.packageDesk.addons(actor, code);
  }

  @Post('packages/:code/addons')
  @ApiOperation({ summary: 'Add an extra operation to a package: name and price' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(PackageAddonBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_addon', 'package', param('code'))
  addPackageAddon(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: PackageAddonBody) {
    return this.packageDesk.saveAddon(actor, code, body);
  }

  @Patch('packages/:code/addons/:id')
  @ApiOperation({ summary: "Change a package's extra operation: name, price, on/off, position" })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(PackageAddonUpdateBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_addon', 'package', param('code'))
  savePackageAddon(@Actor() actor: ActorShape, @Param('code') code: string, @Param('id') id: string, @Body() body: PackageAddonUpdateBody) {
    return this.packageDesk.saveAddon(actor, code, body, id);
  }

  @Delete('packages/:code/addons/:id')
  @ApiOperation({ summary: "Delete a package's extra operation" })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('package_addon', 'package', param('code'))
  removePackageAddon(@Actor() actor: ActorShape, @Param('code') code: string, @Param('id') id: string) {
    return this.packageDesk.removeAddon(actor, code, id);
  }

  @Patch('packages/:code/chain')
  @ApiOperation({ summary: 'Update package price chain' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(PackageChainBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_chain', 'package', param('code'))
  packageChain(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: PackageChainBody,
  ) {
    return this.packageDesk.setChain(actor, code, body);
  }

  @Put('packages/:code/renewals')
  @Activity('package_renewals', 'package', param('code'))
  @ApiOperation({ summary: 'Set renewal targets for a package' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(PackageTargetsBody)
  @ApiErrorResponse(401, 403, 400, 404)
  packageRenewals(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: PackageTargetsBody,
  ) {
    return this.packageDesk.setTargets(actor, code, 'renewals', body);
  }

  @Put('packages/:code/switches')
  @Activity('package_switches', 'package', param('code'))
  @ApiOperation({ summary: 'Set switch targets for a package' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(PackageTargetsBody)
  @ApiErrorResponse(401, 403, 400, 404)
  packageSwitches(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: PackageTargetsBody,
  ) {
    return this.packageDesk.setTargets(actor, code, 'switches', body);
  }

  @Patch('packages/:code/mode')
  @ApiOperation({ summary: 'Set package sale/visibility mode flags' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(PackageModeBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_mode', 'package', param('code'))
  packageMode(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: PackageModeBody,
  ) {
    return this.packageDesk.setMode(actor, code, body);
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
