import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseFilters, UseInterceptors } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { SESSION_TTL_SECONDS } from '../auth/sessions';
import { ApiErrorResponse } from '../../openapi/responses';
import { Activity, bodyField, param } from './activity.decorator';
import { ActivityInterceptor } from './activity.interceptor';
import { gateOf, readCookie } from './gate';
import { freeFormObject } from './kernel/query';
import { OfficeFailureFilter } from '../shared/office-failure.filter';
import { OfficeService } from './office.service';
import {
  AccessBodyDto,
  AnnouncementBodyDto,
  CreateUserBodyDto,
  ExtendBodyDto,
  OutcomeBodyDto,
  RenameLineBodyDto,
  SetAccountPasswordBodyDto,
  SwapSimBodyDto,
  CompleteTaskBodyDto,
  SwitchPackageBodyDto,
  TransferAccountBodyDto,
  TransferLineBodyDto,
} from './office.dto';

function cookieBase(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    domain: process.env.COOKIE_DOMAIN || undefined,
    sameSite: 'lax',
    path: '/',
  };
}

/** A query value is a string or nothing; a repeated or nested one is ignored. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

@ApiTags('office')
@ApiCookieAuth('sid')
@ApiSecurity('x-door')
@Controller('office')
@UseFilters(OfficeFailureFilter)
@UseInterceptors(ActivityInterceptor)
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current office identity, balance, grants' })
  @ApiErrorResponse(401, 403)
  me(@Req() req: Request) {
    return this.office.me(gateOf(req));
  }

  @Get('home')
  @ApiOperation({ summary: 'Home desk payload (stats, shortcuts, panes)' })
  @ApiErrorResponse(401, 403)
  home(@Req() req: Request) {
    return this.office.home(gateOf(req));
  }

  @Post('announcements')
  @ApiOperation({ summary: 'Post a desk announcement' })
  @ApiBody({ type: AnnouncementBodyDto })
  @ApiErrorResponse(401, 403, 400)
  postAnnouncement(@Req() req: Request, @Body() body: AnnouncementBodyDto) {
    return this.office.postAnnouncement(gateOf(req), body);
  }

  @Get('lines')
  @ApiOperation({ summary: 'Paged lines / SIMs' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'packageCode', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'company', required: false })
  @ApiErrorResponse(401, 403)
  lines(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('packageCode') packageCode?: string,
    @Query('provider') provider?: string,
    @Query('company') company?: string,
  ) {
    return this.office.lines(gateOf(req), {
        cursor: text(cursor),
        q: text(q),
        status: text(status),
        packageCode: text(packageCode),
        provider: text(provider),
        company: text(company),
      });
  }

  @Get('lines/:id')
  @ApiOperation({ summary: 'Single line detail' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  line(@Req() req: Request, @Param('id') id: string) {
    return this.office.line(gateOf(req), id);
  }

  @Post('lines')
  @ApiOperation({ summary: 'Activate a new line' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400)
  @Activity('activate', 'line', bodyField('msisdn'))
  activate(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.office.activate(gateOf(req), body);
  }

  @Post('lines/:id/company-switch')
  @ApiOperation({ summary: 'Switch the carrier. Fields are not defined yet, so the request is rejected.' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('company_switch', 'line', param('id'))
  companySwitch() {
    return this.office.companySwitch();
  }

  @Post('lines/:id/charge')
  @ApiOperation({ summary: 'Charge / top-up a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('charge', 'line', param('id'))
  charge(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.operate(gateOf(req), id, 'charge', body);
  }

  @Post('lines/:id/refresh')
  @ApiOperation({ summary: 'Update a line without changing its fields' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('refresh', 'line', param('id'))
  refresh(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.refreshLine(gateOf(req), id, body);
  }

  @Get('lines/:id/disconnect-quote')
  @ApiOperation({ summary: 'What a disconnect would return to the point of sale now, and whether it runs at once' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  disconnectQuote(@Req() req: Request, @Param('id') id: string) {
    return this.office.disconnectQuote(gateOf(req), id);
  }

  @Post('lines/:id/disconnect')
  @ApiOperation({ summary: 'Disconnect a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('disconnect', 'line', param('id'))
  disconnect(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.operate(gateOf(req), id, 'disconnect', body);
  }

  @Post('lines/:id/unfreeze')
  @ApiOperation({ summary: 'Unfreeze a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('unfreeze', 'line', param('id'))
  unfreeze(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.operate(gateOf(req), id, 'unfreeze', body);
  }

  @Post('lines/:id/freeze')
  @ApiOperation({ summary: 'Freeze a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('freeze', 'line', param('id'))
  freeze(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.operate(gateOf(req), id, 'freeze', body);
  }

  @Post('lines/:id/extend')
  @ApiOperation({ summary: 'Extend a line subscription' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: ExtendBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('extend', 'line', param('id'))
  extend(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ExtendBodyDto,
  ) {
    return this.office.extend(gateOf(req), id, body);
  }

  @Post('lines/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('reactivate', 'line', param('id'))
  reactivate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.office.reactivate(gateOf(req), id, body);
  }

  @Post('lines/:id/rename')
  @ApiOperation({ summary: 'Rename / change MSISDN on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: RenameLineBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('rename', 'line', param('id'))
  rename(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RenameLineBodyDto,
  ) {
    return this.office.renameLine(gateOf(req), id, body);
  }

  @Post('lines/:id/esim')
  @ApiOperation({ summary: 'Request an eSIM for a line; always a branch task priced from the company, provider, or package' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('esim', 'line', param('id'))
  requestEsim(@Req() req: Request, @Param('id') id: string) {
    return this.office.requestEsim(gateOf(req), id);
  }

  @Post('lines/:id/sim')
  @ApiOperation({ summary: 'Swap to a SIM the branch already holds (physical or eSIM); free' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwapSimBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('sim', 'line', param('id'))
  swapSim(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SwapSimBodyDto,
  ) {
    return this.office.swapSim(gateOf(req), id, body);
  }

  @Post('lines/:id/transfer')
  @ApiOperation({ summary: 'Transfer a line to another POS' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: TransferLineBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  transferLine(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: TransferLineBodyDto,
  ) {
    return this.office.transferLine(gateOf(req), id, body);
  }

  @Post('lines/:id/switch')
  @ApiOperation({ summary: 'Switch package on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwitchPackageBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('switch', 'line', param('id'))
  switchPackage(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SwitchPackageBodyDto,
  ) {
    return this.office.switchPackage(gateOf(req), id, body);
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Complete a task; an eSIM request takes the serial and QR, a number change takes the new number' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: CompleteTaskBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('task_complete', 'task', param('id'))
  complete(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CompleteTaskBodyDto,
  ) {
    return this.office.completeTask(gateOf(req), id, body);
  }

  @Get('users')
  @ApiOperation({ summary: 'Users list for the door' })
  @ApiErrorResponse(401, 403)
  users(@Req() req: Request) {
    return this.office.users(gateOf(req));
  }

  @Get('directory')
  @ApiOperation({ summary: 'Login name → full name for the accounts the actor may meet on a screen' })
  @ApiErrorResponse(401, 403)
  directory(@Req() req: Request) {
    return this.office.directory(gateOf(req));
  }

  @Get('users/:loginName')
  @ApiOperation({ summary: 'Single account detail' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  account(@Req() req: Request, @Param('loginName') loginName: string) {
    return this.office.account(gateOf(req), loginName);
  }

  @Patch('users/:loginName/access')
  @ApiOperation({ summary: 'Save grants / roles for an account' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: AccessBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('access', 'account', param('loginName'))
  saveAccess(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Body() body: AccessBodyDto,
  ) {
    return this.office.saveAccess(gateOf(req), loginName, body);
  }

  @Get('roles')
  @ApiOperation({ summary: 'Roles catalogue' })
  @ApiErrorResponse(401, 403)
  roles(@Req() req: Request) {
    return this.office.roles(gateOf(req));
  }

  @Post('roles')
  @ApiOperation({ summary: 'Create or update a role' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400)
  saveRole(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.office.saveRole(gateOf(req), body);
  }

  @Post('users')
  @ApiOperation({ summary: 'Create an account under this door' })
  @ApiBody({ type: CreateUserBodyDto })
  @ApiErrorResponse(401, 403, 400)
  @Activity('user_create', 'account', bodyField('loginName'))
  createUser(
    @Req() req: Request,
    @Body() body: CreateUserBodyDto,
  ) {
    return this.office.createAccount(gateOf(req), body);
  }

  @Post('users/:loginName/transfer')
  @ApiOperation({ summary: 'Transfer a point of sale or an agent to another parent, with an explicit choice for what travels with it' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: TransferAccountBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_transfer', 'user', param('loginName'))
  transferAccount(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Body() body: TransferAccountBodyDto,
  ) {
    return this.office.transferAccount(gateOf(req), loginName, body);
  }

  @Get('users/:loginName/transfer-preview')
  @ApiOperation({ summary: 'What moving an account under another parent would carry; refuses as the move does' })
  @ApiParam({ name: 'loginName' })
  @ApiQuery({ name: 'parentLogin', required: true, description: 'The login of the new parent' })
  @ApiErrorResponse(401, 403, 400)
  transferPreview(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Query('parentLogin') parentLogin?: unknown,
  ) {
    return this.office.transferPreview(gateOf(req), loginName, { parentLogin });
  }

  @Post('users/:loginName/password')
  @ApiOperation({ summary: 'Set account password (office)' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: SetAccountPasswordBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('password', 'account', param('loginName'))
  setUserPassword(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Body() body: SetAccountPasswordBodyDto,
  ) {
    return this.office.setAccountPassword(gateOf(req), loginName, body);
  }

  @Post('users/:loginName/freeze')
  @ApiOperation({ summary: 'Freeze an account' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('user_freeze', 'account', param('loginName'))
  freezeUser(@Req() req: Request, @Param('loginName') loginName: string) {
    return this.office.setFrozen(gateOf(req), loginName, true);
  }

  @Post('users/:loginName/restore')
  @ApiOperation({ summary: 'Restore a frozen account' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('user_restore', 'account', param('loginName'))
  restoreUser(@Req() req: Request, @Param('loginName') loginName: string) {
    return this.office.setFrozen(gateOf(req), loginName, false);
  }

  @Delete('users/:loginName')
  @ApiOperation({ summary: 'Delete an account (no history)' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404, 400)
  @Activity('user_delete', 'account', param('loginName'))
  removeUser(@Req() req: Request, @Param('loginName') loginName: string) {
    return this.office.removeUser(gateOf(req), loginName);
  }

  @Post('users/:loginName/enter')
  @ApiOperation({ summary: 'Impersonate / enter an account; sets `home` + `sid` cookies' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('enter', 'account', param('loginName'))
  async enter(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
  ) {
    const previous = readCookie(req, 'sid');
    const result = await this.office.enter(gateOf(req), loginName, { userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' });
    if (result && typeof result === 'object' && 'sessionId' in result && typeof result.sessionId === 'string' && previous) {
      res.cookie('home', previous, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS * 1000 });
      res.cookie('sid', result.sessionId, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS * 1000 });
    }
    return result;
  }

  @Post('leave')
  @ApiOperation({ summary: 'Leave impersonation; restores `sid` from `home`' })
  @ApiErrorResponse(401, 403)
  @Activity('leave', 'account')
  async leave(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const home = readCookie(req, 'home');
    const result = await this.office.leave(gateOf(req));
    if (result && typeof result === 'object' && 'ok' in result && home) {
      res.cookie('sid', home, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS * 1000 });
      res.clearCookie('home', cookieBase());
    }
    return result;
  }

  @Get('reports/:kind')
  @ApiOperation({ summary: 'Report by kind (branch-gated kinds exist)' })
  @ApiParam({ name: 'kind' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiErrorResponse(401, 403)
  report(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.office.report(gateOf(req), kind, text(cursor));
  }

}
