import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseFilters, UseInterceptors } from '@nestjs/common';
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
import { OfficeFailure } from './office-failure';
import { OfficeFailureFilter } from './office-failure.filter';
import { OfficeService } from './office.service';
import {
  AccessBodyDto,
  AnnouncementBodyDto,
  CeilingBodyDto,
  CompanyImageBodyDto,
  CompanySimBodyDto,
  CreateUserBodyDto,
  CustomPriceBodyDto,
  ExtendBodyDto,
  FundBodyDto,
  LinePricesBodyDto,
  NoticeReadBodyDto,
  OutcomeBodyDto,
  PackageTargetsBodyDto,
  ProviderModeBodyDto,
  RenameLineBodyDto,
  SellPriceBodyDto,
  SetAccountPasswordBodyDto,
  SwapSimBodyDto,
  UserOpsBodyDto,
  UserPackageBodyDto,
  UserPackagesBulkBodyDto,
  CompleteTaskBodyDto,
  ProviderEsimPriceBodyDto,
  SwitchPackageBodyDto,
  TaskInspectionNoteBodyDto,
  TaskRejectBodyDto,
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


const freeFormObject = {
  type: 'object' as const,
  additionalProperties: true,
  description: 'Free-form JSON object; fields validated in the service',
};

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

  @Get('wallets')
  @ApiOperation({ summary: 'List wallets visible to the session' })
  @ApiErrorResponse(401, 403)
  wallets(@Req() req: Request) {
    return this.office.wallets(gateOf(req));
  }

  @Post('wallets/:loginName/fund')
  @ApiOperation({ summary: 'Fund a wallet (note required)' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: FundBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('fund', 'account', param('loginName'))
  fund(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Body() body: FundBodyDto,
  ) {
    return this.office.fund(gateOf(req), loginName, body);
  }

  @Patch('wallets/:loginName/ceiling')
  @ApiOperation({ summary: 'Set wallet overdraft ceiling' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: CeilingBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  ceiling(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Body() body: CeilingBodyDto,
  ) {
    return this.office.setCeiling(gateOf(req), loginName, body);
  }

  @Get('packages')
  @ApiOperation({ summary: 'Package catalogue for the door' })
  @ApiErrorResponse(401, 403)
  packages(@Req() req: Request) {
    return this.office.packages(gateOf(req));
  }

  @Get('companies')
  @ApiOperation({ summary: 'Companies shelf' })
  @ApiErrorResponse(401, 403)
  companies(@Req() req: Request) {
    return this.office.companiesShelf(gateOf(req));
  }

  @Get('packages/:code/sheet')
  @ApiOperation({ summary: 'Package pricing / chain sheet' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  packageSheet(@Req() req: Request, @Param('code') code: string) {
    return this.office.packageSheet(gateOf(req), code);
  }

  @Patch('packages/:code/chain')
  @ApiOperation({ summary: 'Update package price chain' })
  @ApiParam({ name: 'code' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_chain', 'package', param('code'))
  packageChain(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.office.setChain(gateOf(req), code, body);
  }

  @Put('packages/:code/renewals')
  @ApiOperation({ summary: 'Set renewal targets for a package' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: PackageTargetsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  packageRenewals(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: PackageTargetsBodyDto,
  ) {
    return this.office.setPackageTargets(gateOf(req), code, 'renewals', body);
  }

  @Put('packages/:code/switches')
  @ApiOperation({ summary: 'Set switch targets for a package' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: PackageTargetsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  packageSwitches(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: PackageTargetsBodyDto,
  ) {
    return this.office.setPackageTargets(gateOf(req), code, 'switches', body);
  }

  @Get('packages/:code/custom-prices')
  @ApiOperation({ summary: 'Accounts whose price for this package differs from their default' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  customPrices(@Req() req: Request, @Param('code') code: string) {
    return this.office.customPrices(gateOf(req), code);
  }

  @Put('packages/:code/custom-prices/:loginName')
  @ApiOperation({ summary: 'Set a special price for one account on this package' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: CustomPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', (req) => `${param('loginName')(req)}:${param('code')(req)}`)
  setCustomPrice(
    @Req() req: Request,
    @Param('code') code: string,
    @Param('loginName') loginName: string,
    @Body() body: CustomPriceBodyDto,
  ) {
    return this.office.setCustomPrice(gateOf(req), code, loginName, body);
  }

  @Delete('packages/:code/custom-prices/:loginName')
  @ApiOperation({ summary: 'Return an account to the default price for this package' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('user_package', 'user', (req) => `${param('loginName')(req)}:${param('code')(req)}`)
  clearCustomPrice(
    @Req() req: Request,
    @Param('code') code: string,
    @Param('loginName') loginName: string,
  ) {
    return this.office.clearCustomPrice(gateOf(req), code, loginName);
  }

  @Get('packages/:code/line-prices')
  @ApiOperation({ summary: 'The renewable numbers of this package grouped by the renewal price they carry' })
  @ApiParam({ name: 'code' })
  @ApiQuery({ name: 'scope', required: true, description: 'An account login (that account and everything under it) or "all" (branch only)' })
  @ApiErrorResponse(401, 403, 400, 404)
  linePrices(
    @Req() req: Request,
    @Param('code') code: string,
    @Query('scope') scope?: string,
  ) {
    return this.office.linePrices(gateOf(req), code, { scope });
  }

  @Put('packages/:code/line-prices')
  @ApiOperation({ summary: 'Reprice the renewable numbers of this package, one price group at a time' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: LinePricesBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_reprice', 'package', param('code'))
  setLinePrices(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: LinePricesBodyDto,
  ) {
    return this.office.setLinePrices(gateOf(req), code, body);
  }

  @Patch('packages/:code/mode')
  @ApiOperation({ summary: 'Set package sale/visibility mode flags' })
  @ApiParam({ name: 'code' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('package_mode', 'package', param('code'))
  packageMode(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.office.setPackageMode(gateOf(req), code, body);
  }

  @Put('sell-prices/:code')
  @ApiOperation({ summary: "Set the caller's own sell price for a package (main agent or agent)" })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: SellPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('sell_price', 'package', param('code'))
  setSellPrice(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: SellPriceBodyDto,
  ) {
    return this.office.setSellPrice(gateOf(req), code, body);
  }

  @Delete('sell-prices/:code')
  @ApiOperation({ summary: "Clear the caller's own sell price for a package; the layer column applies again" })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('sell_price', 'package', param('code'))
  clearSellPrice(@Req() req: Request, @Param('code') code: string) {
    return this.office.clearSellPrice(gateOf(req), code);
  }

  @Post('companies/image')
  @ApiOperation({ summary: 'Set company mark / image' })
  @ApiBody({ type: CompanyImageBodyDto })
  @ApiErrorResponse(401, 403, 400)
  companyImage(@Req() req: Request, @Body() body: CompanyImageBodyDto) {
    return this.office.setCompanyImage(gateOf(req), body);
  }

  @Put('companies/:code/sim')
  @ApiOperation({ summary: 'Set company SIM rules (ICCID length, prefix, eSIM)' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: CompanySimBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('company_sim', 'company', param('code'))
  companySim(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: CompanySimBodyDto,
  ) {
    return this.office.setCompanySim(gateOf(req), code, body);
  }

  @Get('providers')
  @ApiOperation({ summary: 'Provider list' })
  @ApiErrorResponse(401, 403)
  providers(@Req() req: Request) {
    return this.office.providers(gateOf(req));
  }

  @Get('providers/:code/settings')
  @ApiOperation({ summary: 'Provider settings including default run modes' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  providerSettings(@Req() req: Request, @Param('code') code: string) {
    return this.office.providerSettings(gateOf(req), code);
  }

  @Patch('providers/:code/esim-price')
  @ApiOperation({ summary: 'Set or clear the provider eSIM price override' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: ProviderEsimPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_esim_price', 'provider', param('code'))
  setProviderEsimPrice(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: ProviderEsimPriceBodyDto,
  ) {
    return this.office.setProviderEsimPrice(gateOf(req), code, body);
  }

  @Patch('providers/:code/settings')
  @ApiOperation({ summary: 'Set one provider default run mode (does not touch packages)' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: ProviderModeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('provider_mode', 'provider', param('code'))
  setProviderMode(
    @Req() req: Request,
    @Param('code') code: string,
    @Body() body: ProviderModeBodyDto,
  ) {
    return this.office.setProviderMode(gateOf(req), code, body as Record<string, unknown>);
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

  @Get('notices')
  @ApiOperation({ summary: 'Notices inbox (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'group', required: false, enum: ['tasks', 'wallet', 'announcements'] })
  @ApiQuery({ name: 'unread', required: false })
  @ApiErrorResponse(401, 403)
  notices(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('group') group?: string,
    @Query('unread') unread?: string,
  ) {
    return this.office.notices(gateOf(req), { cursor: text(cursor), group: text(group), unread: text(unread) });
  }

  @Get('notices/stream')
  @ApiOperation({ summary: 'Live notices for the signed-in user (server-sent events)' })
  @ApiErrorResponse(401)
  async noticeStream(@Req() req: Request, @Res() res: Response) {
    let unsubscribe: (() => Promise<void>) | null = null;
    try {
      unsubscribe = await this.office.subscribeNotices(gateOf(req), (message) => {
        res.write(`event: notice\ndata: ${message}\n\n`);
      });
    } catch (error) {
      if (error instanceof OfficeFailure) {
        res.status(error.status).json({ message: error.message, code: error.code });
        return;
      }
      throw error;
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': open\n\n');
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    const close = () => {
      clearInterval(heartbeat);
      void unsubscribe?.();
      unsubscribe = null;
    };
    req.on('close', close);
    res.on('error', close);
  }

  @Post('notices/read')
  @ApiOperation({ summary: 'Mark notice(s) read' })
  @ApiBody({ type: NoticeReadBodyDto })
  @ApiErrorResponse(401, 403)
  readNotices(@Req() req: Request, @Body() body: NoticeReadBodyDto) {
    const id = typeof body.id === 'string' ? body.id : undefined;
    return this.office.readNotices(gateOf(req), id);
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Paged tasks' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'packageCode', required: false })
  @ApiQuery({ name: 'company', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiErrorResponse(401, 403)
  tasks(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('action') action?: string,
    @Query('packageCode') packageCode?: string,
    @Query('company') company?: string,
    @Query('provider') provider?: string,
  ) {
    return this.office.tasks(gateOf(req), {
        cursor: text(cursor),
        q: text(q),
        status: text(status),
        action: text(action),
        packageCode: text(packageCode),
        company: text(company),
        provider: text(provider),
      });
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Task ticket detail with timeline' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  task(@Req() req: Request, @Param('id') id: string) {
    return this.office.task(gateOf(req), id);
  }

  @Post('tasks/:id/notes')
  @ApiOperation({ summary: 'Add inspection note without closing the task' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: TaskInspectionNoteBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('task_note', 'task', param('id'))
  addTaskNote(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: TaskInspectionNoteBodyDto,
  ) {
    return this.office.addTaskNote(gateOf(req), id, body);
  }

  @Post('tasks/:id/take')
  @ApiOperation({ summary: 'Take a task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('task_take', 'task', param('id'))
  take(@Req() req: Request, @Param('id') id: string) {
    return this.office.takeTask(gateOf(req), id);
  }

  @Post('tasks/:id/release')
  @ApiOperation({ summary: 'Release a taken task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('task_release', 'task', param('id'))
  release(@Req() req: Request, @Param('id') id: string) {
    return this.office.releaseTask(gateOf(req), id);
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

  @Post('tasks/:id/reject')
  @ApiOperation({ summary: 'Reject a task' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: TaskRejectBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('task_reject', 'task', param('id'))
  reject(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: TaskRejectBodyDto,
  ) {
    return this.office.rejectTask(gateOf(req), id, body);
  }

  @Post('tasks/:id/cancel')
  @ApiOperation({ summary: 'Cancel a task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  @Activity('task_cancel', 'task', param('id'))
  cancel(@Req() req: Request, @Param('id') id: string) {
    return this.office.cancelTask(gateOf(req), id);
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

  @Get('users/:loginName/packages')
  @ApiOperation({ summary: 'Packages as this account sees and pays for them' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  userPackages(@Req() req: Request, @Param('loginName') loginName: string) {
    return this.office.userPackages(gateOf(req), loginName);
  }

  @Put('users/:loginName/packages')
  @ApiOperation({ summary: 'Hide or show several packages for this account' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: UserPackagesBulkBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', param('loginName'))
  setUserPackagesBulk(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Body() body: UserPackagesBulkBodyDto,
  ) {
    return this.office.setUserPackagesBulk(gateOf(req), loginName, body);
  }

  @Put('users/:loginName/packages/:code')
  @ApiOperation({ summary: 'Hide, show, or price one package for this account' })
  @ApiParam({ name: 'loginName' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: UserPackageBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_package', 'user', (req) => `${param('loginName')(req)}:${param('code')(req)}`)
  setUserPackage(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Param('code') code: string,
    @Body() body: UserPackageBodyDto,
  ) {
    return this.office.setUserPackage(gateOf(req), loginName, code, body);
  }

  @Get('users/:loginName/ops')
  @ApiOperation({ summary: 'Line operations stopped on this account, own and inherited' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  userOps(@Req() req: Request, @Param('loginName') loginName: string) {
    return this.office.userOps(gateOf(req), loginName);
  }

  @Put('users/:loginName/ops')
  @ApiOperation({ summary: 'Set the line operations stopped on this account' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: UserOpsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  @Activity('user_ops', 'user', param('loginName'))
  setUserOps(
    @Req() req: Request,
    @Param('loginName') loginName: string,
    @Body() body: UserOpsBodyDto,
  ) {
    return this.office.setUserOps(gateOf(req), loginName, body);
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

  @Get('audit')
  @ApiOperation({ summary: 'Activity log (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'result', required: false })
  @ApiQuery({ name: 'layer', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiErrorResponse(401, 403)
  audit(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('action') action?: string,
    @Query('result') result?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.office.audit(gateOf(req), {
      cursor: text(cursor),
      action: text(action),
      result: text(result),
      layer: text(layer),
      q: text(q),
      from: text(from),
      to: text(to),
    });
  }

  @Get('provider-operations')
  @ApiOperation({ summary: 'Line operations with the branch cost at the provider (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'provider', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiErrorResponse(401, 403)
  providerOperations(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: string,
    @Query('provider') provider?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.office.providerOperations(gateOf(req), {
      cursor: text(cursor),
      kind: text(kind),
      provider: text(provider),
      q: text(q),
      from: text(from),
      to: text(to),
    });
  }

  @Get('finance')
  @ApiOperation({ summary: 'Financial movements for the visible accounts (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'layer', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiErrorResponse(401, 403)
  finance(
    @Req() req: Request,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.office.finance(gateOf(req), {
      cursor: text(cursor),
      kind: text(kind),
      layer: text(layer),
      q: text(q),
      from: text(from),
      to: text(to),
    });
  }

  @Get('ledger/:scope')
  @ApiOperation({ summary: 'Ledger for a scope' })
  @ApiParam({ name: 'scope' })
  @ApiQuery({ name: 'kind', required: false })
  @ApiQuery({ name: 'direction', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiErrorResponse(401, 403)
  ledger(
    @Req() req: Request,
    @Param('scope') scope: string,
    @Query('kind') kind?: string,
    @Query('direction') direction?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.office.ledger(gateOf(req), scope, { kind, direction, from, to, cursor: text(cursor) });
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
