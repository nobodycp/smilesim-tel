import { Controller, Get, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { text } from '../kernel/query';
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
    @Query('addresses') addresses?: string,
  ) {
    return this.auditLog.list(actor, {
      addresses: text(addresses),
      cursor: text(cursor),
      action: text(action),
      result: text(result),
      layer: text(layer),
      q: text(q),
      from: text(from),
      to: text(to),
    });
  }

  @Get('audit/export')
  @ApiOperation({ summary: 'Activity log as CSV, with the same filters' })
  @ApiErrorResponse(401, 403)
  async export(
    @Res({ passthrough: true }) res: Response,
    @Actor() actor: ActorShape,
    @Query() query: Record<string, unknown>,
  ) {
    const filters = Object.fromEntries(['action', 'result', 'layer', 'q', 'from', 'to'].map((key) => [key, text(query[key])]));
    const csv = await this.auditLog.csv(actor, filters);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="activity.csv"');
    return csv;
  }
}
