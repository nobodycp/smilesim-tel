import { Body, Controller, Get, Param, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, bodyField, param } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { CompanyImageBody, CompanySimBody } from './companies.schemas';
import { CompaniesService } from './companies.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class CompaniesController {
  constructor(private readonly companyDesk: CompaniesService) {}

  @Get('companies')
  @ApiOperation({ summary: 'Companies shelf' })
  @ApiErrorResponse(401, 403)
  companies(@Actor() actor: ActorShape) {
    return this.companyDesk.shelf(actor);
  }

  @Post('companies/image')
  @Activity('company_image', 'company', bodyField('name'))
  @ApiOperation({ summary: 'Set company mark / image' })
  @ApiZodBody(CompanyImageBody)
  @ApiErrorResponse(401, 403, 400)
  companyImage(@Actor() actor: ActorShape, @Body() body: CompanyImageBody) {
    return this.companyDesk.setImage(actor, body);
  }

  @Put('companies/:code/sim')
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
