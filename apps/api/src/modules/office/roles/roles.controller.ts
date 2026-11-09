import { Body, Controller, Get, Post, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import { freeFormObject } from '../kernel/query';
import type { Actor as ActorShape } from '../kernel/types';
import { RolesService } from './roles.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class RolesController {
  constructor(private readonly roleDesk: RolesService) {}

  @Get('roles')
  @ApiOperation({ summary: 'Roles catalogue' })
  @ApiErrorResponse(401, 403)
  roles(@Actor() actor: ActorShape) {
    return this.roleDesk.list(actor);
  }

  @Post('roles')
  @ApiOperation({ summary: 'Create or update a role' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400)
  saveRole(@Actor() actor: ActorShape, @Body() body: Record<string, unknown>) {
    return this.roleDesk.save(actor, body);
  }
}
