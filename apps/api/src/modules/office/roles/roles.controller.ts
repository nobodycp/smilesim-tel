import { Activity, bodyField } from '../activity.decorator';
import { Body, Controller, Get, Post, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { RoleBody } from './roles.schemas';
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
  @Activity('role_save', 'role', bodyField('id'))
  @ApiOperation({ summary: 'Create or update a role' })
  @ApiZodBody(RoleBody)
  @ApiErrorResponse(401, 403, 400)
  saveRole(@Actor() actor: ActorShape, @Body() body: RoleBody) {
    return this.roleDesk.save(actor, body);
  }
}
