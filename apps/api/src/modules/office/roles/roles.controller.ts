import { Activity, bodyField, param } from '../../shared/activity.decorator';
import { Body, Controller, Get, Param, Post, Put, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../openapi/body';
import { ApiErrorResponse } from '../../../openapi/responses';
import { ActivityInterceptor } from '../../shared/activity.interceptor';
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
  @Activity('role_save', 'role', bodyField('name'))
  @ApiOperation({ summary: 'Create a job role' })
  @ApiZodBody(RoleBody)
  @ApiErrorResponse(401, 403, 400)
  createRole(@Actor() actor: ActorShape, @Body() body: RoleBody) {
    return this.roleDesk.create(actor, body);
  }

  @Put('roles/:id')
  @Activity('role_save', 'role', param('id'))
  @ApiOperation({ summary: 'Change a role: its grants, and its name unless it is a layer role' })
  @ApiZodBody(RoleBody)
  @ApiErrorResponse(401, 403, 400, 404)
  updateRole(@Actor() actor: ActorShape, @Param('id') id: string, @Body() body: RoleBody) {
    return this.roleDesk.update(actor, id, body);
  }
}
