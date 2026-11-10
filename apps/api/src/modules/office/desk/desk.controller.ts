import { OverviewQuery } from './desk.schemas';
import { ApiZodQuery } from '../../../openapi/query';
import { Controller, Get, Query, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { DeskService } from './desk.service';
import { OverviewService } from './overview.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class DeskController {
  constructor(private readonly desk: DeskService, private readonly overviews: OverviewService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current office identity, balance, grants' })
  @ApiErrorResponse(401, 403)
  me(@Actor() actor: ActorShape) {
    return this.desk.me(actor);
  }

  @Get('home')
  @ApiOperation({ summary: 'Home desk payload (stats, shortcuts, panes)' })
  @ApiErrorResponse(401, 403)
  home(@Actor() actor: ActorShape) {
    return this.desk.home(actor);
  }

  @Get('overview')
  @ApiOperation({ summary: "The home page's full picture for the viewer: lines, sales, rankings, users, tasks and, for the branch, providers" })
  @ApiZodQuery(OverviewQuery)
  @ApiErrorResponse(400, 401, 403)
  overview(@Actor() actor: ActorShape, @Query() query: OverviewQuery) {
    return this.overviews.overview(actor, query);
  }
}
