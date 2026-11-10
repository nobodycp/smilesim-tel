import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity, bodyField, param } from '../activity/activity.decorator';
import { ActivityInterceptor } from '../activity/activity.interceptor';
import { readCookie } from '../../shared/cookies';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { text } from '../kernel/query';
import { AccessBody, CreateUserBody, SetAccountPasswordBody } from './accounts.schemas';
import { AccountsService } from './accounts.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class AccountsController {
  constructor(private readonly accountDesk: AccountsService) {}

  @Get('users')
  @ApiOperation({ summary: 'One page of the accounts the actor may see ({ items, nextCursor, total })' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'layer', required: false })
  @ApiErrorResponse(401, 403)
  users(
    @Actor() actor: ActorShape,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('layer') layer?: string,
  ) {
    return this.accountDesk.page(actor, { cursor: text(cursor), q: text(q), layer: text(layer) });
  }

  @Get('directory')
  @ApiOperation({ summary: 'One page of the accounts the actor may meet on a screen: login, full name, layer ({ items, nextCursor, total })' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'layer', required: false })
  @ApiQuery({ name: 'mine', required: false, description: '`1` keeps the accounts in the actor\'s own tree' })
  @ApiErrorResponse(400, 401, 403)
  directory(@Actor() actor: ActorShape, @Query('cursor') cursor?: string, @Query('q') q?: string, @Query('layer') layer?: string, @Query('mine') mine?: string) {
    return this.accountDesk.directory(actor, { cursor: text(cursor), q: text(q), layer: text(layer), mine: text(mine) === '1' });
  }

  @Get('users/:loginName')
  @ApiOperation({ summary: 'Single account detail' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  account(@Actor() actor: ActorShape, @Param('loginName') loginName: string) {
    return this.accountDesk.detail(actor, loginName);
  }

  @Patch('users/:loginName/access')
  @ApiOperation({ summary: 'Save grants / roles for an account' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(AccessBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('access', 'account', param('loginName'))
  saveAccess(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: AccessBody,
  ) {
    return this.accountDesk.saveAccess(actor, loginName, body);
  }

  @Post('users')
  @ApiOperation({ summary: 'Create an account under this door' })
  @ApiZodBody(CreateUserBody)
  @ApiErrorResponse(401, 403, 400)
  @Activity('user_create', 'account', bodyField('loginName'))
  createUser(
    @Actor() actor: ActorShape,
    @Body() body: CreateUserBody,
  ) {
    return this.accountDesk.create(actor, body);
  }

  @Post('users/:loginName/password')
  @ApiOperation({ summary: 'Set account password (office)' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(SetAccountPasswordBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('password', 'account', param('loginName'))
  setUserPassword(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: SetAccountPasswordBody,
  ) {
    return this.accountDesk.setPassword(actor, loginName, body);
  }

  @Post('users/:loginName/freeze')
  @ApiOperation({ summary: 'Freeze an account' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('user_freeze', 'account', param('loginName'))
  freezeUser(@Actor() actor: ActorShape, @Param('loginName') loginName: string) {
    return this.accountDesk.setFrozen(actor, loginName, true);
  }

  @Post('users/:loginName/restore')
  @ApiOperation({ summary: 'Restore a frozen account' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('user_restore', 'account', param('loginName'))
  restoreUser(@Actor() actor: ActorShape, @Param('loginName') loginName: string) {
    return this.accountDesk.setFrozen(actor, loginName, false);
  }

  @Delete('users/:loginName')
  @ApiOperation({ summary: 'Delete an account (no history)' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404, 400)
  @Activity('user_delete', 'account', param('loginName'))
  removeUser(@Actor() actor: ActorShape, @Param('loginName') loginName: string) {
    return this.accountDesk.remove(actor, loginName);
  }

  @Post('users/:loginName/enter')
  @ApiOperation({ summary: 'Enter an account: answers its door and a one-time handoff code (`POST /office/handoff` on that door sets the cookies)' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('enter', 'account', param('loginName'))
  enter(@Actor() actor: ActorShape, @Req() req: Request, @Param('loginName') loginName: string) {
    return this.accountDesk.enter(actor, loginName, {
      userAgent: String(req.headers['user-agent'] ?? ''),
      ip: req.ip ?? '',
      homeId: readCookie(req, 'sid'),
    });
  }
}
