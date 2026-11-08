import { Body, Controller, Get, Post, Query, Req, Res, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { NoticeReadBodyDto } from '../office.dto';
import { NoticeInboxService } from './notice-inbox.service';

/** A query value is a string or nothing; a repeated or nested one is ignored. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class NoticesController {
  constructor(private readonly inbox: NoticeInboxService) {}

  @Get('notices')
  @ApiOperation({ summary: 'Notices inbox (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'group', required: false, enum: ['tasks', 'wallet', 'announcements'] })
  @ApiQuery({ name: 'unread', required: false })
  @ApiErrorResponse(401, 403)
  notices(
    @Actor() actor: ActorShape,
    @Query('cursor') cursor?: string,
    @Query('group') group?: string,
    @Query('unread') unread?: string,
  ) {
    return this.inbox.list(actor, { cursor: text(cursor), group: text(group), unread: text(unread) });
  }

  // The session is checked by ActorInterceptor before this runs; a refusal answers JSON through the filter.
  @Get('notices/stream')
  @ApiOperation({ summary: 'Live notices for the signed-in user (server-sent events)' })
  @ApiErrorResponse(401)
  async noticeStream(@Actor() actor: ActorShape, @Req() req: Request, @Res() res: Response) {
    let unsubscribe: (() => Promise<void>) | null = await this.inbox.subscribe(actor, (message) => {
      res.write(`event: notice\ndata: ${message}\n\n`);
    });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': open\n\n');
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    const close = () => {
      clearInterval(heartbeat);
      void unsubscribe?.();
      unsubscribe = null;
    };
    req.on('close', close);
    res.on('error', close);
  }

  @Post('notices/read')
  @ApiOperation({ summary: 'Mark notice(s) read' })
  @ApiBody({ type: NoticeReadBodyDto })
  @ApiErrorResponse(401, 403)
  readNotices(@Actor() actor: ActorShape, @Body() body: NoticeReadBodyDto) {
    const id = typeof body.id === 'string' ? body.id : undefined;
    return this.inbox.read(actor, id);
  }
}
