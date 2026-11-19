import { Body, Controller, Get, Param, Put, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody, ApiErrorResponse, Activity, param, ActivityInterceptor, RESOURCE_CONTROLLER_PREFIXES } from '../../platform';
import { Actor, ActorInterceptor } from '../../access';
import type { Actor as ActorShape } from '../../access';
import { CompanyImageBody, CompanySimBody } from './companies.schemas';
import { CompaniesService } from './companies.service';

@ApiTags('catalog')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class CompaniesController {
  constructor(private readonly companyDesk: CompaniesService) {}

  @Get('postpaid/companies')
  @ApiOperation({ summary: 'Companies shelf' })
  @ApiErrorResponse(401, 403)
  companies(@Actor() actor: ActorShape) {
    return this.companyDesk.shelf(actor);
  }

  @Put('postpaid/companies/:code/image')
  @Activity('company_image', 'company', param('code'))
  @ApiOperation({ summary: 'Set or clear a company mark / image' })
  @ApiZodBody(CompanyImageBody)
  @ApiErrorResponse(401, 403, 400, 404)
  companyImage(@Actor() actor: ActorShape, @Param('code') code: string, @Body() body: CompanyImageBody) {
    return this.companyDesk.setImage(actor, code, body);
  }

  @Put('postpaid/companies/:code/sim')
  @ApiOperation({ summary: 'Set company SIM rules (ICCID length, prefix, eSIM)' })
  @ApiParam({ name: 'code' })
  @ApiZodBody(CompanySimBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('company_sim', 'company', param('code'))
  companySim(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: CompanySimBody,
  ) {
    return this.companyDesk.setSim(actor, code, body);
  }
}
