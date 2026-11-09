import { Body, Controller, Get, Param, Post, Query, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { Activity, bodyField } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { text } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { ProviderCatalogService } from './provider-catalog.service';

/** Adding to the catalog from the provider (spec 2026-11-09-admin-review, 3): query, then add a company or a package. */
@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class ProviderCatalogController {
  constructor(private readonly catalog: ProviderCatalogService) {}

  @Get('providers/:code/catalog/companies')
  @ApiOperation({ summary: 'The companies the provider sells, each marked when already added (simulated for now)' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  companies(@Actor() actor: ActorShape, @Param('code') code: string) {
    return this.catalog.companies(actor, code);
  }

  @Get('providers/:code/catalog/products')
  @ApiOperation({ summary: 'The provider products for one company, each marked when already added (simulated for now)' })
  @ApiParam({ name: 'code' })
  @ApiQuery({ name: 'company', required: true })
  @ApiErrorResponse(401, 403, 400, 404)
  products(@Actor() actor: ActorShape, @Param('code') code: string, @Query('company') company?: string) {
    return this.catalog.products(actor, code, text(company) ?? '');
  }

  @Post('companies')
  @ApiOperation({ summary: 'Add a company the provider sells, with its SIM rules and eSIM price' })
  @ApiErrorResponse(401, 403, 400, 404, 409)
  @Activity('company_add', 'company', bodyField('companyCode'))
  createCompany(@Actor() actor: ActorShape, @Body() body: Record<string, unknown>) {
    return this.catalog.createCompany(actor, body ?? {});
  }

  @Post('packages')
  @ApiOperation({ summary: 'Add a package from a provider product: facts, prices, extra operations, run modes' })
  @ApiErrorResponse(401, 403, 400, 404, 409)
  @Activity('package_add', 'package', bodyField('productCode'))
  createPackage(@Actor() actor: ActorShape, @Body() body: Record<string, unknown>) {
    return this.catalog.createPackage(actor, body ?? {});
  }
}
