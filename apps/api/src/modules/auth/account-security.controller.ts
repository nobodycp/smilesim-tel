import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponse, ApiZodBody, NotDuplicateGuarded } from '../platform';
import { answer, sessionIdOf } from './auth-http';
import { AuthRecords } from './auth-records';
import { OkDto, TwoFactorExemptDto } from './auth.dto';
import { ExemptionBody, PolicyBody, SessionRulesBody, SetPasswordBody, TwoFactorModeBody, UserContactBody } from './auth.schemas';
import { AuthService } from './auth.service';
import { TwoFactorPolicyService } from './two-factor-policy.service';

// What the branch owner sets for other accounts and for layers (slice R.A): passwords, the second step and its
// policy, session rules, contact fields. Every write is recorded with the account or the layer it was done to.
@ApiTags('auth')
@ApiSecurity('x-door')
@Controller('auth')
@NotDuplicateGuarded('the owner on another account or a layer: each route states a value or a state, so a repeat changes nothing more')
export class AccountSecurityController {
  constructor(
    private readonly auth: AuthService,
    private readonly policies: TwoFactorPolicyService,
    private readonly records: AuthRecords,
  ) {}

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
    await this.records.owner(req, { action: 'password', subjectKind: 'account', subjectRef: loginName }, result);
    return answer(res, result, () => ({ ok: true }));
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
    await this.records.owner(req, { action: 'two_factor', subjectKind: 'account', subjectRef: loginName }, result);
    return answer(res, result, () => ({ ok: true }));
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
    await this.records.owner(req, { action: 'user_freeze', subjectKind: 'account', subjectRef: loginName }, result);
    return answer(res, result, () => ({ ok: true }));
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
    const result = await this.policies.setPolicy(sessionIdOf(req), body);
    await this.records.owner(req, { action: 'two_factor', subjectKind: 'layer', subjectRef: result.kind === 'ok' ? String(body?.layer ?? '') : '' }, result);
    return answer(res, result, ({ policy, endedAccounts }) => ({ policy, endedAccounts }));
  }

  @Get('policy')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: each layer two-step rule (required or optional) and its default method' })
  @ApiErrorResponse(401, 403)
  async readPolicy(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.policies.overview(sessionIdOf(req)), ({ policy }) => ({ policy }));
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
    const result = await this.policies.setExemption(sessionIdOf(req), loginName, body);
    await this.records.owner(req, { action: 'two_factor', subjectKind: 'account', subjectRef: loginName }, result);
    return answer(res, result, ({ twoFactorExempt }) => ({ twoFactorExempt }));
  }

  @Get('session-rules')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: default and per-layer session rules (sessions allowed, idle minutes)' })
  @ApiErrorResponse(401, 403)
  async sessionRules(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.sessionRules(sessionIdOf(req)), (ok) => ok.view);
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
    await this.records.owner(req, { action: 'session_rules', subjectKind: 'layer', subjectRef: layer }, result);
    return answer(res, result, ({ layers }) => ({ layers }));
  }

  @Get('users/:loginName/settings')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: an account email, mobile and second step («إعدادات المستخدم»)' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  async userSettings(@Param('loginName') loginName: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.userSettings(sessionIdOf(req), loginName), (ok) => ok.settings);
  }

  @Patch('users/:loginName/two-factor')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: an account two-step mode (follow its layer, required, optional) and method' })
  @ApiParam({ name: 'loginName' })
  @ApiZodBody(TwoFactorModeBody)
  @ApiErrorResponse(401, 403, 404, 400)
  async setAccountTwoFactor(@Param('loginName') loginName: string, @Body() body: TwoFactorModeBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.policies.setAccountMode(sessionIdOf(req), loginName, body);
    await this.records.owner(req, { action: 'two_factor', subjectKind: 'account', subjectRef: loginName }, result);
    return answer(res, result, ({ settings, endedAccounts }) => ({ settings, endedAccounts }));
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
    await this.records.owner(req, { action: 'user_contact', subjectKind: 'account', subjectRef: loginName }, result);
    return answer(res, result, (ok) => ok.settings);
  }

  @Get('users/:loginName/session-rules')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Branch owner: an account session rules, its layer and the result' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  async userSessionRules(@Param('loginName') loginName: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.userSessionRules(sessionIdOf(req), loginName), (ok) => ok.view);
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
    await this.records.owner(req, { action: 'session_rules', subjectKind: 'account', subjectRef: loginName }, result);
    return answer(res, result, (ok) => ok.view);
  }
}
