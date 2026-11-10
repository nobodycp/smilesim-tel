import { TermsRepository } from './terms.repository';
import { PriceLadder } from './price-ladder';
import { AccountTree } from '../kernel/account-tree';
import { UnitOfWork } from '../kernel/unit-of-work';
import { holds, requireGrant, assertBranch } from '../policy';
import { Injectable } from '@nestjs/common';
import { parseInput } from '../../shared/input';
import { fail } from '../../shared/office-failure';
import type { Actor } from '../kernel/types';
import type { Prisma } from '../../../generated/prisma/client';
import type { Account } from '../kernel/types';
import { RENEWABLE_STATUSES, groupLinePrices, repriceLine, type PriceGroup } from '../rules/line-prices';
import { captureTerms, visibleAccountIds, type LineTerms, type PackageTerms } from '../rules/office-rules';
import { packageTermsOf } from '../rules/office-terms';
import { buyPriceFor, deniedAbove, floorFor, hiddenAbove, parseOps, priceSource, serializeOps, type LayerPrices, type PathNode, type SellRow, type TermRow } from '../rules/user-terms';
import { lineTermsOf } from '../kernel/line-terms';
import { CustomPriceBody, LinePricesBody, UserOpsBody, UserPackageBody, UserPackagesBulkBody } from './terms.schemas';
import type { PackagePriceRow } from '../rules/office-terms';
import type { PriceSource } from '../rules/user-terms';
import type { PrismaClient } from '../../../generated/prisma/client';

type PackageFacts = { id: string; code: string; name: string; dataGb: number | null; months: number; company?: { code: string } | null } & LayerPrices;
type TermPatch = { hidden?: boolean; price?: number | null; renewalPrice?: number | null };
export type UserPackageRow = {
  code: string;
  name: string;
  dataGb: number | null;
  months: number;
  companyCode: string;
  hidden: boolean;
  hiddenAbove: string | null;
  parentBuy: number;
  parentRenewalBuy: number;
  price: number | null;
  renewalPrice: number | null;
  effective: number;
  renewalEffective: number;
  source: PriceSource;
  /** Renewable lines of this package on points of sale in this user's subtree. */
  lines: number;
};
export type CustomPriceRow = {
  loginName: string;
  nickname: string;
  layer: string;
  parentLogin: string;
  defaultPrice: number;
  defaultRenewalPrice: number;
  price: number | null;
  renewalPrice: number | null;
};
/** What a line-prices request covers: the whole system, or one account and everything under it. */
type LineScope = { kind: 'all' } | { kind: 'account'; id: string; loginName: string; layer: string };
/** What happens to one number: a flat price, or what a new activation would carry now. */
export type LineTarget = { to: number | 'current' };
export type RepriceLine = { id: string; posId: string; terms: Prisma.JsonValue; package: PackagePriceRow & { id: string } };

/** The fields a user-package body sets, once the schema has checked them. A body that sets nothing is refused. */
function termPatch(input: TermPatch): TermPatch {
  const patch: TermPatch = {};
  if (input.hidden !== undefined) patch.hidden = input.hidden;
  if (input.price !== undefined) patch.price = input.price;
  if (input.renewalPrice !== undefined) patch.renewalPrice = input.renewalPrice;
  if (!Object.keys(patch).length) fail(400, 'INVALID');
  return patch;
}

function summarize(rows: UserPackageRow[]) {
  return {
    total: rows.length,
    visible: rows.filter((row) => !row.hidden && !row.hiddenAbove).length,
    custom: rows.filter((row) => row.price !== null || row.renewalPrice !== null).length,
  };
}

/** Terms an account sets for the accounts below it: which packages they see and at what price, which operations they may run, the branch's custom prices, and repricing the renewable lines of a package. */
@Injectable()
export class TermsService {
  constructor(private readonly uow: UnitOfWork, private readonly tree: AccountTree, private readonly ladder: PriceLadder, private readonly repo: TermsRepository) {}

  /** Every sellable package, grouped by company, with what `loginName` sees and pays. */
  async userPackages(actor: Actor, loginName: string) {
    const { path, target, accounts } = await this.termTarget(actor, loginName);
    const lineCountsByPackage = await this.renewableLinesByPackage(target.id, target.layer, accounts);
    const [packages, terms, sells] = await Promise.all([
      this.repo.packagesOnSaleByCompany(),
      this.repo.termsOf(path.map((node) => node.id)),
      this.repo.sellPricesOf(path.map((node) => node.id)),
    ]);
    const rows = packages.map((pkg) => ({
      pkg,
      row: this.userPackageRow(pkg, path, terms.filter((term) => term.packageId === pkg.id), sells.filter((sell) => sell.packageId === pkg.id), lineCountsByPackage),
    }));
    const companies = new Map<string, { code: string; name: string; packages: UserPackageRow[] }>();
    for (const { pkg, row } of rows) {
      const key = pkg.company?.code ?? '';
      const group = companies.get(key) ?? { code: key, name: pkg.company?.name ?? '', packages: [] };
      group.packages.push(row);
      companies.set(key, group);
    }
    return { summary: summarize(rows.map((item) => item.row)), companies: [...companies.values()] };
  }

  async setUserPackage(actor: Actor, loginName: string, code: string, body: unknown) {
    const patch = termPatch(parseInput(UserPackageBody, body));
    const { path, target, accounts } = await this.termTarget(actor, loginName);
    const pkg = await this.repo.packageByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    const { terms, sells } = await this.ladder.termsFor(pkg.id);
    const lineCountsByPackage = await this.renewableLinesByPackage(target.id, target.layer, accounts);
    return this.writeUserPackage(actor, path, pkg, patch, terms, sells, this.uow.prisma, lineCountsByPackage);
  }

  /** Hide or show several packages at once. Packages hidden higher up are left alone. */
  async setUserPackagesBulk(actor: Actor, loginName: string, body: unknown) {
    const input = parseInput(UserPackagesBulkBody, body);
    const codes = new Set(input.codes);
    const { hidden } = input;
    const { path, target, accounts } = await this.termTarget(actor, loginName);
    const pathIds = path.map((node) => node.id);
    const lineCountsByPackage = await this.renewableLinesByPackage(target.id, target.layer, accounts);
    // The path's rows for every package on sale, loaded once: the picked ones are written, all of
    // them feed the summary. Every write sits in one transaction so a refusal midway applies nothing.
    const [packages, terms, sells] = await Promise.all([
      this.repo.packagesOnSale(),
      this.repo.termRowsOf(pathIds),
      this.repo.sellRowsOf(pathIds),
    ]);
    const termsOf = (packageId: string) => terms.filter((row) => row.packageId === packageId);
    const sellsOf = (packageId: string) => sells.filter((row) => row.packageId === packageId);
    const written = new Map<string, TermRow[]>();
    await this.uow.runTx(async (tx) => {
      for (const pkg of packages) {
        if (!codes.has(pkg.code)) continue;
        const own = termsOf(pkg.id);
        if (hiddenAbove(path, own)) continue;
        await this.writeUserPackage(actor, path, pkg, { hidden }, own, sellsOf(pkg.id), tx, lineCountsByPackage);
        written.set(pkg.id, own);
      }
    });
    const rows = packages.map((pkg) => this.userPackageRow(pkg, path, written.get(pkg.id) ?? termsOf(pkg.id), sellsOf(pkg.id), lineCountsByPackage));
    return { summary: summarize(rows) };
  }

  async userOps(actor: Actor, loginName: string) {
    const { target, path } = await this.termTarget(actor, loginName);
    return { denied: parseOps(target.deniedOps), deniedAbove: deniedAbove(path) };
  }

  async setUserOps(actor: Actor, loginName: string, body: unknown) {
    const { denied } = parseInput(UserOpsBody, body);
    const { target, path } = await this.termTarget(actor, loginName);
    const deniedOps = serializeOps(denied);
    await this.repo.saveDeniedOps(target.id, deniedOps);
    return { denied: parseOps(deniedOps), deniedAbove: deniedAbove(path) };
  }

  /** Users whose price for `code` differs from what they would pay by default. Branch only. */
  async customPrices(actor: Actor, code: string): Promise<CustomPriceRow[]> {
    assertBranch(actor);
    const pkg = await this.repo.packageByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    const [accounts, { terms, sells }] = await Promise.all([this.tree.accounts(), this.ladder.termsFor(pkg.id)]);
    return terms
      .filter((term) => term.price !== null || term.renewalPrice !== null)
      .map((term) => this.customPriceRow(term.userId, pkg, accounts, terms, sells))
      .filter((row): row is CustomPriceRow => row !== null)
      .sort((a, b) => a.loginName.localeCompare(b.loginName));
  }

  async setCustomPrice(actor: Actor, code: string, loginName: string, body: unknown) {
    const patch = termPatch(parseInput(CustomPriceBody, body));
    const { target, accounts, path } = await this.termTarget(actor, loginName);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.repo.packageByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    const { terms, sells } = await this.ladder.termsFor(pkg.id);
    await this.writeUserPackage(actor, path, pkg, patch, terms, sells);
    const row = this.customPriceRow(target.id, pkg, accounts, terms, sells);
    if (!row) fail(404, 'NOT_FOUND');
    return row;
  }

  async clearCustomPrice(actor: Actor, code: string, loginName: string) {
    const { path } = await this.termTarget(actor, loginName);
    if (actor.layer !== 'branch') fail(403, 'FORBIDDEN');
    const pkg = await this.repo.packageByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    const { terms, sells } = await this.ladder.termsFor(pkg.id);
    await this.writeUserPackage(actor, path, pkg, { price: null, renewalPrice: null }, terms, sells);
    return { ok: true as const };
  }

  /**
   * The renewable numbers of a package in a scope, grouped by the renewal price each one carries, and
   * what a new activation would pay on the scope account (`null` for the whole system: it differs per number).
   */
  async linePrices(actor: Actor, code: string, query: { scope?: unknown }): Promise<{ current: number | null; groups: PriceGroup[] }> {
    const accounts = await this.tree.accounts();
    const scope = await this.lineScope(actor, accounts, query.scope);
    const pkg = await this.repo.packageWithCompany(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    const lines = await this.repo.lineTermsIn(this.scopeLineWhere(scope, accounts, pkg.id));
    const groups = groupLinePrices(lines.map((line) => ({ terms: lineTermsOf(line.terms, pkg) })));
    if (scope.kind === 'all') return { current: null, groups };
    const { terms, sells } = await this.ladder.termsFor(pkg.id);
    return { current: buyPriceFor(this.tree.pathOf(scope.id, accounts), terms, sells, pkg, 'renewal'), groups };
  }

  /**
   * Reprices the renewable numbers of a package in a scope, one price group at a time: every number
   * carrying `from` takes `to`, a flat price or what a new activation would carry now. Numbers in no
   * listed group stay as they are. One transaction, so a refusal anywhere applies nothing.
   */
  async setLinePrices(actor: Actor, code: string, body: unknown): Promise<{ ok: true; lines: number }> {
    const input = parseInput(LinePricesBody, body);
    // A group that keeps its price changes nothing.
    const changes = input.groups.filter((group) => group.to !== group.from);
    const accounts = await this.tree.accounts();
    const scope = await this.lineScope(actor, accounts, input.scope);
    const pkg = await this.repo.packageIdByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    const lines = await this.uow.runTx(async (tx) => {
      const found = await this.repo.linesToReprice(tx, this.scopeLineWhere(scope, accounts, pkg.id));
      return this.repriceLines(
        tx,
        found,
        (line) => {
          const price = lineTermsOf(line.terms, line.package).renewal.posPrice;
          const change = changes.find((item) => item.from === price);
          return change ? { to: change.to } : null;
        },
        accounts,
      );
    });
    return { ok: true as const, lines };
  }

  /** Resolves the account whose terms are edited and checks the actor may edit them. */
  private async termTarget(actor: Actor, loginName: string) {
    const accounts = await this.tree.accounts();
    const target = accounts.find((account) => account.loginName === loginName);
    if (!target || !visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(404, 'NOT_FOUND');
    if (target.layer === 'branch') fail(400, 'INVALID');
    if (!this.canEditTerms(actor, target)) fail(403, 'FORBIDDEN');
    return { actor, target, accounts, path: this.tree.pathOf(target.id, accounts) };
  }

  /**
   * The one writer for a user's row on a package. Refuses to show what an ancestor hid, checks
   * each price against the parent's own buy price, and deletes a row that is back on defaults.
   * `terms` is updated in place so the caller can compute the returned row from it.
   */
  private async writeUserPackage(
    actor: Actor,
    path: PathNode[],
    pkg: { id: string } & PackageFacts,
    patch: TermPatch,
    terms: TermRow[],
    sells: SellRow[],
    db: Prisma.TransactionClient | PrismaClient = this.uow.prisma,
    lineCountsByPackage: Map<string, number> = new Map(),
  ): Promise<UserPackageRow> {
    const userId = path[0].id;
    const index = terms.findIndex((term) => term.userId === userId);
    const own = index >= 0 ? terms[index] : null;
    if (patch.hidden === false && hiddenAbove(path, terms)) fail(403, 'FORBIDDEN');
    const next: TermRow = {
      userId,
      hidden: patch.hidden ?? own?.hidden ?? false,
      price: patch.price === undefined ? (own?.price ?? null) : patch.price,
      renewalPrice: patch.renewalPrice === undefined ? (own?.renewalPrice ?? null) : patch.renewalPrice,
    };
    // The floor is checked at write time only, and only for the price this patch sets: a later
    // rise of the parent's buy price must not block the hide/show switch on an older row.
    if (patch.price != null && patch.price < floorFor(path, terms, sells, pkg, 'subscription')) fail(400, 'PRICE_BELOW_FLOOR');
    if (patch.renewalPrice != null && patch.renewalPrice < floorFor(path, terms, sells, pkg, 'renewal')) fail(400, 'PRICE_BELOW_FLOOR');
    if (!next.hidden && next.price === null && next.renewalPrice === null) {
      if (own) {
        await this.repo.removeTerm(pkg.id, userId, db);
        terms.splice(index, 1);
      }
    } else {
      const data = { hidden: next.hidden, price: next.price, renewalPrice: next.renewalPrice, setById: actor.id };
      await this.repo.saveTerm(pkg.id, userId, data, db);
      if (own) terms[index] = next;
      else terms.push(next);
    }
    return this.userPackageRow(pkg, path, terms, sells, lineCountsByPackage);
  }

  /** Renewable line counts per package under `targetId`'s subtree (visible POS ids). */
  private async renewableLinesByPackage(targetId: string, targetLayer: string, accounts: Account[]): Promise<Map<string, number>> {
    const posIds = [...visibleAccountIds(targetId, targetLayer, accounts)];
    if (posIds.length === 0) return new Map();
    const groups = await this.repo.renewableLineCounts(posIds);
    return new Map(groups.map((row) => [row.packageId, row._count._all]));
  }

  private userPackageRow(
    pkg: PackageFacts,
    path: PathNode[],
    terms: TermRow[],
    sells: SellRow[],
    lineCountsByPackage: Map<string, number> = new Map(),
  ): UserPackageRow {
    const own = terms.find((term) => term.userId === path[0].id);
    return {
      code: pkg.code,
      name: pkg.name,
      dataGb: pkg.dataGb,
      months: pkg.months,
      companyCode: pkg.company?.code ?? '',
      hidden: own?.hidden ?? false,
      hiddenAbove: hiddenAbove(path, terms),
      parentBuy: floorFor(path, terms, sells, pkg, 'subscription'),
      parentRenewalBuy: floorFor(path, terms, sells, pkg, 'renewal'),
      price: own?.price ?? null,
      renewalPrice: own?.renewalPrice ?? null,
      effective: buyPriceFor(path, terms, sells, pkg, 'subscription'),
      renewalEffective: buyPriceFor(path, terms, sells, pkg, 'renewal'),
      source: priceSource(path, terms, sells, 'subscription'),
      lines: lineCountsByPackage.get(pkg.id) ?? 0,
    };
  }

  private customPriceRow(userId: string, pkg: LayerPrices, accounts: Account[], terms: TermRow[], sells: SellRow[]): CustomPriceRow | null {
    const path = this.tree.pathOf(userId, accounts);
    if (path.length === 0) return null;
    const account = accounts.find((item) => item.id === userId) as Account;
    const own = terms.find((term) => term.userId === userId);
    const without = terms.filter((term) => term.userId !== userId);
    return {
      loginName: account.loginName,
      nickname: account.nickname,
      layer: account.layer,
      parentLogin: path[1]?.loginName ?? '',
      defaultPrice: buyPriceFor(path, without, sells, pkg, 'subscription'),
      defaultRenewalPrice: buyPriceFor(path, without, sells, pkg, 'renewal'),
      price: own?.price ?? null,
      renewalPrice: own?.renewalPrice ?? null,
    };
  }

  /**
   * What a line-prices request covers. The whole system is for the branch owner, or staff who may edit.
   * An account is for whoever may write a custom price on it (its parent, or the branch), and for an agent
   * or main agent naming itself: the table over its own subtree. A point of sale never opens it, and an
   * impersonated session writes no prices.
   */
  private async lineScope(actor: Actor, accounts: Account[], scope: unknown): Promise<LineScope> {
    if (actor.impersonating || actor.layer === 'pos') fail(403, 'FORBIDDEN');
    if (scope === 'all') {
      requireGrant(actor, 'edit');
      return { kind: 'all' };
    }
    if (typeof scope !== 'string' || !scope) fail(400, 'INVALID');
    const target = accounts.find((account) => account.loginName === scope);
    if (!target || !visibleAccountIds(actor.id, actor.layer, accounts).has(target.id)) fail(404, 'NOT_FOUND');
    if (target.layer === 'branch') fail(400, 'INVALID');
    if (target.id !== actor.id && !this.canEditTerms(actor, target)) fail(403, 'FORBIDDEN');
    return { kind: 'account', id: target.id, loginName: target.loginName, layer: target.layer };
  }

  /** The numbers a table lists and a save may change: one package, in the scope, never a disconnected one. */
  private scopeLineWhere(scope: LineScope, accounts: Account[], packageId: string) {
    return {
      packageId,
      status: { in: [...RENEWABLE_STATUSES] },
      ...(scope.kind === 'account' ? { posId: { in: [...visibleAccountIds(scope.id, scope.layer, accounts)] } } : {}),
    };
  }

  /**
   * Rewrites the renewal terms of the numbers `planFor` names, in the caller's transaction, and returns how
   * many it wrote. A flat price may not sit below the floor of that number's point of sale. `'current'`
   * rebuilds the ladder and the renewal targets as an activation captures them today, priced through the
   * number's own path, so a nearer custom price still wins. Everything the batch needs is read once and every
   * number is checked before the first write, so one refusal applies nothing.
   */
  async repriceLines(
    tx: Prisma.TransactionClient,
    lines: RepriceLine[],
    planFor: (line: RepriceLine) => LineTarget | null,
    accounts: Account[],
  ): Promise<number> {
    const plans = lines.flatMap((line) => {
      const target = planFor(line);
      return target ? [{ line, to: target.to }] : [];
    });
    if (plans.length === 0) return 0;
    const paths = new Map<string, PathNode[]>();
    const pathOf = (posId: string) => {
      const known = paths.get(posId) ?? this.tree.pathOf(posId, accounts);
      paths.set(posId, known);
      return known;
    };
    const packageIds = [...new Set(plans.map(({ line }) => line.package.id))];

    // `'current'` needs the renewal targets each package lists today.
    const renewals = plans.some(({ to }) => to === 'current')
      ? await this.repo.renewalTargetsOf(tx, packageIds)
      : [];
    const targetsOf = new Map<string, PackageTerms[]>();
    for (const renewal of renewals) {
      if (!renewal.target.company || !renewal.target.provider) fail(400, 'INVALID');
      targetsOf.set(renewal.packageId, [...(targetsOf.get(renewal.packageId) ?? []), packageTermsOf(renewal.target)]);
    }

    // One read of the price rows serves every number in the batch, a flat price and `'current'` alike:
    // the batch's packages and the renewal targets they list, for every account on any number's path.
    const codes = new Set(plans.map(({ line }) => line.package.code));
    for (const targets of targetsOf.values()) for (const target of targets) codes.add(target.code);
    const pathIds = [...new Set(plans.flatMap(({ line }) => pathOf(line.posId).map((node) => node.id)))];
    const rows = await this.ladder.ladderRows([...codes], pathIds, tx);

    const fresh = new Map<string, LineTerms>();
    const floors = new Map<string, number>();
    const changes: { id: string; terms: LineTerms }[] = [];
    for (const { line, to } of plans) {
      const terms = lineTermsOf(line.terms, line.package);
      const path = pathOf(line.posId);
      // Every number of one package at one point of sale takes the same ladder and answers to the same floor, so each is worked out once.
      const key = `${line.package.id}:${line.posId}`;
      if (to === 'current') {
        if (!line.package.company || !line.package.provider) fail(400, 'INVALID');
        const ladder = fresh.get(key) ?? this.ladder.stampWith(captureTerms(packageTermsOf(line.package), targetsOf.get(line.package.id) ?? []), path, rows);
        fresh.set(key, ladder);
        changes.push({ id: line.id, terms: repriceLine(terms, { to, fresh: ladder }) });
        continue;
      }
      const floor =
        floors.get(key) ??
        floorFor(
          path,
          rows.termRows.filter((row) => row.packageId === line.package.id),
          rows.sellRows.filter((row) => row.packageId === line.package.id),
          line.package,
          'renewal',
        );
      floors.set(key, floor);
      if (to < floor) fail(400, 'PRICE_BELOW_FLOOR');
      changes.push({ id: line.id, terms: repriceLine(terms, { to }) });
    }
    for (const { id, terms } of changes) {
      await this.repo.saveLineTerms(tx, id, terms as unknown as Prisma.InputJsonValue);
    }
    return changes.length;
  }

  private canEditTerms(actor: Actor, target: Account): boolean {
    if (actor.impersonating) return false;
    if (target.parentId === actor.id) return true;
    return holds(actor, 'edit');
  }
}
