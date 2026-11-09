import { Body, Controller, Get, Param, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, param } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { CompanyImageBodyDto, CompanySimBodyDto } from '../office.dto';
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
  @ApiOperation({ summary: 'Set company mark / image' })
  @ApiBody({ type: CompanyImageBodyDto })
  @ApiErrorResponse(401, 403, 400)
  companyImage(@Actor() actor: ActorShape, @Body() body: CompanyImageBodyDto) {
    return this.companyDesk.setImage(actor, body);
  }

  @Put('companies/:code/sim')
  @ApiOperation({ summary: 'Set company SIM rules (ICCID length, prefix, eSIM)' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: CompanySimBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('company_sim', 'company', param('code'))
  companySim(
    @Actor() actor: ActorShape,
    @Param('code') code: string,
    @Body() body: CompanySimBodyDto,
  ) {
    return this.companyDesk.setSim(actor, code, body);
  }
}
