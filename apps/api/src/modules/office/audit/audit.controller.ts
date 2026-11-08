import { Controller, Get, Query, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { text } from '../kernel/query';
import { AuditService } from './audit.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class AuditController {
  constructor(private readonly auditLog: AuditService) {}

  @Get('audit')
  @ApiOperation({ summary: 'Activity log (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'result', required: false })
  @ApiQuery({ name: 'layer', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiErrorResponse(401, 403)
  audit(
    @Actor() actor: ActorShape,
    @Query('cursor') cursor?: string,
    @Query('action') action?: string,
    @Query('result') result?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.auditLog.list(actor, {
      cursor: text(cursor),
      action: text(action),
      result: text(result),
      layer: text(layer),
      q: text(q),
      from: text(from),
      to: text(to),
    });
  }
}
