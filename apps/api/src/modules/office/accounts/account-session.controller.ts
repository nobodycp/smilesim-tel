import { Body, Controller, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SESSION_COOKIE_SECONDS } from '../../auth/sessions';
import { ApiErrorResponse } from '../../../openapi/responses';
import { Activity } from '../activity.decorator';
import { ActivityInterceptor } from '../activity.interceptor';
import { cookieBase, gateOf, readCookie } from '../../shared/cookies';
import { AccountSessionService } from './account-session.service';

/**
 * Leaving an entered account. It reads the impersonation session itself (any scope, any layer), so it has no
 * ActorInterceptor: going behind it would refuse a session `actor()` does not accept before this can end it.
 */
@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
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
    if (home) res.cookie('sid', home, { ...cookieBase(), maxAge: SESSION_COOKIE_SECONDS * 1000 });
    else res.clearCookie('sid', cookieBase());
    res.clearCookie('home', cookieBase());
    return result;
  }

  /**
   * The entered account's door trades the one-time code from `users/:login/enter` for its cookies: `sid` is the
   * entered session, `home` the owner's, so leaving can put the owner back. Not logged: `enter` already was.
   */
  @Post('handoff')
  @ApiOperation({ summary: 'Open an entered account on its door: trades the one-time code for the `sid` + `home` cookies' })
  @ApiErrorResponse(400)
  async handoff(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { sessionId, homeId } = await this.sessions.handoff(body);
    res.cookie('sid', sessionId, { ...cookieBase(), maxAge: SESSION_COOKIE_SECONDS * 1000 });
    if (homeId) res.cookie('home', homeId, { ...cookieBase(), maxAge: SESSION_COOKIE_SECONDS * 1000 });
    return { ok: true };
  }
}
