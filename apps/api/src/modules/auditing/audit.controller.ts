import { AuditQuery } from './audit.schemas';
import { ApiZodQuery, ApiErrorResponse, ActivityInterceptor, RESOURCE_CONTROLLER_PREFIXES, withExportLimit } from '../platform';
import { Controller, Get, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Actor, ActorInterceptor } from '../access';
import type { Actor as ActorShape } from '../access';
import { AuditService } from './audit.service';

@ApiTags('auditing')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller(RESOURCE_CONTROLLER_PREFIXES)
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
    const csv = await withExportLimit(() => this.auditLog.csv(actor, query));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="activity.csv"');
    return csv;
  }
}
