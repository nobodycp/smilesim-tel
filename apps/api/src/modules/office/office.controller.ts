import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { SESSION_TTL_SECONDS } from '../auth/sessions';
import { OfficeFailure, OfficeService } from './office.service';

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

@Controller('office')
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  @Get('me')
  me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.me(gateOf(req)));
  }

  @Get('home')
  home(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.home(gateOf(req)));
  }

  @Post('announcements')
  postAnnouncement(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { body?: unknown }) {
    return this.run(res, () => this.office.postAnnouncement(gateOf(req), body));
  }

  @Get('wallets')
  wallets(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.wallets(gateOf(req)));
  }

  @Post('wallets/:loginName/fund')
  fund(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: { amount?: unknown; note?: unknown },
  ) {
    return this.run(res, () => this.office.fund(gateOf(req), loginName, body));
  }

  @Patch('wallets/:loginName/ceiling')
  ceiling(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: { ceiling?: unknown },
  ) {
    return this.run(res, () => this.office.setCeiling(gateOf(req), loginName, body));
  }

  @Get('packages')
  packages(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.packages(gateOf(req)));
  }

  @Get('companies')
  companies(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.companiesShelf(gateOf(req)));
  }

  @Get('packages/:code/sheet')
  packageSheet(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string) {
    return this.run(res, () => this.office.packageSheet(gateOf(req), code));
  }

  @Patch('packages/:code/chain')
  packageChain(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string, @Body() body: Record<string, unknown>) {
    return this.run(res, () => this.office.setChain(gateOf(req), code, body));
  }

  @Put('packages/:code/renewals')
  packageRenewals(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: { targets?: unknown },
  ) {
    return this.run(res, () => this.office.setPackageTargets(gateOf(req), code, 'renewals', body));
  }

  @Put('packages/:code/switches')
  packageSwitches(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: { targets?: unknown },
  ) {
    return this.run(res, () => this.office.setPackageTargets(gateOf(req), code, 'switches', body));
  }

  @Put('packages/:code/offers')
  saveOffer(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string, @Body() body: { loginName?: unknown; price?: unknown }) {
    return this.run(res, () => this.office.saveOffer(gateOf(req), code, body));
  }

  @Delete('packages/:code/offers/:loginName')
  removeOffer(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.removeOffer(gateOf(req), code, loginName));
  }

  @Patch('packages/:code/mode')
  packageMode(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('code') code: string, @Body() body: Record<string, unknown>) {
    return this.run(res, () => this.office.setPackageMode(gateOf(req), code, body));
  }

  @Patch('packages/:code/price')
  price(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('code') code: string,
    @Body() body: { price?: unknown },
  ) {
    return this.run(res, () => this.office.setPrice(gateOf(req), code, body));
  }

  @Post('companies/image')
  companyImage(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { name?: unknown; image?: unknown }) {
    return this.run(res, () => this.office.setCompanyImage(gateOf(req), body));
  }

  @Get('providers')
  providers(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.providers(gateOf(req)));
  }

  @Get('lines')
  lines(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('packageCode') packageCode?: string,
  ) {
    return this.run(res, () => this.office.lines(gateOf(req), { cursor: text(cursor), q: text(q), status: text(status), packageCode: text(packageCode) }));
  }

  @Get('lines/:id')
  line(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.line(gateOf(req), id));
  }

  @Post('lines')
  activate(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: Record<string, unknown>) {
    return this.run(res, () => this.office.activate(gateOf(req), body));
  }

  @Post('lines/:id/charge')
  charge(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() body: { outcome?: unknown }) {
    return this.run(res, () => this.office.operate(gateOf(req), id, 'charge', body));
  }

  @Post('lines/:id/disconnect')
  disconnect(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() body: { outcome?: unknown }) {
    return this.run(res, () => this.office.operate(gateOf(req), id, 'disconnect', body));
  }

  @Post('lines/:id/unfreeze')
  unfreeze(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() body: { outcome?: unknown }) {
    return this.run(res, () => this.office.operate(gateOf(req), id, 'unfreeze', body));
  }

  @Post('lines/:id/freeze')
  freeze(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() body: { outcome?: unknown }) {
    return this.run(res, () => this.office.operate(gateOf(req), id, 'freeze', body));
  }

  @Post('lines/:id/extend')
  extend(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: { outcome?: unknown; targetCode?: unknown },
  ) {
    return this.run(res, () => this.office.extend(gateOf(req), id, body));
  }

  @Post('lines/:id/reactivate')
  reactivate(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() body: { outcome?: unknown }) {
    return this.run(res, () => this.office.reactivate(gateOf(req), id, body));
  }

  @Post('lines/:id/rename')
  rename(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: { msisdn?: unknown; outcome?: unknown },
  ) {
    return this.run(res, () => this.office.renameLine(gateOf(req), id, body));
  }

  @Post('lines/:id/sim')
  swapSim(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: { iccid?: unknown; outcome?: unknown },
  ) {
    return this.run(res, () => this.office.swapSim(gateOf(req), id, body));
  }

  @Post('lines/:id/transfer')
  transferLine(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: { posLogin?: unknown },
  ) {
    return this.run(res, () => this.office.transferLine(gateOf(req), id, body));
  }

  @Post('lines/:id/switch')
  switchPackage(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: { packageCode?: unknown; outcome?: unknown },
  ) {
    return this.run(res, () => this.office.switchPackage(gateOf(req), id, body));
  }

  @Get('notices')
  notices(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.notices(gateOf(req)));
  }

  @Post('notices/read')
  readNotices(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { id?: unknown }) {
    const id = typeof body.id === 'string' ? body.id : undefined;
    return this.run(res, () => this.office.readNotices(gateOf(req), id));
  }

  @Get('tasks')
  tasks(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query('cursor') cursor?: string, @Query('status') status?: string) {
    return this.run(res, () => this.office.tasks(gateOf(req), { cursor: text(cursor), status: text(status) }));
  }

  @Post('tasks/:id/take')
  take(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.takeTask(gateOf(req), id));
  }

  @Post('tasks/:id/release')
  release(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.releaseTask(gateOf(req), id));
  }

  @Post('tasks/:id/complete')
  complete(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() body: { note?: unknown }) {
    return this.run(res, () => this.office.completeTask(gateOf(req), id, body));
  }

  @Post('tasks/:id/reject')
  reject(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() body: { reason?: unknown }) {
    return this.run(res, () => this.office.rejectTask(gateOf(req), id, body));
  }

  @Post('tasks/:id/cancel')
  cancel(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id') id: string) {
    return this.run(res, () => this.office.cancelTask(gateOf(req), id));
  }

  @Get('users')
  users(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.users(gateOf(req)));
  }

  @Get('roles')
  roles(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.run(res, () => this.office.roles(gateOf(req)));
  }

  @Post('roles')
  saveRole(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: Record<string, unknown>) {
    return this.run(res, () => this.office.saveRole(gateOf(req), body));
  }

  @Post('users')
  createUser(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { loginName?: unknown; nickname?: unknown; password?: unknown; layer?: unknown; parentLogin?: unknown; roleId?: unknown },
  ) {
    return this.run(res, () => this.office.createAccount(gateOf(req), body));
  }

  @Post('users/:loginName/transfer')
  transferPos(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: { parentLogin?: unknown },
  ) {
    return this.run(res, () => this.office.transferPos(gateOf(req), loginName, body));
  }

  @Post('users/:loginName/password')
  setUserPassword(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('loginName') loginName: string,
    @Body() body: { password?: unknown },
  ) {
    return this.run(res, () => this.office.setAccountPassword(gateOf(req), loginName, body));
  }

  @Post('users/:loginName/freeze')
  freezeUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.setFrozen(gateOf(req), loginName, true));
  }

  @Post('users/:loginName/restore')
  restoreUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.setFrozen(gateOf(req), loginName, false));
  }

  @Delete('users/:loginName')
  removeUser(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('loginName') loginName: string) {
    return this.run(res, () => this.office.removeUser(gateOf(req), loginName));
  }

  @Post('users/:loginName/enter')
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
  audit(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query('cursor') cursor?: string, @Query('kind') kind?: string) {
    return this.run(res, () => this.office.audit(gateOf(req), { cursor: text(cursor), kind: text(kind) }));
  }

  @Get('accounting')
  accounting(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query('cursor') cursor?: string, @Query('q') q?: string) {
    return this.run(res, () => this.office.accounting(gateOf(req), { cursor: text(cursor), q: text(q) }));
  }

  @Get('ledger/:scope')
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
  report(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('kind') kind: string, @Query('cursor') cursor?: string) {
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
