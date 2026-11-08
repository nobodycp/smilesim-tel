import { Body, Controller, Get, Param, Post, Query, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { Activity, param } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { Actor, ActorInterceptor } from '../kernel/actor.interceptor';
import type { Actor as ActorShape } from '../kernel/types';
import { TransferAccountBodyDto, TransferLineBodyDto } from '../office.dto';
import { TransfersService } from './transfers.service';

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class TransfersController {
  constructor(private readonly transferDesk: TransfersService) {}

  @Post('lines/:id/transfer')
  @ApiOperation({ summary: 'Transfer a line to another POS' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: TransferLineBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  transferLine(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: TransferLineBodyDto,
  ) {
    return this.transferDesk.transferLine(actor, id, body);
  }

  @Post('users/:loginName/transfer')
  @ApiOperation({ summary: 'Transfer a point of sale or an agent to another parent, with an explicit choice for what travels with it' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: TransferAccountBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_transfer', 'user', param('loginName'))
  transferAccount(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: TransferAccountBodyDto,
  ) {
    return this.transferDesk.transferAccount(actor, loginName, body);
  }

  @Get('users/:loginName/transfer-preview')
  @ApiOperation({ summary: 'What moving an account under another parent would carry; refuses as the move does' })
  @ApiParam({ name: 'loginName' })
  @ApiQuery({ name: 'parentLogin', required: true, description: 'The login of the new parent' })
  @ApiErrorResponse(401, 403, 400)
  transferPreview(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Query('parentLogin') parentLogin?: unknown,
  ) {
    return this.transferDesk.transferPreview(actor, loginName, { parentLogin });
  }
}
