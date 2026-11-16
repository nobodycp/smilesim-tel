import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponse, ApiZodBody, NoActivity, NotDuplicateGuarded, errorBody } from '../platform';
import { answer, clearSessionCookie, doorOf, metaOf, originOf, sessionIdOf, setSessionCookie } from './auth-http';
import { AuthRecords } from './auth-records';
import { NextAppDto, OkDto } from './auth.dto';
import { ChangePasswordBody, LoginBody, PasskeyLoginBody, TwoFactorCodeBody, parseBody } from './auth.schemas';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkeys';

// Getting a session and ending it (slice R.A): the password, the passkey, the second step of a sign-in, the
// password change a sign-in may force, and sign-out. Each answer may carry a session; none is ever kept or replayed.
@ApiTags('auth')
@ApiSecurity('x-door')
@Controller('auth')
@NotDuplicateGuarded('sign-in and sign-out: an answer that carries a session or a challenge is never kept or replayed; a repeat is judged afresh (a one-time code or challenge, a send limit, the current password)')
export class SignInController {
  constructor(
    private readonly auth: AuthService,
    private readonly passkeys: PasskeyService,
    private readonly records: AuthRecords,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in; sets `sid` cookie on success' })
  @ApiZodBody(LoginBody)
  @ApiErrorResponse(401, 403, 429)
  async login(
    @Body() body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseBody(LoginBody, body);
    if (!input) {
      res.status(401);
      return errorBody('BAD_CREDENTIALS');
    }
    const door = doorOf(req);
    if (door === 'conflict') {
      res.status(403);
      return errorBody('DOOR_MISMATCH');
    }
    const result = await this.auth.login(input, metaOf(req), door);
    await this.records.signIn(req, input.loginName, result);
    res.status(result.status);
    if (result.kind === 'error') return { message: result.message, code: result.code };
    setSessionCookie(res, result.sessionId);
    return result.body;
  }

  @Post('passkey-login/options')
  @NoActivity('a step: issues a challenge; `passkey-login` records the sign-in, success and failure')
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin a passkey sign-in: a one-time id and options for navigator.credentials.get' })
  @ApiErrorResponse(400)
  async passkeyLoginOptions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.passkeys.loginOptions(originOf(req)), ({ loginId, options }) => ({ loginId, options }));
  }

  @Post('passkey-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with a passkey; sets `sid` cookie on success' })
  @ApiZodBody(PasskeyLoginBody)
  @ApiOkResponse({ type: NextAppDto })
  @ApiErrorResponse(400, 401, 403)
  async passkeyLogin(@Body() body: PasskeyLoginBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const door = doorOf(req);
    if (door === 'conflict') {
      res.status(403);
      return errorBody('DOOR_MISMATCH');
    }
    const result = await this.passkeys.login(body, metaOf(req), door);
    const loginName = 'loginName' in result ? (result.loginName ?? '') : '';
    // A refused passkey that named no account has no login name to be recorded under.
    if (result.kind === 'ok' || loginName) await this.records.signIn(req, loginName, result, 'passkey');
    return answer(res, result, (ok) => {
      setSessionCookie(res, ok.sessionId);
      return { next: ok.next };
    });
  }

  @Post('two-factor/send')
  @NoActivity('a step: sends a code; `two-factor/verify` records, success and failure')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'During the sign-in challenge: send the SMS or email code (once every 30 seconds)' })
  @ApiErrorResponse(401, 403, 400)
  async sendCode(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.sendChallengeCode(sessionIdOf(req)), ({ method, sentTo, sent, retryIn }) => ({ method, sentTo, sent, retryIn }));
  }

  @Post('two-factor/verify')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Verify 2FA code during login challenge' })
  @ApiZodBody(TwoFactorCodeBody)
  @ApiOkResponse({ type: NextAppDto })
  @ApiErrorResponse(401, 400)
  async verifyTwoFactor(
    @Body() body: TwoFactorCodeBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyTwoFactor(sessionIdOf(req), body, metaOf(req));
    await this.records.own(req, 'two_factor', result);
    return answer(res, result, (ok) => {
      setSessionCookie(res, ok.sessionId);
      return { next: 'app' };
    });
  }

  @Post('password')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Change password (forced or voluntary)' })
  @ApiZodBody(ChangePasswordBody)
  @ApiErrorResponse(401, 403, 400)
  async changePassword(
    @Body() body: ChangePasswordBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(sessionIdOf(req), body, metaOf(req));
    await this.records.own(req, 'password', result);
    return answer(res, result, (ok) => {
      setSessionCookie(res, ok.sessionId);
      return ok.body;
    });
  }

  @Post('logout')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Sign out: ends the current session at any step and clears the cookie' })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401, 403)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(sessionIdOf(req));
    await this.records.own(req, 'logout', result);
    return answer(res, result, () => {
      clearSessionCookie(res);
      return { ok: true };
    });
  }
}
