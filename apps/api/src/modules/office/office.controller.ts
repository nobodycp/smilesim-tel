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
import { ActivityDraft, ActivityRecorder } from './activity-recorder';
import { OfficeFailure, OfficeService } from './office.service';
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
  constructor(
    private readonly office: OfficeService,
    private readonly activity: ActivityRecorder,
  ) {}

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
    return this.run(res, () => this.office.fund(gateOf(req), loginName, body), { action: 'fund', subjectKind: 'account', subjectRef: loginName });
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
    return this.run(res, () => this.office.setChain(gateOf(req), code, body), { action: 'package_chain', subjectKind: 'package', subjectRef: code });
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

  @Get('packages/:code/custom-prices')
  @ApiOperation({ summary: 'Accounts whose price for this package differs from their default' })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  customPrices(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string) {
    return this.run(res, () => this.office.customPrices(gateOf(req), code));
  }

  @Put('packages/:code/custom-prices/:loginName')
  @ApiOperation({ summary: 'Set a special price for one account on this package' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: CustomPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setCustomPrice(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Param('loginName') loginName: string,
    @Body() body: CustomPriceBodyDto,
  ) {
    return this.run(res, () => this.office.setCustomPrice(gateOf(req), code, loginName, body), {
      action: 'user_package',
      subjectKind: 'user',
      subjectRef: `${loginName}:${code}`,
    });
  }

  @Delete('packages/:code/custom-prices/:loginName')
  @ApiOperation({ summary: 'Return an account to the default price for this package' })
  @ApiParam({ name: 'code' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  clearCustomPrice(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Param('loginName') loginName: string,
  ) {
    return this.run(res, () => this.office.clearCustomPrice(gateOf(req), code, loginName), {
      action: 'user_package',
      subjectKind: 'user',
      subjectRef: `${loginName}:${code}`,
    });
  }

  @Get('packages/:code/line-prices')
  @ApiOperation({ summary: 'The renewable numbers of this package grouped by the renewal price they carry' })
  @ApiParam({ name: 'code' })
  @ApiQuery({ name: 'scope', required: true, description: 'An account login (that account and everything under it) or "all" (branch only)' })
  @ApiErrorResponse(401, 403, 400, 404)
  linePrices(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Query('scope') scope?: string,
  ) {
    return this.run(res, () => this.office.linePrices(gateOf(req), code, { scope }));
  }

  @Put('packages/:code/line-prices')
  @ApiOperation({ summary: 'Reprice the renewable numbers of this package, one price group at a time' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: LinePricesBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setLinePrices(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: LinePricesBodyDto,
  ) {
    return this.run(res, () => this.office.setLinePrices(gateOf(req), code, body), { action: 'package_reprice', subjectKind: 'package', subjectRef: code });
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
    return this.run(res, () => this.office.setPackageMode(gateOf(req), code, body), { action: 'package_mode', subjectKind: 'package', subjectRef: code });
  }

  @Put('sell-prices/:code')
  @ApiOperation({ summary: "Set the caller's own sell price for a package (main agent or agent)" })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: SellPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setSellPrice(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: SellPriceBodyDto,
  ) {
    return this.run(res, () => this.office.setSellPrice(gateOf(req), code, body), { action: 'sell_price', subjectKind: 'package', subjectRef: code });
  }

  @Delete('sell-prices/:code')
  @ApiOperation({ summary: "Clear the caller's own sell price for a package; the layer column applies again" })
  @ApiParam({ name: 'code' })
  @ApiErrorResponse(401, 403, 404)
  clearSellPrice(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string) {
    return this.run(res, () => this.office.clearSellPrice(gateOf(req), code), { action: 'sell_price', subjectKind: 'package', subjectRef: code });
  }

  @Post('companies/image')
  @ApiOperation({ summary: 'Set company mark / image' })
  @ApiBody({ type: CompanyImageBodyDto })
  @ApiErrorResponse(401, 403, 400)
  companyImage(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: CompanyImageBodyDto) {
    return this.run(res, () => this.office.setCompanyImage(gateOf(req), body));
  }

  @Put('companies/:code/sim')
  @ApiOperation({ summary: 'Set company SIM rules (ICCID length, prefix, eSIM)' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: CompanySimBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  companySim(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: CompanySimBodyDto,
  ) {
    return this.run(res, () => this.office.setCompanySim(gateOf(req), code, body), { action: 'company_sim', subjectKind: 'company', subjectRef: code });
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

  @Patch('providers/:code/esim-price')
  @ApiOperation({ summary: 'Set or clear the provider eSIM price override' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: ProviderEsimPriceBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setProviderEsimPrice(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: ProviderEsimPriceBodyDto,
  ) {
    return this.run(res, () => this.office.setProviderEsimPrice(gateOf(req), code, body), { action: 'provider_esim_price', subjectKind: 'provider', subjectRef: code });
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
    return this.run(res, () => this.office.setProviderMode(gateOf(req), code, body as Record<string, unknown>), { action: 'provider_mode', subjectKind: 'provider', subjectRef: code });
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
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('packageCode') packageCode?: string,
    @Query('provider') provider?: string,
    @Query('company') company?: string,
  ) {
    return this.run(res, () =>
      this.office.lines(gateOf(req), {
        cursor: text(cursor),
        q: text(q),
        status: text(status),
        packageCode: text(packageCode),
        provider: text(provider),
        company: text(company),
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
    return this.run(res, () => this.office.activate(gateOf(req), body), { action: 'activate', subjectKind: 'line', subjectRef: typeof body.msisdn === 'string' ? body.msisdn : '' });
  }

  @Post('lines/:id/company-switch')
  @ApiOperation({ summary: 'Switch the carrier. Fields are not defined yet, so the request is rejected.' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  companySwitch(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.companySwitch(), { action: 'company_switch', subjectKind: 'line', subjectRef: id });
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
    return this.run(res, () => this.office.operate(gateOf(req), id, 'charge', body), { action: 'charge', subjectKind: 'line', subjectRef: id });
  }

  @Post('lines/:id/refresh')
  @ApiOperation({ summary: 'Update a line without changing its fields' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: OutcomeBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: OutcomeBodyDto,
  ) {
    return this.run(res, () => this.office.refreshLine(gateOf(req), id, body), { action: 'refresh', subjectKind: 'line', subjectRef: id });
  }

  @Get('lines/:id/disconnect-quote')
  @ApiOperation({ summary: 'What a disconnect would return to the point of sale now, and whether it runs at once' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  disconnectQuote(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.disconnectQuote(gateOf(req), id));
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
    return this.run(res, () => this.office.operate(gateOf(req), id, 'disconnect', body), { action: 'disconnect', subjectKind: 'line', subjectRef: id });
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
    return this.run(res, () => this.office.operate(gateOf(req), id, 'unfreeze', body), { action: 'unfreeze', subjectKind: 'line', subjectRef: id });
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
    return this.run(res, () => this.office.operate(gateOf(req), id, 'freeze', body), { action: 'freeze', subjectKind: 'line', subjectRef: id });
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
    return this.run(res, () => this.office.extend(gateOf(req), id, body), { action: 'extend', subjectKind: 'line', subjectRef: id });
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
    return this.run(res, () => this.office.reactivate(gateOf(req), id, body), { action: 'reactivate', subjectKind: 'line', subjectRef: id });
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
    return this.run(res, () => this.office.renameLine(gateOf(req), id, body), { action: 'rename', subjectKind: 'line', subjectRef: id });
  }

  @Post('lines/:id/esim')
  @ApiOperation({ summary: 'Request an eSIM for a line; always a branch task priced from the company, provider, or package' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 400, 404)
  requestEsim(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.requestEsim(gateOf(req), id), { action: 'esim', subjectKind: 'line', subjectRef: id });
  }

  @Post('lines/:id/sim')
  @ApiOperation({ summary: 'Swap to a SIM the branch already holds (physical or eSIM); free' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: SwapSimBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  swapSim(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: SwapSimBodyDto,
  ) {
    return this.run(res, () => this.office.swapSim(gateOf(req), id, body), { action: 'sim', subjectKind: 'line', subjectRef: id });
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
    return this.run(res, () => this.office.switchPackage(gateOf(req), id, body), { action: 'switch', subjectKind: 'line', subjectRef: id });
  }

  @Get('notices')
  @ApiOperation({ summary: 'Notices inbox (paged)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'group', required: false, enum: ['tasks', 'wallet', 'announcements'] })
  @ApiQuery({ name: 'unread', required: false })
  @ApiErrorResponse(401, 403)
  notices(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('group') group?: string,
    @Query('unread') unread?: string,
  ) {
    return this.run(res, () => this.office.notices(gateOf(req), { cursor: text(cursor), group: text(group), unread: text(unread) }));
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
    return this.run(res, () => this.office.addTaskNote(gateOf(req), id, body), { action: 'task_note', subjectKind: 'task', subjectRef: id });
  }

  @Post('tasks/:id/take')
  @ApiOperation({ summary: 'Take a task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  take(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.takeTask(gateOf(req), id), { action: 'task_take', subjectKind: 'task', subjectRef: id });
  }

  @Post('tasks/:id/release')
  @ApiOperation({ summary: 'Release a taken task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  release(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.releaseTask(gateOf(req), id), { action: 'task_release', subjectKind: 'task', subjectRef: id });
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Complete a task; an eSIM request takes the serial and QR, a number change takes the new number' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: CompleteTaskBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  complete(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: CompleteTaskBodyDto,
  ) {
    return this.run(res, () => this.office.completeTask(gateOf(req), id, body), { action: 'task_complete', subjectKind: 'task', subjectRef: id });
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
    return this.run(res, () => this.office.rejectTask(gateOf(req), id, body), { action: 'task_reject', subjectKind: 'task', subjectRef: id });
  }

  @Post('tasks/:id/cancel')
  @ApiOperation({ summary: 'Cancel a task' })
  @ApiParam({ name: 'id' })
  @ApiErrorResponse(401, 403, 404)
  cancel(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.cancelTask(gateOf(req), id), { action: 'task_cancel', subjectKind: 'task', subjectRef: id });
  }

  @Get('users')
  @ApiOperation({ summary: 'Users list for the door' })
  @ApiErrorResponse(401, 403)
  users(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.users(gateOf(req)));
  }

  @Get('directory')
  @ApiOperation({ summary: 'Login name → full name for the accounts the actor may meet on a screen' })
  @ApiErrorResponse(401, 403)
  directory(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.directory(gateOf(req)));
  }

  @Get('users/:loginName')
  @ApiOperation({ summary: 'Single account detail' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  account(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.account(gateOf(req), loginName));
  }

  @Get('users/:loginName/packages')
  @ApiOperation({ summary: 'Packages as this account sees and pays for them' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  userPackages(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.userPackages(gateOf(req), loginName));
  }

  @Put('users/:loginName/packages')
  @ApiOperation({ summary: 'Hide or show several packages for this account' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: UserPackagesBulkBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setUserPackagesBulk(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: UserPackagesBulkBodyDto,
  ) {
    return this.run(res, () => this.office.setUserPackagesBulk(gateOf(req), loginName, body), { action: 'user_package', subjectKind: 'user', subjectRef: loginName });
  }

  @Put('users/:loginName/packages/:code')
  @ApiOperation({ summary: 'Hide, show, or price one package for this account' })
  @ApiParam({ name: 'loginName' })
  @ApiParam({ name: 'code' })
  @ApiBody({ type: UserPackageBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setUserPackage(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Param('code') code: string,
    @Body() body: UserPackageBodyDto,
  ) {
    return this.run(res, () => this.office.setUserPackage(gateOf(req), loginName, code, body), {
      action: 'user_package',
      subjectKind: 'user',
      subjectRef: `${loginName}:${code}`,
    });
  }

  @Get('users/:loginName/ops')
  @ApiOperation({ summary: 'Line operations stopped on this account, own and inherited' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  userOps(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.userOps(gateOf(req), loginName));
  }

  @Put('users/:loginName/ops')
  @ApiOperation({ summary: 'Set the line operations stopped on this account' })
  @ApiParam({ name: 'loginName' })
  @ApiBody({ type: UserOpsBodyDto })
  @ApiErrorResponse(401, 403, 400, 404)
  setUserOps(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: UserOpsBodyDto,
  ) {
    return this.run(res, () => this.office.setUserOps(gateOf(req), loginName, body), { action: 'user_ops', subjectKind: 'user', subjectRef: loginName });
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
    return this.run(res, () => this.office.saveAccess(gateOf(req), loginName, body), { action: 'access', subjectKind: 'account', subjectRef: loginName });
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
    return this.run(res, () => this.office.createAccount(gateOf(req), body), { action: 'user_create', subjectKind: 'account', subjectRef: typeof body.loginName === 'string' ? body.loginName : '' });
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

  @Get('users/:loginName/transfer-preview')
  @ApiOperation({ summary: 'What moving an account under another parent would carry; refuses as the move does' })
  @ApiParam({ name: 'loginName' })
  @ApiQuery({ name: 'parentLogin', required: true, description: 'The login of the new parent' })
  @ApiErrorResponse(401, 403, 400)
  transferPreview(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Query('parentLogin') parentLogin?: unknown,
  ) {
    return this.run(res, () => this.office.transferPreview(gateOf(req), loginName, { parentLogin }));
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
    return this.run(res, () => this.office.setAccountPassword(gateOf(req), loginName, body), { action: 'password', subjectKind: 'account', subjectRef: loginName });
  }

  @Post('users/:loginName/freeze')
  @ApiOperation({ summary: 'Freeze an account' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  freezeUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.setFrozen(gateOf(req), loginName, true), { action: 'user_freeze', subjectKind: 'account', subjectRef: loginName });
  }

  @Post('users/:loginName/restore')
  @ApiOperation({ summary: 'Restore a frozen account' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404)
  restoreUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.setFrozen(gateOf(req), loginName, false), { action: 'user_restore', subjectKind: 'account', subjectRef: loginName });
  }

  @Delete('users/:loginName')
  @ApiOperation({ summary: 'Delete an account (no history)' })
  @ApiParam({ name: 'loginName' })
  @ApiErrorResponse(401, 403, 404, 400)
  removeUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.removeUser(gateOf(req), loginName), { action: 'user_delete', subjectKind: 'account', subjectRef: loginName });
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
    const result = await this.run(
      res,
      () => this.office.enter(gateOf(req), loginName, { userAgent: String(req.headers['user-agent'] ?? ''), ip: req.ip ?? '' }),
      { action: 'enter', subjectKind: 'account', subjectRef: loginName },
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
    const result = await this.run(res, () => this.office.leave(gateOf(req)), { action: 'leave', subjectKind: 'account', subjectRef: '' });
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
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('action') action?: string,
    @Query('result') result?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.run(res, () => this.office.audit(gateOf(req), {
      cursor: text(cursor),
      action: text(action),
      result: text(result),
      layer: text(layer),
      q: text(q),
      from: text(from),
      to: text(to),
    }));
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
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: string,
    @Query('provider') provider?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.run(res, () => this.office.providerOperations(gateOf(req), {
      cursor: text(cursor),
      kind: text(kind),
      provider: text(provider),
      q: text(q),
      from: text(from),
      to: text(to),
    }));
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
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('kind') kind?: string,
    @Query('layer') layer?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.run(res, () => this.office.finance(gateOf(req), {
      cursor: text(cursor),
      kind: text(kind),
      layer: text(layer),
      q: text(q),
      from: text(from),
      to: text(to),
    }));
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

  private async run(res: Response, work: () => Promise<unknown>, event?: ActivityDraft) {
    const req = res.req;
    try {
      const value = await work();
      if (event) await this.activity.recordOffice(gateOf(req), req.ip ?? '', event, 'ok', '');
      return value;
    } catch (error) {
      if (error instanceof OfficeFailure) {
        if (event) await this.activity.recordOffice(gateOf(req), req.ip ?? '', event, 'fail', error.code);
        res.status(error.status);
        return { message: error.message, code: error.code };
      }
      throw error;
    }
  }
}
