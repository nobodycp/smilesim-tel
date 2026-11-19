import { LinePricesQuery, CustomPriceBody, LinePricesBody, UserOpsBody, UserPackageBody, UserPackagesBulkBody } from './terms.schemas';
import { ApiZodQuery, ApiZodBody, ApiErrorResponse, Activity, param, ActivityInterceptor, RESOURCE_CONTROLLER_PREFIXES } from '../../platform';
import { Body, Controller, Delete, Get, Param, Put, Query, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Actor, ActorInterceptor } from '../../access';
import type { Actor as ActorShape } from '../../access';
import { TermsService } from './terms.service';

@ApiTags('pricing')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class TermsController {
  constructor(private readonly termDesk: TermsService) {}

  @Get('postpaid/packages/:code/custom-prices')
  @ApiOperation({ summary: 'Accounts whose price for this package differs from their default' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  customPrices(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.termDesk.customPrices(actor, code);
  }

  @Put('postpaid/packages/:code/custom-prices/:loginName')
  @ApiOperation({ summary: 'Set a special price for one account on this package' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(CustomPriceBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', (req) => `${param('loginName')(req)}:${param('code')(req)}`)
  setCustomPrice(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Param('loginName') loginName: string,
    @Body() body: CustomPriceBody,
  ) {
    return this.termDesk.setCustomPrice(actor, code, loginName, body);
  }

  @Delete('postpaid/packages/:code/custom-prices/:loginName')
  @ApiOperation({ summary: 'Return an account to the default price for this package' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('user_package', 'user', (req) => `${param('loginName')(req)}:${param('code')(req)}`)
  clearCustomPrice(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Param('loginName') loginName: string,
  ) {
    return this.termDesk.clearCustomPrice(actor, code, loginName);
  }

  @Get('postpaid/packages/:code/hidden-accounts')
  @ApiOperation({ summary: 'The accounts this package is hidden from by their own row, each with how many accounts sit under it (branch)' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  hiddenAccounts(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.termDesk.hiddenAccounts(actor, code);
  }

  @Get('postpaid/packages/:code/line-accounts')
  @ApiOperation({ summary: 'The points of sale that hold numbers on this package: how many, how many active, and their renewal price today (branch)' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  lineAccounts(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.termDesk.lineAccounts(actor, code);
  }

  @Get('postpaid/packages/:code/line-prices')
  @ApiOperation({ summary: 'The renewable numbers of this package grouped by the renewal price they carry' })
  @ApiParam({ name: 'code' })
  @ApiZodQuery(LinePricesQuery)
  @ApiErrorResponse(401, 403, 400, 404)
  linePrices(@Actor() actor: ActorShape, @Param('code') code: string, @Query() query: LinePricesQuery) {
    return this.termDesk.linePrices(actor, code, query);
  }

  @Put('postpaid/packages/:code/line-prices')
  @ApiOperation({ summary: 'Reprice the renewable numbers of this package, one price group at a time' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(LinePricesBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_reprice', 'package', param('code'))
  setLinePrices(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: LinePricesBody,
  ) {
    return this.termDesk.setLinePrices(actor, code, body);
  }

  @Get('postpaid/users/:loginName/packages')
  @ApiOperation({ summary: 'Packages as this account sees and pays for them' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  userPackages(@Actor() actor: ActorShape, @Param('loginName') loginName: string) {
    return this.termDesk.userPackages(actor, loginName);
  }

  @Put('postpaid/users/:loginName/packages')
  @ApiOperation({ summary: 'Hide or show several packages for this account' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(UserPackagesBulkBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', param('loginName'))
  setUserPackagesBulk(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: UserPackagesBulkBody,
  ) {
    return this.termDesk.setUserPackagesBulk(actor, loginName, body);
  }

  @Put('postpaid/users/:loginName/packages/:code')
  @ApiOperation({ summary: 'Hide, show, or price one package for this account' })
  @ApiParam({ name: 'loginName' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(UserPackageBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', (req) => `${param('loginName')(req)}:${param('code')(req)}`)
  setUserPackage(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Param('code') code: string,
    @Body() body: UserPackageBody,
  ) {
    return this.termDesk.setUserPackage(actor, loginName, code, body);
  }

  @Get('postpaid/users/:loginName/ops')
  @ApiOperation({ summary: 'Line operations stopped on this account, own and inherited' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  userOps(@Actor() actor: ActorShape, @Param('loginName') loginName: string) {
    return this.termDesk.userOps(actor, loginName);
  }

  @Put('postpaid/users/:loginName/ops')
  @ApiOperation({ summary: 'Set the line operations stopped on this account' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(UserOpsBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_ops', 'user', param('loginName'))
  setUserOps(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: UserOpsBody,
  ) {
    return this.termDesk.setUserOps(actor, loginName, body);
  }
}
