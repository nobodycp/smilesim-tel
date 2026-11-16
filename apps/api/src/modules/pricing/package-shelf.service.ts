import { capList, fail, parseInput } from '../platform';
import { PriceLadder } from './price-ladder';
import { AccountTree, seesLayer } from '../access';
import { Injectable } from '@nestjs/common';
import type { Actor } from '../access';
import { editableField } from './rules/prices';
import { esimPriceOf, activateInputs, resolvePackageMode, simRulesOf, SellPriceBody } from '../catalog';
import { buyPriceFor, deniedOpsFor, layerPrice, visibleTo } from './rules/user-terms';
import { TermsRepository } from './terms.repository';

/**
 * The shelf of packages as one account sees it, with its buy and sell prices, and its own sell prices (slice R.8:
 * from `PackagesService`, text unchanged but for the shelf's query name). Prices are pricing's: the ladder, the
 * per-account terms and the sell prices; the package itself is the catalog's.
 */
@Injectable()
export class PackageShelfService {
  constructor(private readonly tree: AccountTree, private readonly ladder: PriceLadder, private readonly repo: TermsRepository) {}

  async list(actor: Actor) {
    const field = editableField(actor.layer);
    const [all, accounts] = await Promise.all([
      this.repo.shelfPackages(),
      this.tree.accounts(),
    ]);
    const { rows: onSale, capped } = capList(all);
    const path = this.tree.pathOf(actor.id, accounts);
    // Only the rows on the actor's path matter: its own terms and sell prices plus its ancestors'.
    const pathIds = path.map((node) => node.id);
    const [termRows, sellRows] = await Promise.all([
      this.repo.termRowsOf(pathIds),
      this.repo.sellRowsOf(pathIds),
    ]);
    const canActivate = !deniedOpsFor(path).has('activate');
    const termsOf = (packageId: string) => termRows.filter((row) => row.packageId === packageId);
    const sellsOf = (packageId: string) => sellRows.filter((row) => row.packageId === packageId);
    const rows = onSale.filter((row) => visibleTo(path, termsOf(row.id), row));
    // The layer the actor sells to; null for the branch (no sell price) and the point of sale.
    const sellsTo = actor.layer === 'main_agent' ? 'agent' : actor.layer === 'agent' ? 'pos' : null;
    const ownSell = (packageId: string) => sellRows.find((row) => row.packageId === packageId && row.ownerId === actor.id) ?? null;
    const branch = actor.layer === 'branch';
    const images = new Map<string, string>();
    for (const row of rows) {
      const name = row.company?.name ?? '';
      if (name && row.company?.image) images.set(name, row.company.image);
    }
    return {
      capped,
      companies: [...images].map(([name, image]) => ({ name, image })),
      packages: rows.map((row) => ({
        price: buyPriceFor(path, termsOf(row.id), sellsOf(row.id), row, 'subscription'),
        renewalPrice: buyPriceFor(path, termsOf(row.id), sellsOf(row.id), row, 'renewal'),
        canActivate,
        sellPrice: ownSell(row.id)?.price ?? null,
        sellRenewalPrice: ownSell(row.id)?.renewalPrice ?? null,
        sellDefault: sellsTo ? layerPrice(sellsTo, row, 'subscription') : null,
        sellRenewalDefault: sellsTo ? layerPrice(sellsTo, row, 'renewal') : null,
        code: row.code,
        name: row.name,
        // Which provider a package comes from, and whether it runs by itself or through a branch task, is the
        // branch's business (rule 3.4). The other layers are told what they need to sell it: whether it is on
        // sale, and what the activation form must ask for.
        providerCode: branch ? row.provider.code : null,
        providerName: branch ? row.provider.name : '',
        activateMode: branch ? resolvePackageMode(row.actionModes, row, 'activate') : null,
        sellable: resolvePackageMode(row.actionModes, row, 'activate') !== 'off',
        activateInput: activateInputs(row.provider.code),
        // Whether a number may be activated on it by porting, or by turning a prepaid card into a bill.
        // What the card shows a seller before the sale (spec 2026-11-16-package-page, P.7): the offer mark with its
        // line, and whether a number on this package can be disconnected at all (the package's disconnect is off).
        offer: row.offer,
        offerNote: row.offerNote ?? '',
        noDisconnect: resolvePackageMode(row.actionModes, row, 'disconnect') === 'off',
        canPort: row.portMode !== 'off',
        canConvert: row.convertMode !== 'off',
        companyName: row.company?.name ?? '',
        sim: simRulesOf(row.company, row),
        esimPrice: esimPriceOf({ pkg: row, provider: row.provider, company: row.company }).price,
        dataGb: row.dataGb,
        smsCount: row.smsCount,
        minutes: row.minutes,
        details: row.details ?? '',
        months: row.months,
        // A layer sees its own column and the ones below it, never what the layers above pay (rule 3.4).
        branchCost: seesLayer(actor.layer, 'branch') ? row.branchCost : null,
        mainPrice: seesLayer(actor.layer, 'main_agent') ? row.mainPrice : null,
        agentPrice: seesLayer(actor.layer, 'agent') ? row.agentPrice : null,
        posPrice: row.posPrice,
        subscriberPrice: row.subscriberPrice,
        editableField: field,
        // How the provider runs each operation is the branch's business.
        autoActivate: branch ? row.autoActivate : null,
        autoCharge: branch ? row.autoCharge : null,
        autoDisconnect: branch ? row.autoDisconnect : null,
        autoFreeze: branch ? row.autoFreeze : null,
        autoSwitch: branch ? row.autoSwitch : null,
      })),
    };
  }

  /** A main agent's or agent's own sell price for a package. The floor is what the actor itself pays. */
  async setSellPrice(actor: Actor, code: string, body: unknown) {
    if (actor.layer !== 'main_agent' && actor.layer !== 'agent') fail(403, 'FORBIDDEN');
    const { price, renewalPrice } = parseInput(SellPriceBody, body);
    const pkg = await this.repo.packageByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    const [accounts, { terms, sells }] = await Promise.all([this.tree.accounts(), this.ladder.termsFor(pkg.id)]);
    const path = this.tree.pathOf(actor.id, accounts);
    if (path.length === 0) fail(404, 'NOT_FOUND');
    if (price < buyPriceFor(path, terms, sells, pkg, 'subscription')) fail(400, 'PRICE_BELOW_FLOOR');
    if (renewalPrice !== null && renewalPrice < buyPriceFor(path, terms, sells, pkg, 'renewal')) fail(400, 'PRICE_BELOW_FLOOR');
    await this.repo.saveSellPrice(pkg.id, actor.id, price, renewalPrice);
    return { price, renewalPrice };
  }

  /** Drops the caller's own sell price so the layer column applies again; a missing row is already clear. */
  async clearSellPrice(actor: Actor, code: string) {
    if (actor.layer !== 'main_agent' && actor.layer !== 'agent') fail(403, 'FORBIDDEN');
    const pkg = await this.repo.packageByCode(code);
    if (!pkg) fail(404, 'NOT_FOUND');
    await this.repo.clearSellPrice(pkg.id, actor.id);
    return { ok: true };
  }
}
