import { readCookie } from '../../shared/cookies';
import { NoActivity } from '../activity.decorator';
import { Body, Controller, Get, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { parseInput } from '../../shared/input';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { text } from '../kernel/query';
import { NoticeInboxService } from './notice-inbox.service';
import { NoticeReadBody } from './notices.schemas';

/** How often an open notices stream is pinged and its session checked again. */
const STREAM_BEAT_MS = 25_000;

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class NoticesController {
  constructor(private readonly inbox: NoticeInboxService) {}

  @Get('notices')
  @ApiOperation({ summary: 'Notices inbox (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'group', required: false, enum: ['tasks', 'wallet', 'providers'] })
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
    const close = () => {
      clearInterval(heartbeat);
      void unsubscribe?.();
      unsubscribe = null;
    };
    // An open stream outlives the request that opened it, so the session is looked at again on every beat: a
    // signed-out, frozen or revoked account stops receiving (review 2026-11-10, S12).
    const sessionId = readCookie(req, 'sid');
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
      void this.inbox.sessionLive(sessionId).then((live) => {
        if (live) return;
        close();
        res.end();
      });
    }, STREAM_BEAT_MS);
    req.on('close', close);
    res.on('error', close);
  }

  @Post('notices/read')
  @ApiOperation({ summary: 'Mark notice(s) read' })
  @ApiZodBody(NoticeReadBody)
  @ApiErrorResponse(401, 403, 400)
  @NoActivity('marks the caller\'s own notices read; a log row per read is noise')
  readNotices(@Actor() actor: ActorShape, @Body() body: NoticeReadBody) {
    return this.inbox.read(actor, parseInput(NoticeReadBody, body).id);
  }
}
