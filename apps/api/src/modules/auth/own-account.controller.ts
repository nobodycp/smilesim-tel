import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponse, ApiZodBody, NoActivity, NotDuplicateGuarded } from '../platform';
import { answer, clearSessionCookie, metaOf, originOf, sessionIdOf, setSessionCookie } from './auth-http';
import { AuthRecords } from './auth-records';
import { NextAppDto, OkDto, OtpauthDto, ProfileDto, SessionsListDto } from './auth.dto';
import { ConfirmMethodBody, PasskeyBody, TwoFactorCodeBody, TwoFactorMethodBody, UpdateProfileBody, profileChangeAction } from './auth.schemas';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkeys';

// What a signed-in account reads and changes of itself (slice R.A): its profile, its sessions, its second step and
// its passkeys. The session is the account; no route here names another.
@ApiTags('auth')
@ApiSecurity('x-door')
@Controller('auth')
@NotDuplicateGuarded('an account on itself: an answer that carries a secret or a challenge is never kept or replayed; each route that changes something has its own equivalent (the current password, a one-time code or challenge, a send limit, a stated value, a delete)')
export class OwnAccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly passkeys: PasskeyService,
    private readonly records: AuthRecords,
  ) {}

  @Get('profile')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Current account profile' })
  @ApiOkResponse({ type: ProfileDto })
  @ApiErrorResponse(401)
  async getProfile(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.getProfile(sessionIdOf(req)), (ok) => ok.profile);
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
    // A new password is a password change; any other field is the account's contact. The record holds the action
    // and the account only, never a password or a field's value.
    await this.records.ownIfSignedIn(req, profileChangeAction(body), result);
    return answer(res, result, (ok) => ok.profile);
  }

  @Get('sessions')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'List sessions for the current account' })
  @ApiOkResponse({ type: SessionsListDto })
  @ApiErrorResponse(401)
  async sessions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.listSessions(sessionIdOf(req)), ({ sessions }) => ({ sessions }));
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
    await this.records.own(req, 'logout', result);
    return answer(res, result, (ok) => {
      if (ok.current) clearSessionCookie(res);
      return { ok: true };
    });
  }

  @Get('sign-in-methods')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'How this account signs in: 2FA method, masked contacts, passkeys' })
  @ApiErrorResponse(401, 403)
  async signInMethods(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.signInMethods(sessionIdOf(req)), (ok) => ok.view);
  }

  @Get('two-factor/methods')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'The methods this account may enrol with: all three, or the one its layer or account fixes' })
  @ApiErrorResponse(401, 403)
  async enrolmentMethods(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.enrolmentMethods(sessionIdOf(req)), ({ allowedMethods }) => ({ allowedMethods }));
  }

  @Post('two-factor/setup')
  @NoActivity('a step: issues a secret; `two-factor/confirm` records the enrolment, success and failure')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Begin 2FA enrollment; returns otpauth URI' })
  @ApiOkResponse({ type: OtpauthDto })
  @ApiErrorResponse(401, 403)
  async setupTwoFactor(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.setupTwoFactor(sessionIdOf(req)), ({ otpauth }) => ({ otpauth }));
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
    await this.records.own(req, 'two_factor', result);
    return answer(res, result, (ok) => {
      if (ok.sessionId) setSessionCookie(res, ok.sessionId);
      return { next: 'app' };
    });
  }

  @Post('two-factor/method')
  @NoActivity('a step: sends a code; `two-factor/method/confirm` records, success and failure')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Choose SMS or email as the 2FA method; sends a code to confirm it' })
  @ApiZodBody(TwoFactorMethodBody)
  @ApiErrorResponse(401, 403, 400)
  async chooseMethod(@Body() body: TwoFactorMethodBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.auth.chooseCodeMethod(sessionIdOf(req), body), ({ sentTo, sent, retryIn }) => ({ sentTo, sent, retryIn }));
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
    await this.records.own(req, 'two_factor', result);
    return answer(res, result, (ok) => {
      if (ok.sessionId) setSessionCookie(res, ok.sessionId);
      return { next: 'app' };
    });
  }

  @Delete('two-factor')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Disable own 2FA' })
  @ApiOkResponse({ type: OkDto })
  @ApiErrorResponse(401)
  async disableTwoFactor(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.disableOwnTwoFactor(sessionIdOf(req));
    // An account turning its own second step off is recorded, as the owner clearing another's is.
    await this.records.ownIfSignedIn(req, 'two_factor', result);
    return answer(res, result, () => ({ ok: true }));
  }

  @Get('passkeys')
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'The passkeys of this account' })
  @ApiErrorResponse(401, 403)
  async listPasskeys(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.passkeys.list(sessionIdOf(req)), ({ passkeys }) => ({ passkeys }));
  }

  @Post('passkeys/options')
  @NoActivity('a step: issues a challenge; `POST passkeys` records, success and failure')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Begin adding a passkey: options for navigator.credentials.create' })
  @ApiErrorResponse(401, 403, 400)
  async passkeyOptions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return answer(res, await this.passkeys.registrationOptions(sessionIdOf(req), originOf(req)), (ok) => ok.options);
  }

  @Post('passkeys')
  @HttpCode(200)
  @ApiCookieAuth('sid')
  @ApiOperation({ summary: 'Finish adding a passkey with the browser answer' })
  @ApiZodBody(PasskeyBody)
  @ApiErrorResponse(401, 403, 400)
  async addPasskey(@Body() body: PasskeyBody, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.passkeys.register(sessionIdOf(req), body);
    await this.records.own(req, 'passkey_add', result);
    return answer(res, result, (ok) => ok.passkey);
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
    // As before slice R.A: a removal is recorded when it is done; a refused one is not.
    if (result.kind === 'ok') await this.records.own(req, 'passkey_remove', result);
    return answer(res, result, () => ({ ok: true }));
  }
}
