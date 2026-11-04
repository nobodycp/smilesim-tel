import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService, Failure } from './auth.service';
import { SESSION_TTL_SECONDS } from './sessions';
import { expectedLayer } from '../../doors';
import { errorBody } from '../../errors';
import { ApiErrorResponse } from '../../openapi/responses';
import {
  ChangePasswordBodyDto,
  ExemptionBodyDto,
  LoginBodyDto,
  NextAppDto,
  OkDto,
  OtpauthDto,
  PolicyBodyDto,
  ProfileDto,
  SessionsListDto,
  SetPasswordBodyDto,
  TwoFactorCodeBodyDto,
  TwoFactorExemptDto,
  UpdateProfileBodyDto,
} from './auth.dto';

function cookieBase(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    sameSite: 'lax',
  };
}

function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie('sid', sessionId, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS * 1000 });
}

function sessionIdOf(req: Request): string | undefined {
  const parsed = (req as Request & { cookies?: Record<string, unknown> }).cookies?.sid;
  if (typeof parsed === 'string' && parsed) return parsed;
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === 'sid') {
      try {
        return decodeURIComponent(part.slice(index + 1).trim()) || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function metaOf(req: Request) {
  return { userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' };
}

function failWith(res: Response, failure: Failure) {
  res.status(failure.status);
  return { message: failure.message, code: failure.code };
}

@ApiTags('auth')
@ApiSecurity('x-door')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in; sets `sid` cookie on success' })
  @ApiBody({ type: LoginBodyDto })
  @ApiErrorResponse(401, 403, 429)
  async login(
    @Body() body: LoginBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof body?.loginName !== 'string' || typeof body?.password !== 'string') {
      res.status(401);
      return errorBody('BAD_CREDENTIALS');
    }
    const header = req.headers['x-door'];
    const door = expectedLayer({
      origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      door: typeof header === 'string' ? header : undefined,
    });
    if (door === 'conflict') {
      res.status(403);
      return errorBody('DOOR_MISMATCH');
    }
    const result = await this.auth.login({ loginName: body.loginName, password: body.password }, metaOf(req), door);
    if (result.kind === 'error') {
      res.status(result.status);
      return { message: result.message, code: result.code };
    }
    setSessionCookie(res, result.sessionId);
    res.status(200);
    return result.body;
  }

  @Post('password')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Change password (forced or voluntary)' })
  @ApiBody({ type: ChangePasswordBodyDto })
  @ApiErrorResponse(401, 403, 400)
  async changePassword(
    @Body() body: ChangePasswordBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(sessionIdOf(req), body ?? {}, metaOf(req));
    if (result.kind === 'error') return failWith(res, result);
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
  @ApiBody({ type: UpdateProfileBodyDto })
  @ApiOkResponse({ type: ProfileDto })
  @ApiErrorResponse(401, 400)
  async profile(
    @Body() body: UpdateProfileBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.updateProfile(sessionIdOf(req), body ?? {});
    if (result.kind === 'error') return failWith(res, result);
    return result.profile;
  }

  @Post('users/:loginName/password')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Set another user password (privileged)' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: SetPasswordBodyDto })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401, 403, 404, 400)
  async setUserPassword(
    @Param('loginName') loginName: string,
    @Body() body: SetPasswordBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setUserPassword(sessionIdOf(req), loginName, body ?? {});
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
    if (result.kind === 'error') return failWith(res, result);
    if (result.current) res.clearCookie('sid', cookieBase());
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
  @ApiBody({ type: TwoFactorCodeBodyDto })
  @ApiOkResponse({ type: NextAppDto })
  @ApiErrorResponse(401, 400)
  async confirmTwoFactor(
    @Body() body: TwoFactorCodeBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.confirmTwoFactor(sessionIdOf(req), body ?? {}, metaOf(req));
    if (result.kind === 'error') return failWith(res, result);
    if (result.sessionId) setSessionCookie(res, result.sessionId);
    return { next: 'app' };
  }

  @Post('two-factor/verify')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Verify 2FA code during login challenge' })
  @ApiBody({ type: TwoFactorCodeBodyDto })
  @ApiOkResponse({ type: NextAppDto })
  @ApiErrorResponse(401, 400)
  async verifyTwoFactor(
    @Body() body: TwoFactorCodeBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyTwoFactor(sessionIdOf(req), body ?? {}, metaOf(req));
    if (result.kind === 'error') return failWith(res, result);
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
    if (result.kind === 'error') return failWith(res, result);
    return { ok: true };
  }

  @Patch('policy')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Set 2FA policy for a layer' })
  @ApiBody({ type: PolicyBodyDto })
  @ApiErrorResponse(401, 403, 400)
  async policy(
    @Body() body: PolicyBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setPolicy(sessionIdOf(req), body ?? {});
    if (result.kind === 'error') return failWith(res, result);
    return { policy: result.policy };
  }

  @Patch('exemptions/:loginName')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Set 2FA exemption for a login' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: ExemptionBodyDto })
  @ApiOkResponse({ type: TwoFactorExemptDto })
  @ApiErrorResponse(401, 403, 404)
  async exemption(
    @Param('loginName') loginName: string,
    @Body() body: ExemptionBodyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setExemption(sessionIdOf(req), loginName, body ?? {});
    if (result.kind === 'error') return failWith(res, result);
    return { twoFactorExempt: result.twoFactorExempt };
  }
}
