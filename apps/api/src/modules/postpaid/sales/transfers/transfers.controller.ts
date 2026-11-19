import { TransferPreviewQuery, TransferAccountBody, TransferLineBody } from './transfers.schemas';
import { ApiZodQuery, ApiZodBody, ApiErrorResponse, Activity, param, ActivityInterceptor, RESOURCE_CONTROLLER_PREFIXES } from '../../../platform';
import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Actor, ActorInterceptor } from '../../../access';
import type { Actor as ActorShape } from '../../../access';
import { TransfersService } from './transfers.service';

@ApiTags('sales')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller(RESOURCE_CONTROLLER_PREFIXES)
@UseInterceptors(ActivityInterceptor, ActorInterceptor)
export class TransfersController {
  constructor(private readonly transferDesk: TransfersService) {}

  @Post('postpaid/lines/:id/transfer')
  @ApiOperation({ summary: 'Transfer a line to another POS' })
  @ApiParam({ name: 'id' })
  @ApiZodBody(TransferLineBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('transfer', 'line', param('id'))
  transferLine(
    @Actor() actor: ActorShape,
    @Param('id') id: string,
    @Body() body: TransferLineBody,
  ) {
    return this.transferDesk.transferLine(actor, id, body);
  }

  @Post('users/:loginName/transfer')
  @ApiOperation({ summary: 'Transfer a point of sale or an agent to another parent, with an explicit choice for what travels with it' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(TransferAccountBody)
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_transfer', 'user', param('loginName'))
  transferAccount(
    @Actor() actor: ActorShape,
    @Param('loginName') loginName: string,
    @Body() body: TransferAccountBody,
  ) {
    return this.transferDesk.transferAccount(actor, loginName, body);
  }

  @Get('users/:loginName/transfer-preview')
  @ApiOperation({ summary: 'What moving an account under another parent would carry; refuses as the move does' })
  @ApiParam({ name: 'loginName' })
  @ApiZodQuery(TransferPreviewQuery)
  @ApiErrorResponse(401, 403, 400)
  transferPreview(@Actor() actor: ActorShape, @Param('loginName') loginName: string, @Query() query: TransferPreviewQuery) {
    return this.transferDesk.transferPreview(actor, loginName, query);
  }
}
