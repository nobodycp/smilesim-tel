import { AuditQuery } from './audit.schemas';
import { ApiZodQuery } from '../../../openapi/query';
import { Controller, Get, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { AuditService } from './audit.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class AuditController {
  constructor(private readonly auditLog: AuditService) {}

  @Get('audit')
  @ApiOperation({ summary: 'Activity log (paged)' })
  @ApiZodQuery(AuditQuery)
  @ApiErrorResponse(400, 401, 403)
  audit(@Actor() actor: ActorShape, @Query() query: AuditQuery) {
    return this.auditLog.list(actor, query);
  }

  @Get('audit/export')
  @ApiOperation({ summary: 'Activity log as CSV, with the same filters' })
  @ApiZodQuery(AuditQuery)
  @ApiErrorResponse(400, 401, 403)
  async export(@Res({ passthrough: true }) res: Response, @Actor() actor: ActorShape, @Query() query: AuditQuery) {
    const csv = await this.auditLog.csv(actor, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="activity.csv"');
    return csv;
  }
}
