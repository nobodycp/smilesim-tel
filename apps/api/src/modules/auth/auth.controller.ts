import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService, Failure } from './auth.service';
import { SESSION_TTL_SECONDS } from './sessions';
import { expectedLayer } from '../../doors';
import { errorBody } from '../../errors';

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

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { loginName?: unknown; password?: unknown },
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
  async changePassword(
    @Body() body: { password?: unknown; nextPassword?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(sessionIdOf(req), body ?? {}, metaOf(req));
    if (result.kind === 'error') return failWith(res, result);
    setSessionCookie(res, result.sessionId);
    return result.body;
  }

  @Get('profile')
  async getProfile(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.getProfile(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return result.profile;
  }

  @Patch('profile')
  @HttpCode(200)
  async profile(
    @Body() body: { nickname?: unknown; email?: unknown; phone?: unknown; nextPassword?: unknown; currentPassword?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.updateProfile(sessionIdOf(req), body ?? {});
    if (result.kind === 'error') return failWith(res, result);
    return result.profile;
  }

  @Post('users/:loginName/password')
  @HttpCode(200)
  async setUserPassword(
    @Param('loginName') loginName: string,
    @Body() body: { password?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setUserPassword(sessionIdOf(req), loginName, body ?? {});
    if (result.kind === 'error') return failWith(res, result);
    return { ok: true };
  }

  @Get('sessions')
  async sessions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.listSessions(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { sessions: result.sessions };
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  async revokeSession(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.revokeSession(sessionIdOf(req), id);
    if (result.kind === 'error') return failWith(res, result);
    if (result.current) res.clearCookie('sid', cookieBase());
    return { ok: true };
  }

  @Post('two-factor/setup')
  @HttpCode(200)
  async setupTwoFactor(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.setupTwoFactor(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { otpauth: result.otpauth };
  }

  @Post('two-factor/confirm')
  @HttpCode(200)
  async confirmTwoFactor(
    @Body() body: { code?: unknown },
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
  async verifyTwoFactor(
    @Body() body: { code?: unknown },
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
  async disableTwoFactor(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.disableOwnTwoFactor(sessionIdOf(req));
    if (result.kind === 'error') return failWith(res, result);
    return { ok: true };
  }

  @Delete('two-factor/:loginName')
  @HttpCode(200)
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
  async policy(
    @Body() body: { layer?: unknown; required?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setPolicy(sessionIdOf(req), body ?? {});
    if (result.kind === 'error') return failWith(res, result);
    return { policy: result.policy };
  }

  @Patch('exemptions/:loginName')
  @HttpCode(200)
  async exemption(
    @Param('loginName') loginName: string,
    @Body() body: { exempt?: unknown },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.setExemption(sessionIdOf(req), loginName, body ?? {});
    if (result.kind === 'error') return failWith(res, result);
    return { twoFactorExempt: result.twoFactorExempt };
  }
}
