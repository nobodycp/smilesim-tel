import { Injectable } from '@nestjs/common';
import { UnitOfWork, type Db } from '../kernel/unit-of-work';
import { stampRenewal } from '../rules/line-prices';
import type { LineTerms } from '../rules/prices';
import { buyPriceFor, type LayerPrices, type PathNode, type SellRow, type TermRow } from '../rules/user-terms';

/** The price columns a renewal stamp reads from a package. */
export const PRICE_COLUMNS = {
  branchCost: true,
  mainPrice: true,
  agentPrice: true,
  posPrice: true,
  renewalBranchCost: true,
  renewalMainPrice: true,
  renewalAgentPrice: true,
  renewalPosPrice: true,
} as const;

/** Every package with the term and sell rows on it, for stamping renewal prices. */
export type LadderRows = {
  packages: (LayerPrices & { id: string; code: string })[];
  termRows: (TermRow & { packageId: string })[];
  sellRows: (SellRow & { packageId: string })[];
};

/** The rows that decide what each account on a path pays for a package: layer columns, custom prices, sell prices. */
@Injectable()
export class PriceLadder {
  constructor(private readonly uow: UnitOfWork) {}

  /** The custom rows and sell prices written on one package. */
  async termsFor(packageId: string, db: Db = this.uow.prisma): Promise<{ terms: TermRow[]; sells: SellRow[] }> {
    const [terms, sells] = await Promise.all([
      db.userPackage.findMany({ where: { packageId }, select: { userId: true, hidden: true, price: true, renewalPrice: true } }),
      db.sellPrice.findMany({ where: { packageId }, select: { ownerId: true, price: true, renewalPrice: true } }),
    ]);
    return { terms, sells };
  }

  /**
   * The rows behind what points of sale pay: the price columns of the packages named by `codes`, and
   * the custom rows and sell prices written on them for the accounts in `pathIds`. One read per table,
   * however many packages and paths are asked for, so a batch loads once and stamps every number from it.
   */
  async ladderRows(codes: string[], pathIds: string[], db: Db): Promise<LadderRows> {
    const packages = await db.package.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, ...PRICE_COLUMNS },
    });
    const ids = packages.map((row) => row.id);
    const [termRows, sellRows] = await Promise.all([
      db.userPackage.findMany({
        where: { packageId: { in: ids }, userId: { in: pathIds } },
        select: { packageId: true, userId: true, hidden: true, price: true, renewalPrice: true },
      }),
      db.sellPrice.findMany({
        where: { packageId: { in: ids }, ownerId: { in: pathIds } },
        select: { packageId: true, ownerId: true, price: true, renewalPrice: true },
      }),
    ]);
    return { packages, termRows, sellRows };
  }

  /**
   * The renewal prices written into terms once the rows are loaded: no database. `rows` may hold the rows of many
   * paths. Each price is resolved through `path` alone, so the rows of other accounts are never read for it.
   */
  stampWith(terms: LineTerms, path: PathNode[], rows: LadderRows): LineTerms {
    if (path.length === 0) return terms;
    return stampRenewal(terms, (code) => {
      const pkg = rows.packages.find((row) => row.code === code);
      if (!pkg) return null;
      const termsOf = rows.termRows.filter((row) => row.packageId === pkg.id);
      const sellsOf = rows.sellRows.filter((row) => row.packageId === pkg.id);
      return buyPriceFor(path, termsOf, sellsOf, pkg, 'renewal');
    });
  }
}
