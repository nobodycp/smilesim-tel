import {
  buyPriceFor,
  deniedAbove,
  deniedOpsFor,
  floorFor,
  hiddenAbove,
  layerPrice,
  parseOps,
  priceSource,
  serializeOps,
  visibleTo,
  type LayerPrices,
  type PathNode,
  type SellRow,
  type TermRow,
} from './user-terms';

const prices: LayerPrices = {
  branchCost: 2000,
  mainPrice: 2500,
  agentPrice: 3000,
  posPrice: 3500,
  renewalBranchCost: 1800,
  renewalMainPrice: 2200,
  renewalAgentPrice: 2700,
  renewalPosPrice: 3200,
};

const branch: PathNode = { id: 'b', loginName: 'branch', layer: 'branch', deniedOps: '' };
const ma1: PathNode = { id: 'ma1', loginName: 'ma1', layer: 'main_agent', deniedOps: '' };
const ag1: PathNode = { id: 'ag1', loginName: 'ag1', layer: 'agent', deniedOps: '' };
const pos1: PathNode = { id: 'pos1', loginName: 'pos1', layer: 'pos', deniedOps: '' };
const posPath = [pos1, ag1, ma1, branch];
const maPath = [ma1, branch];
const live = { enabled: true, forSale: true };

const term = (userId: string, patch: Partial<TermRow> = {}): TermRow => ({ userId, hidden: false, price: null, renewalPrice: null, ...patch });
const sell = (ownerId: string, price: number, renewalPrice: number | null = null): SellRow => ({ ownerId, price, renewalPrice });

describe('buyPriceFor', () => {
  it('falls to the layer column when no rows exist', () => {
    expect(buyPriceFor(posPath, [], [], prices, 'subscription')).toBe(3500);
    expect(buyPriceFor(posPath, [], [], prices, 'renewal')).toBe(3200);
  });
  it('uses the parent sell price before the layer column', () => {
    expect(buyPriceFor(posPath, [], [sell('ag1', 3100, 2650)], prices, 'subscription')).toBe(3100);
    expect(buyPriceFor(posPath, [], [sell('ag1', 3100, 2650)], prices, 'renewal')).toBe(2650);
  });
  it('a sell price without a renewal falls through to the renewal column', () => {
    expect(buyPriceFor(posPath, [], [sell('ag1', 3100)], prices, 'renewal')).toBe(3200);
  });
  it('uses the custom row before everything', () => {
    const terms = [term('pos1', { price: 2900, renewalPrice: 2800 })];
    expect(buyPriceFor(posPath, terms, [sell('ag1', 3100, 2650)], prices, 'subscription')).toBe(2900);
    expect(buyPriceFor(posPath, terms, [sell('ag1', 3100, 2650)], prices, 'renewal')).toBe(2800);
  });
  it('ignores a sell price set by a non-parent and rows of other users', () => {
    expect(buyPriceFor(posPath, [term('ag1', { price: 100 })], [sell('ma1', 100)], prices, 'subscription')).toBe(3500);
  });
  it('a main agent under the branch has no sell level', () => {
    expect(buyPriceFor(maPath, [], [sell('b', 100)], prices, 'subscription')).toBe(2500);
  });
  it('a branch account buys at cost', () => {
    expect(buyPriceFor([branch], [], [], prices, 'subscription')).toBe(2000);
    expect(layerPrice('branch', prices, 'renewal')).toBe(1800);
  });
});

describe('priceSource', () => {
  it('names the level that answered', () => {
    expect(priceSource(posPath, [], [], 'subscription')).toBe('layer');
    expect(priceSource(posPath, [], [sell('ag1', 3100)], 'subscription')).toBe('parent');
    expect(priceSource(posPath, [term('pos1', { price: 2900 })], [sell('ag1', 3100)], 'subscription')).toBe('custom');
    expect(priceSource(posPath, [], [sell('ag1', 3100)], 'renewal')).toBe('layer');
  });
});

describe('floorFor', () => {
  it('is the parent buy price', () => {
    expect(floorFor(posPath, [], [], prices, 'subscription')).toBe(3000);
    expect(floorFor(posPath, [term('ag1', { price: 2950 })], [], prices, 'subscription')).toBe(2950);
    expect(floorFor(maPath, [], [], prices, 'subscription')).toBe(2000);
    expect(floorFor([branch], [], [], prices, 'renewal')).toBe(1800);
  });
});

describe('visibility', () => {
  it('is hidden by a row on the user or on any ancestor', () => {
    expect(visibleTo(posPath, [], live)).toBe(true);
    expect(visibleTo(posPath, [term('pos1', { hidden: true })], live)).toBe(false);
    expect(visibleTo(posPath, [term('ag1', { hidden: true })], live)).toBe(false);
    expect(visibleTo(posPath, [term('ma1', { hidden: true })], live)).toBe(false);
    expect(visibleTo(posPath, [term('other', { hidden: true })], live)).toBe(true);
  });
  it('a disabled or unlisted package is never visible', () => {
    expect(visibleTo(posPath, [], { enabled: false, forSale: true })).toBe(false);
    expect(visibleTo(posPath, [], { enabled: true, forSale: false })).toBe(false);
  });
  it('hiddenAbove names the nearest ancestor and ignores the user itself', () => {
    expect(hiddenAbove(posPath, [term('ag1', { hidden: true }), term('ma1', { hidden: true })])).toBe('ag1');
    expect(hiddenAbove(posPath, [term('ma1', { hidden: true })])).toBe('ma1');
    expect(hiddenAbove(posPath, [term('pos1', { hidden: true })])).toBeNull();
  });
});

describe('operation stops', () => {
  const path = [
    { ...pos1, deniedOps: 'sim,bogus' },
    ag1,
    { ...ma1, deniedOps: 'charge' },
    branch,
  ];
  it('unions the path and drops unknown keys', () => {
    expect([...deniedOpsFor(path)].sort()).toEqual(['charge', 'sim']);
  });
  it('deniedAbove names the ancestor per inherited key', () => {
    expect(deniedAbove(path)).toEqual([{ op: 'charge', login: 'ma1' }]);
  });
  it('parses and serializes in display order', () => {
    expect(parseOps('sim,bogus,charge')).toEqual(['charge', 'sim']);
    expect(serializeOps(['sim', 'charge', 'sim'])).toBe('charge,sim');
    expect(parseOps('')).toEqual([]);
  });
});
