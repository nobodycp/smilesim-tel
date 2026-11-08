import { Controller, Post, Req, Res, UseFilters, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SESSION_TTL_SECONDS } from '../../auth/sessions';
import { ApiErrorResponse } from '../../../openapi/responses';
import { OfficeFailureFilter } from '../../shared/office-failure.filter';
import { Activity } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { cookieBase, gateOf, readCookie } from '../gate';
import { AccountSessionService } from './account-session.service';

/**
 * Leaving an entered account. It reads the impersonation session itself (any scope, any layer), so it has no
 * ActorInterceptor: going behind it would refuse a session `actor()` does not accept before this can end it.
 */
@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor)
export class AccountSessionController {
  constructor(private readonly sessions: AccountSessionService) {}

  @Post('leave')
  @ApiOperation({ summary: 'Leave impersonation; restores `sid` from `home`' })
  @ApiErrorResponse(401, 403)
  @Activity('leave', 'account')
  async leave(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const home = readCookie(req, 'home');
    const result = await this.sessions.leave(gateOf(req));
    if (result && typeof result === 'object' && 'ok' in result && home) {
      res.cookie('sid', home, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS * 1000 });
      res.clearCookie('home', cookieBase());
    }
    return result;
  }
}
