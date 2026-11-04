import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
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
import { OfficeFailure, OfficeService } from './office.service';
import {
  AccessBodyDto,
  AnnouncementBodyDto,
  CeilingBodyDto,
  CompanyImageBodyDto,
  CreateUserBodyDto,
  ExtendBodyDto,
  FundBodyDto,
  NoticeReadBodyDto,
  OfferBodyDto,
  OutcomeBodyDto,
  PackagePriceBodyDto,
  PackageTargetsBodyDto,
  ProviderModeBodyDto,
  RenameLineBodyDto,
  RepriceRenewalBodyDto,
  SetAccountPasswordBodyDto,
  SwapSimBodyDto,
  SwitchPackageBodyDto,
  TaskInspectionNoteBodyDto,
  TaskNoteBodyDto,
  TaskRejectBodyDto,
  TransferLineBodyDto,
  TransferPosBodyDto,
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

function readCookie(req: Request, name: string): string | undefined {
  const parsed = (req as Request & { cookies?: Record<string, unknown> }).cookies?.[name];
  if (typeof parsed === 'string' && parsed) return parsed;
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim()) || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** A query value is a string or nothing; a repeated or nested one is ignored. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function gateOf(req: Request) {
  return { sessionId: readCookie(req, 'sid'), homeId: readCookie(req, 'home') };
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
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current office identity, balance, grants' })
  @ApiErrorResponse(401, 403)
  me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.me(gateOf(req)));
  }

  @Get('home')
  @ApiOperation({ summary: 'Home desk payload (stats, shortcuts, panes)' })
  @ApiErrorResponse(401, 403)
  home(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.home(gateOf(req)));
  }

  @Post('announcements')
  @ApiOperation({ summary: 'Post a desk announcement' })
  @ApiBody({ type: AnnouncementBodyDto })
  @ApiErrorResponse(401, 403, 400)
  postAnnouncement(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: AnnouncementBodyDto) {
    return this.run(res, () => this.office.postAnnouncement(gateOf(req), body));
  }

  @Get('wallets')
  @ApiOperation({ summary: 'List wallets visible to the session' })
  @ApiErrorResponse(401, 403)
  wallets(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.wallets(gateOf(req)));
  }

  @Post('wallets/:loginName/fund')
  @ApiOperation({ summary: 'Fund a wallet (note required)' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: FundBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  fund(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: FundBodyDto,
  ) {
    return this.run(res, () => this.office.fund(gateOf(req), loginName, body));
  }

  @Patch('wallets/:loginName/ceiling')
  @ApiOperation({ summary: 'Set wallet overdraft ceiling' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: CeilingBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  ceiling(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: CeilingBodyDto,
  ) {
    return this.run(res, () => this.office.setCeiling(gateOf(req), loginName, body));
  }

  @Get('packages')
  @ApiOperation({ summary: 'Package catalogue for the door' })
  @ApiErrorResponse(401, 403)
  packages(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.packages(gateOf(req)));
  }

  @Get('companies')
  @ApiOperation({ summary: 'Companies shelf' })
  @ApiErrorResponse(401, 403)
  companies(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.companiesShelf(gateOf(req)));
  }

  @Get('packages/:code/sheet')
  @ApiOperation({ summary: 'Package pricing / chain sheet' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  packageSheet(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string) {
    return this.run(res, () => this.office.packageSheet(gateOf(req), code));
  }

  @Patch('packages/:code/chain')
  @ApiOperation({ summary: 'Update package price chain' })
  @ApiParam({ name: 'code' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400, 404)
  packageChain(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.run(res, () => this.office.setChain(gateOf(req), code, body));
  }

  @Post('packages/:code/reprice-renewal')
  @ApiOperation({ summary: 'Reprice active renewals for a package' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: RepriceRenewalBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  repriceRenewal(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: RepriceRenewalBodyDto,
  ) {
    return this.run(res, () => this.office.repriceActiveRenewal(gateOf(req), code, body));
  }

  @Put('packages/:code/renewals')
  @ApiOperation({ summary: 'Set renewal targets for a package' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: PackageTargetsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  packageRenewals(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: PackageTargetsBodyDto,
  ) {
    return this.run(res, () => this.office.setPackageTargets(gateOf(req), code, 'renewals', body));
  }

  @Put('packages/:code/switches')
  @ApiOperation({ summary: 'Set switch targets for a package' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: PackageTargetsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  packageSwitches(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: PackageTargetsBodyDto,
  ) {
    return this.run(res, () => this.office.setPackageTargets(gateOf(req), code, 'switches', body));
  }

  @Put('packages/:code/offers')
  @ApiOperation({ summary: 'Save a special offer price for a login' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: OfferBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  saveOffer(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: OfferBodyDto,
  ) {
    return this.run(res, () => this.office.saveOffer(gateOf(req), code, body));
  }

  @Delete('packages/:code/offers/:loginName')
  @ApiOperation({ summary: 'Remove a special offer' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  removeOffer(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Param('loginName') loginName: string,
  ) {
    return this.run(res, () => this.office.removeOffer(gateOf(req), code, loginName));
  }

  @Patch('packages/:code/mode')
  @ApiOperation({ summary: 'Set package sale/visibility mode flags' })
  @ApiParam({ name: 'code' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400, 404)
  packageMode(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.run(res, () => this.office.setPackageMode(gateOf(req), code, body));
  }

  @Patch('packages/:code/price')
  @ApiOperation({ summary: 'Set sell price for a package at this layer' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: PackagePriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  price(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: PackagePriceBodyDto,
  ) {
    return this.run(res, () => this.office.setPrice(gateOf(req), code, body));
  }

  @Post('companies/image')
  @ApiOperation({ summary: 'Set company mark / image' })
  @ApiBody({ type: CompanyImageBodyDto })
  @ApiErrorResponse(401, 403, 400)
  companyImage(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: CompanyImageBodyDto) {
    return this.run(res, () => this.office.setCompanyImage(gateOf(req), body));
  }

  @Get('providers')
  @ApiOperation({ summary: 'Provider list' })
  @ApiErrorResponse(401, 403)
  providers(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.providers(gateOf(req)));
  }

  @Get('providers/:code/settings')
  @ApiOperation({ summary: 'Provider settings including default run modes' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  providerSettings(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string) {
    return this.run(res, () => this.office.providerSettings(gateOf(req), code));
  }

  @Patch('providers/:code/settings')
  @ApiOperation({ summary: 'Set one provider default run mode (does not touch packages)' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: ProviderModeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setProviderMode(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: ProviderModeBodyDto,
  ) {
    return this.run(res, () => this.office.setProviderMode(gateOf(req), code, body as Record<string, unknown>));
  }

  @Get('lines')
  @ApiOperation({ summary: 'Paged lines / SIMs' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'packageCode', required: false })
  @ApiErrorResponse(401, 403)
  lines(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('packageCode') packageCode?: string,
  ) {
    return this.run(res, () =>
      this.office.lines(gateOf(req), {
        cursor: text(cursor),
        q: text(q),
        status: text(status),
        packageCode: text(packageCode),
      }),
    );
  }

  @Get('lines/:id')
  @ApiOperation({ summary: 'Single line detail' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  line(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.line(gateOf(req), id));
  }

  @Post('lines')
  @ApiOperation({ summary: 'Activate a new line' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400)
  activate(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: Record<string, unknown>) {
    return this.run(res, () => this.office.activate(gateOf(req), body));
  }

  @Post('lines/:id/charge')
  @ApiOperation({ summary: 'Charge / top-up a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  charge(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.run(res, () => this.office.operate(gateOf(req), id, 'charge', body));
  }

  @Post('lines/:id/disconnect')
  @ApiOperation({ summary: 'Disconnect a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  disconnect(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.run(res, () => this.office.operate(gateOf(req), id, 'disconnect', body));
  }

  @Post('lines/:id/unfreeze')
  @ApiOperation({ summary: 'Unfreeze a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  unfreeze(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.run(res, () => this.office.operate(gateOf(req), id, 'unfreeze', body));
  }

  @Post('lines/:id/freeze')
  @ApiOperation({ summary: 'Freeze a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  freeze(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.run(res, () => this.office.operate(gateOf(req), id, 'freeze', body));
  }

  @Post('lines/:id/extend')
  @ApiOperation({ summary: 'Extend a line subscription' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: ExtendBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  extend(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: ExtendBodyDto,
  ) {
    return this.run(res, () => this.office.extend(gateOf(req), id, body));
  }

  @Post('lines/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  reactivate(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.run(res, () => this.office.reactivate(gateOf(req), id, body));
  }

  @Post('lines/:id/rename')
  @ApiOperation({ summary: 'Rename / change MSISDN on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: RenameLineBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  rename(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: RenameLineBodyDto,
  ) {
    return this.run(res, () => this.office.renameLine(gateOf(req), id, body));
  }

  @Post('lines/:id/sim')
  @ApiOperation({ summary: 'Swap SIM (ICCID) on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwapSimBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  swapSim(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: SwapSimBodyDto,
  ) {
    return this.run(res, () => this.office.swapSim(gateOf(req), id, body));
  }

  @Post('lines/:id/transfer')
  @ApiOperation({ summary: 'Transfer a line to another POS' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: TransferLineBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  transferLine(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: TransferLineBodyDto,
  ) {
    return this.run(res, () => this.office.transferLine(gateOf(req), id, body));
  }

  @Post('lines/:id/switch')
  @ApiOperation({ summary: 'Switch package on a line' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwitchPackageBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  switchPackage(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: SwitchPackageBodyDto,
  ) {
    return this.run(res, () => this.office.switchPackage(gateOf(req), id, body));
  }

  @Get('notices')
  @ApiOperation({ summary: 'Notices inbox' })
  @ApiErrorResponse(401, 403)
  notices(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.notices(gateOf(req)));
  }

  @Post('notices/read')
  @ApiOperation({ summary: 'Mark notice(s) read' })
  @ApiBody({ type: NoticeReadBodyDto })
  @ApiErrorResponse(401, 403)
  readNotices(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: NoticeReadBodyDto) {
    const id = typeof body.id === 'string' ? body.id : undefined;
    return this.run(res, () => this.office.readNotices(gateOf(req), id));
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
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('action') action?: string,
    @Query('packageCode') packageCode?: string,
    @Query('company') company?: string,
    @Query('provider') provider?: string,
  ) {
    return this.run(res, () =>
      this.office.tasks(gateOf(req), {
        cursor: text(cursor),
        q: text(q),
        status: text(status),
        action: text(action),
        packageCode: text(packageCode),
        company: text(company),
        provider: text(provider),
      }),
    );
  }

  @Get('tasks/:id')
  @ApiOperation({ summary: 'Task ticket detail with timeline' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  task(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.task(gateOf(req), id));
  }

  @Post('tasks/:id/notes')
  @ApiOperation({ summary: 'Add inspection note without closing the task' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: TaskInspectionNoteBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  addTaskNote(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: TaskInspectionNoteBodyDto,
  ) {
    return this.run(res, () => this.office.addTaskNote(gateOf(req), id, body));
  }

  @Post('tasks/:id/take')
  @ApiOperation({ summary: 'Take a task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  take(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.takeTask(gateOf(req), id));
  }

  @Post('tasks/:id/release')
  @ApiOperation({ summary: 'Release a taken task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  release(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.releaseTask(gateOf(req), id));
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Complete a task' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: TaskNoteBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  complete(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: TaskNoteBodyDto,
  ) {
    return this.run(res, () => this.office.completeTask(gateOf(req), id, body));
  }

  @Post('tasks/:id/reject')
  @ApiOperation({ summary: 'Reject a task' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: TaskRejectBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  reject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: TaskRejectBodyDto,
  ) {
    return this.run(res, () => this.office.rejectTask(gateOf(req), id, body));
  }

  @Post('tasks/:id/cancel')
  @ApiOperation({ summary: 'Cancel a task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  cancel(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.cancelTask(gateOf(req), id));
  }

  @Get('users')
  @ApiOperation({ summary: 'Users list for the door' })
  @ApiErrorResponse(401, 403)
  users(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.users(gateOf(req)));
  }

  @Get('users/:loginName')
  @ApiOperation({ summary: 'Single account detail' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  account(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.account(gateOf(req), loginName));
  }

  @Patch('users/:loginName/access')
  @ApiOperation({ summary: 'Save grants / roles for an account' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: AccessBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  saveAccess(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: AccessBodyDto,
  ) {
    return this.run(res, () => this.office.saveAccess(gateOf(req), loginName, body));
  }

  @Get('roles')
  @ApiOperation({ summary: 'Roles catalogue' })
  @ApiErrorResponse(401, 403)
  roles(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.roles(gateOf(req)));
  }

  @Post('roles')
  @ApiOperation({ summary: 'Create or update a role' })
  @ApiBody({ schema: freeFormObject })
  @ApiErrorResponse(401, 403, 400)
  saveRole(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: Record<string, unknown>) {
    return this.run(res, () => this.office.saveRole(gateOf(req), body));
  }

  @Post('users')
  @ApiOperation({ summary: 'Create an account under this door' })
  @ApiBody({ type: CreateUserBodyDto })
  @ApiErrorResponse(401, 403, 400)
  createUser(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: CreateUserBodyDto,
  ) {
    return this.run(res, () => this.office.createAccount(gateOf(req), body));
  }

  @Post('users/:loginName/transfer')
  @ApiOperation({ summary: 'Transfer a POS to another parent' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: TransferPosBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  transferPos(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: TransferPosBodyDto,
  ) {
    return this.run(res, () => this.office.transferPos(gateOf(req), loginName, body));
  }

  @Post('users/:loginName/password')
  @ApiOperation({ summary: 'Set account password (office)' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: SetAccountPasswordBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setUserPassword(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: SetAccountPasswordBodyDto,
  ) {
    return this.run(res, () => this.office.setAccountPassword(gateOf(req), loginName, body));
  }

  @Post('users/:loginName/freeze')
  @ApiOperation({ summary: 'Freeze an account' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  freezeUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.setFrozen(gateOf(req), loginName, true));
  }

  @Post('users/:loginName/restore')
  @ApiOperation({ summary: 'Restore a frozen account' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  restoreUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.setFrozen(gateOf(req), loginName, false));
  }

  @Delete('users/:loginName')
  @ApiOperation({ summary: 'Delete an account (no history)' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404, 400)
  removeUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.removeUser(gateOf(req), loginName));
  }

  @Post('users/:loginName/enter')
  @ApiOperation({ summary: 'Impersonate / enter an account; sets `home` + `sid` cookies' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  async enter(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
  ) {
    const previous = readCookie(req, 'sid');
    const result = await this.run(res, () =>
      this.office.enter(gateOf(req), loginName, { userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' }),
    );
    if (result && typeof result === 'object' && 'sessionId' in result && typeof result.sessionId === 'string' && previous) {
      res.cookie('home', previous, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS * 1000 });
      res.cookie('sid', result.sessionId, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS * 1000 });
    }
    return result;
  }

  @Post('leave')
  @ApiOperation({ summary: 'Leave impersonation; restores `sid` from `home`' })
  @ApiErrorResponse(401, 403)
  async leave(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const home = readCookie(req, 'home');
    const result = await this.run(res, () => this.office.leave(gateOf(req)));
    if (result && typeof result === 'object' && 'ok' in result && home) {
      res.cookie('sid', home, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS * 1000 });
      res.clearCookie('home', cookieBase());
    }
    return result;
  }

  @Get('audit')
  @ApiOperation({ summary: 'Audit log (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'kind', required: false })
  @ApiErrorResponse(401, 403)
  audit(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: string,
  ) {
    return this.run(res, () => this.office.audit(gateOf(req), { cursor: text(cursor), kind: text(kind) }));
  }

  @Get('accounting')
  @ApiOperation({ summary: 'Accounting list (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiErrorResponse(401, 403)
  accounting(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
  ) {
    return this.run(res, () => this.office.accounting(gateOf(req), { cursor: text(cursor), q: text(q) }));
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
    @Res({ passthrough: true }) res: Response,
    @Param('scope') scope: string,
    @Query('kind') kind?: string,
    @Query('direction') direction?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.run(res, () => this.office.ledger(gateOf(req), scope, { kind, direction, from, to, cursor: text(cursor) }));
  }

  @Get('reports/:kind')
  @ApiOperation({ summary: 'Report by kind (branch-gated kinds exist)' })
  @ApiParam({ name: 'kind' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiErrorResponse(401, 403)
  report(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('kind') kind: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.run(res, () => this.office.report(gateOf(req), kind, text(cursor)));
  }

  private async run(res: Response, work: () => Promise<unknown>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof OfficeFailure) {
        res.status(error.status);
        return { message: error.message, code: error.code };
      }
      throw error;
    }
  }
}
