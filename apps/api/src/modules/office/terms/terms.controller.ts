import { Body, Controller, Delete, Get, Param, Put, Query, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { Activity, param } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { CustomPriceBodyDto, LinePricesBodyDto, UserOpsBodyDto, UserPackageBodyDto, UserPackagesBulkBodyDto } from '../office.dto';
import { TermsService } from './terms.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class TermsController {
  constructor(private readonly termDesk: TermsService) {}

  @Get('packages/:code/custom-prices')
  @ApiOperation({ summary: 'Accounts whose price for this package differs from their default' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  customPrices(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.termDesk.customPrices(actor, code);
  }

  @Put('packages/:code/custom-prices/:loginName')
  @ApiOperation({ summary: 'Set a special price for one account on this package' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: CustomPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', (req) => `${param('loginName')(req)}:${param('code')(req)}`)
  setCustomPrice(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Param('loginName') loginName: string,
    @Body() body: CustomPriceBodyDto,
  ) {
    return this.termDesk.setCustomPrice(actor, code, loginName, body);
  }

  @Delete('packages/:code/custom-prices/:loginName')
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

  @Get('packages/:code/line-prices')
  @ApiOperation({ summary: 'The renewable numbers of this package grouped by the renewal price they carry' })
  @ApiParam({ name: 'code' })
  @ApiQuery({ name: 'scope', required: true, description: 'An account login (that account and everything under it) or "all" (branch only)' })
  @ApiErrorResponse(401, 403, 400, 404)
  linePrices(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Query('scope') scope?: string,
  ) {
    return this.termDesk.linePrices(actor, code, { scope });
  }

  @Put('packages/:code/line-prices')
  @ApiOperation({ summary: 'Reprice the renewable numbers of this package, one price group at a time' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: LinePricesBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_reprice', 'package', param('code'))
  setLinePrices(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: LinePricesBodyDto,
  ) {
    return this.termDesk.setLinePrices(actor, code, body);
  }

  @Get('users/:loginName/packages')
  @ApiOperation({ summary: 'Packages as this account sees and pays for them' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  userPackages(@Actor() actor: ActorShape, @Param('loginName') loginName: string) {
    return this.termDesk.userPackages(actor, loginName);
  }

  @Put('users/:loginName/packages')
  @ApiOperation({ summary: 'Hide or show several packages for this account' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: UserPackagesBulkBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', param('loginName'))
  setUserPackagesBulk(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: UserPackagesBulkBodyDto,
  ) {
    return this.termDesk.setUserPackagesBulk(actor, loginName, body);
  }

  @Put('users/:loginName/packages/:code')
  @ApiOperation({ summary: 'Hide, show, or price one package for this account' })
  @ApiParam({ name: 'loginName' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: UserPackageBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', (req) => `${param('loginName')(req)}:${param('code')(req)}`)
  setUserPackage(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Param('code') code: string,
    @Body() body: UserPackageBodyDto,
  ) {
    return this.termDesk.setUserPackage(actor, loginName, code, body);
  }

  @Get('users/:loginName/ops')
  @ApiOperation({ summary: 'Line operations stopped on this account, own and inherited' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  userOps(@Actor() actor: ActorShape, @Param('loginName') loginName: string) {
    return this.termDesk.userOps(actor, loginName);
  }

  @Put('users/:loginName/ops')
  @ApiOperation({ summary: 'Set the line operations stopped on this account' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: UserOpsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_ops', 'user', param('loginName'))
  setUserOps(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: UserOpsBodyDto,
  ) {
    return this.termDesk.setUserOps(actor, loginName, body);
  }
}
