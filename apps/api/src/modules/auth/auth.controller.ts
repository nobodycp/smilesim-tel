import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ActivityRecorder, type ActivityDraft } from '../office/activity/activity-recorder';
import { cookieBase, readCookie } from '../shared/cookies';
import { AuthService, Failure, type Outcome } from './auth.service';
import { SESSION_COOKIE_SECONDS } from './sessions';
import { expectedLayer } from '../../doors';
import { errorBody } from '../../errors';
import { ApiZodBody } from '../../openapi/body';
import { ApiErrorResponse } from '../../openapi/responses';
import { NextAppDto, OkDto, OtpauthDto, ProfileDto, SessionsListDto, TwoFactorExemptDto } from './auth.dto';
import {
  ChangePasswordBody,
  ConfirmMethodBody,
  ExemptionBody,
  LoginBody,
  PasskeyBody,
  PasskeyLoginBody,
  PolicyBody,
  SessionRulesBody,
  SetPasswordBody,
  TwoFactorCodeBody,
  TwoFactorMethodBody,
  UpdateProfileBody,
  UserContactBody,
  parseBody,
} from './auth.schemas';
import { PasskeyService } from './passkeys';

function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie('sid', sessionId, { ...cookieBase(), maxAge: SESSION_COOKIE_SECONDS * 1000 });
}

const sessionIdOf = (req: Request) => readCookie(req, 'sid');

function metaOf(req: Request) {
  return { userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' };
}

function originOf(req: Request): string | undefined {
  return typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
}

function doorOf(req: Request) {
  const header = req.headers['x-door'];
  return expectedLayer({ origin: originOf(req), door: typeof header === 'string' ? header : undefined });
}

function failWith(res: Response, failure: Failure) {
  res.status(failure.status);
  return { message: failure.message, code: failure.code };
}

@ApiTags('auth')
@ApiSecurity('x-door')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly activity: ActivityRecorder,
    private readonly passkeys: PasskeyService,
  ) {}

  /** One activity event for an owner-only action on another account or on a layer, done or refused. */
  private async recordOwner(req: Request, event: ActivityDraft, result: Outcome<unknown>): Promise<void> {
    const failed = result.kind === 'error';
    await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, event, failed ? 'fail' : 'ok', failed ? result.code : '');
  }

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
    if (result.kind === 'error') {
      await this.activity.recordLogin({ loginName: input.loginName, ip: metaOf(req).ip, result: 'fail', reason: result.code });
      res.status(result.status);
      return { message: result.message, code: result.code };
    }
    await this.activity.recordLogin({ loginName: input.loginName, ip: metaOf(req).ip, result: 'ok', reason: '' });
    setSessionCookie(res, result.sessionId);
    res.status(200);
    return result.body;
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
    if (result.kind === 'error') {
      await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'password' }, 'fail', result.code);
      return failWith(res, result);
    }
    await this.activity.recordOffice({ sessionId: result.sessionId }, metaOf(req).ip, { action: 'password' }, 'ok', '');
    setSessionCookie(res, result.sessionId);
    return result.body;
  }

  @Get('profile')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Current account profile' })
  @ApiOkResponse({ type: ProfileDto })
  @ApiErrorResponse(401)
  async getProfile(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.getProfile(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return result.profile;
  }

  @Patch('profile')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Update profile fields and/or password' })
  @ApiZodBody(UpdateProfileBody)
  @ApiOkResponse({ type: ProfileDto })
  @ApiErrorResponse(401, 400)
  async profile(
    @Body() body: UpdateProfileBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.updateProfile(sessionIdOf(req), body);
    if (result.kind === 'error') return failWith(res, result);
    return result.profile;
  }

  @Post('users/:loginName/password')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Set another user password (privileged)' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(SetPasswordBody)
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401, 403, 404, 400)
  async setUserPassword(
    @Param('loginName') loginName: string,
    @Body() body: SetPasswordBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setUserPassword(sessionIdOf(req), loginName, body);
    await this.recordOwner(req, { action: 'password', subjectKind: 'account', subjectRef: loginName }, result);
    if (result.kind === 'error') return failWith(res, result);
    return { ok: true };
  }

  @Get('sessions')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'List sessions for the current account' })
  @ApiOkResponse({ type: SessionsListDto })
  @ApiErrorResponse(401)
  async sessions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.listSessions(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { sessions: result.sessions };
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Revoke a session; clears cookie if current' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401, 404)
  async revokeSession(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.revokeSession(sessionIdOf(req), id);
    if (result.kind === 'error') {
      await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'logout' }, 'fail', result.code);
      return failWith(res, result);
    }
    await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'logout' }, 'ok', '');
    if (result.current) res.clearCookie('sid', cookieBase());
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Sign out: ends the current session at any step and clears the cookie' })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401, 403)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const gate = { sessionId: sessionIdOf(req) };
    const result = await this.auth.logout(gate.sessionId);
    await this.activity.recordOffice(gate, metaOf(req).ip, { action: 'logout' }, result.kind === 'error' ? 'fail' : 'ok', result.kind === 'error' ? result.code : '');
    if (result.kind === 'error') return failWith(res, result);
    res.clearCookie('sid', cookieBase());
    return { ok: true };
  }

  @Post('two-factor/setup')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Begin 2FA enrollment; returns otpauth URI' })
  @ApiOkResponse({ type: OtpauthDto })
  @ApiErrorResponse(401, 403)
  async setupTwoFactor(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.setupTwoFactor(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { otpauth: result.otpauth };
  }

  @Post('two-factor/confirm')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Confirm 2FA enrollment with a TOTP code' })
  @ApiZodBody(TwoFactorCodeBody)
  @ApiOkResponse({ type: NextAppDto })
  @ApiErrorResponse(401, 400)
  async confirmTwoFactor(
    @Body() body: TwoFactorCodeBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.confirmTwoFactor(sessionIdOf(req), body, metaOf(req));
    if (result.kind === 'error') {
      await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'two_factor' }, 'fail', result.code);
      return failWith(res, result);
    }
    await this.activity.recordOffice({ sessionId: result.sessionId ?? sessionIdOf(req) }, metaOf(req).ip, { action: 'two_factor' }, 'ok', '');
    if (result.sessionId) setSessionCookie(res, result.sessionId);
    return { next: 'app' };
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
    if (result.kind === 'error') {
      await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'two_factor' }, 'fail', result.code);
      return failWith(res, result);
    }
    await this.activity.recordOffice({ sessionId: result.sessionId }, metaOf(req).ip, { action: 'two_factor' }, 'ok', '');
    setSessionCookie(res, result.sessionId);
    return { next: 'app' };
  }

  @Delete('two-factor')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Disable own 2FA' })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401)
  async disableTwoFactor(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.disableOwnTwoFactor(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { ok: true };
  }

  @Delete('two-factor/:loginName')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Clear another user 2FA (privileged)' })
  @ApiParam({ name: 'loginName' })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401, 403, 404)
  async clearTwoFactor(
    @Param('loginName') loginName: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.clearUserTwoFactor(sessionIdOf(req), loginName);
    await this.recordOwner(req, { action: 'two_factor', subjectKind: 'account', subjectRef: loginName }, result);
    if (result.kind === 'error') return failWith(res, result);
    return { ok: true };
  }

  @Post('users/:loginName/disable')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Disable a user account (auth-side)' })
  @ApiParam({ name: 'loginName' })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401, 403, 404)
  async disableUser(
    @Param('loginName') loginName: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.disableUser(sessionIdOf(req), loginName);
    await this.recordOwner(req, { action: 'user_freeze', subjectKind: 'account', subjectRef: loginName }, result);
    if (result.kind === 'error') return failWith(res, result);
    return { ok: true };
  }

  @Patch('policy')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Set 2FA policy for a layer' })
  @ApiZodBody(PolicyBody)
  @ApiErrorResponse(401, 403, 400)
  async policy(
    @Body() body: PolicyBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setPolicy(sessionIdOf(req), body);
    await this.recordOwner(req, { action: 'two_factor', subjectKind: 'layer', subjectRef: result.kind === 'ok' ? String(body?.layer ?? '') : '' }, result);
    if (result.kind === 'error') return failWith(res, result);
    return { policy: result.policy };
  }

  @Patch('exemptions/:loginName')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Set 2FA exemption for a login' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(ExemptionBody)
  @ApiOkResponse({ type: TwoFactorExemptDto })
  @ApiErrorResponse(401, 403, 404)
  async exemption(
    @Param('loginName') loginName: string,
    @Body() body: ExemptionBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setExemption(sessionIdOf(req), loginName, body);
    await this.recordOwner(req, { action: 'two_factor', subjectKind: 'account', subjectRef: loginName }, result);
    if (result.kind === 'error') return failWith(res, result);
    return { twoFactorExempt: result.twoFactorExempt };
  }
  @Get('sign-in-methods')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'How this account signs in: 2FA method, masked contacts, passkeys' })
  @ApiErrorResponse(401, 403)
  async signInMethods(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.signInMethods(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return result.view;
  }

  @Post('two-factor/method')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Choose SMS or email as the 2FA method; sends a code to confirm it' })
  @ApiZodBody(TwoFactorMethodBody)
  @ApiErrorResponse(401, 403, 400)
  async chooseMethod(@Body() body: TwoFactorMethodBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.chooseCodeMethod(sessionIdOf(req), body);
    if (result.kind === 'error') return failWith(res, result);
    return { sentTo: result.sentTo, sent: result.sent, retryIn: result.retryIn };
  }

  @Post('two-factor/method/confirm')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Confirm the SMS or email method with the code it sent; turns 2FA on' })
  @ApiZodBody(ConfirmMethodBody)
  @ApiOkResponse({ type: NextAppDto })
  @ApiErrorResponse(401, 403, 400)
  async confirmMethod(@Body() body: ConfirmMethodBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.confirmCodeMethod(sessionIdOf(req), body, metaOf(req));
    if (result.kind === 'error') {
      await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'two_factor' }, 'fail', result.code);
      return failWith(res, result);
    }
    await this.activity.recordOffice({ sessionId: result.sessionId ?? sessionIdOf(req) }, metaOf(req).ip, { action: 'two_factor' }, 'ok', '');
    if (result.sessionId) setSessionCookie(res, result.sessionId);
    return { next: 'app' };
  }

  @Post('two-factor/send')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'During the sign-in challenge: send the SMS or email code (once every 30 seconds)' })
  @ApiErrorResponse(401, 403, 400)
  async sendCode(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.sendChallengeCode(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { method: result.method, sentTo: result.sentTo, sent: result.sent, retryIn: result.retryIn };
  }

  @Get('passkeys')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'The passkeys of this account' })
  @ApiErrorResponse(401, 403)
  async listPasskeys(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.passkeys.list(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { passkeys: result.passkeys };
  }

  @Post('passkeys/options')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Begin adding a passkey: options for navigator.credentials.create' })
  @ApiErrorResponse(401, 403, 400)
  async passkeyOptions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.passkeys.registrationOptions(sessionIdOf(req), originOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return result.options;
  }

  @Post('passkeys')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Finish adding a passkey with the browser answer' })
  @ApiZodBody(PasskeyBody)
  @ApiErrorResponse(401, 403, 400)
  async addPasskey(@Body() body: PasskeyBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.passkeys.register(sessionIdOf(req), body);
    if (result.kind === 'error') {
      await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'passkey_add' }, 'fail', result.code);
      return failWith(res, result);
    }
    await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'passkey_add' }, 'ok', '');
    return result.passkey;
  }

  @Delete('passkeys/:id')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Delete one of this account passkeys' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401, 403, 404)
  async removePasskey(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.passkeys.remove(sessionIdOf(req), id);
    if (result.kind === 'error') return failWith(res, result);
    await this.activity.recordOffice({ sessionId: sessionIdOf(req) }, metaOf(req).ip, { action: 'passkey_remove' }, 'ok', '');
    return { ok: true };
  }

  @Post('passkey-login/options')
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin a passkey sign-in: a one-time id and options for navigator.credentials.get' })
  @ApiErrorResponse(400)
  async passkeyLoginOptions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.passkeys.loginOptions(originOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { loginId: result.loginId, options: result.options };
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
    if (result.kind === 'error') {
      if (loginName) await this.activity.recordLogin({ loginName, ip: metaOf(req).ip, result: 'fail', reason: result.code });
      return failWith(res, result);
    }
    await this.activity.recordLogin({ loginName, ip: metaOf(req).ip, result: 'ok', reason: 'passkey' });
    setSessionCookie(res, result.sessionId);
    return { next: result.next };
  }

  @Get('session-rules')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: default and per-layer session rules (sessions allowed, idle minutes)' })
  @ApiErrorResponse(401, 403)
  async sessionRules(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.sessionRules(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return result.view;
  }

  @Patch('session-rules/:layer')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: set a layer session rules; null follows the default' })
  @ApiParam({ name: 'layer' })
  @ApiZodBody(SessionRulesBody)
  @ApiErrorResponse(401, 403, 400)
  async setLayerSessionRules(@Param('layer') layer: string, @Body() body: SessionRulesBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.setLayerSessionRules(sessionIdOf(req), layer, body);
    if (result.kind === 'error') return failWith(res, result);
    return { layers: result.layers };
  }

  @Get('users/:loginName/settings')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: an account email, mobile and second step («إعدادات المستخدم»)' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  async userSettings(@Param('loginName') loginName: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.userSettings(sessionIdOf(req), loginName);
    if (result.kind === 'error') return failWith(res, result);
    return result.settings;
  }

  @Patch('users/:loginName/contact')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: set an account email and mobile; an empty string clears one' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(UserContactBody)
  @ApiErrorResponse(401, 403, 404, 400)
  async setUserContact(@Param('loginName') loginName: string, @Body() body: UserContactBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.setUserContact(sessionIdOf(req), loginName, body);
    if (result.kind === 'error') return failWith(res, result);
    return result.settings;
  }

  @Get('users/:loginName/session-rules')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: an account session rules, its layer and the result' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  async userSessionRules(@Param('loginName') loginName: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.userSessionRules(sessionIdOf(req), loginName);
    if (result.kind === 'error') return failWith(res, result);
    return result.view;
  }

  @Patch('users/:loginName/session-rules')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: set an account session rules; null follows its layer' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(SessionRulesBody)
  @ApiErrorResponse(401, 403, 404, 400)
  async setUserSessionRules(
    @Param('loginName') loginName: string,
    @Body() body: SessionRulesBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setUserSessionRules(sessionIdOf(req), loginName, body);
    if (result.kind === 'error') return failWith(res, result);
    return result.view;
  }
}
