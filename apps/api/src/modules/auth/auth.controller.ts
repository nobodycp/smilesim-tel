import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SESSION_TTL_SECONDS } from './sessions';

const BAD_CREDENTIALS = 'بيانات الدخول غير صحيحة';

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
      return { message: BAD_CREDENTIALS };
    }
    const result = await this.auth.login(
      { loginName: body.loginName, password: body.password },
      { userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' },
    );
    if (result.kind === 'error') {
      res.status(result.status);
      return { message: result.message };
    }
    res.cookie('sid', result.sessionId, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      domain: process.env.COOKIE_DOMAIN || undefined,
      sameSite: 'lax',
      maxAge: SESSION_TTL_SECONDS * 1000,
    });
    res.status(200);
    return result.body;
  }
}
