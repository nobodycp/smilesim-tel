import { chainHolds, visibleAccountIds, withinCeiling, withPrice } from './office-rules';

const trial = { branchCost: 25, mainPrice: 30, agentPrice: 35, posPrice: 38, subscriberPrice: 45 };

describe('office money and price rules', () => {
  it('lets the branch wallet go negative without a ceiling', () => {
    expect(withinCeiling('branch', 0, 0, 30)).toBe(true);
  });

  it('stops a point of sale at its ceiling', () => {
    expect(withinCeiling('pos', 10, 0, 38)).toBe(false);
    expect(withinCeiling('pos', 10, 30, 38)).toBe(true);
    expect(withinCeiling('pos', 10, 30, 41)).toBe(false);
  });

  it('keeps each sell price at or above the buy price', () => {
    expect(chainHolds(trial)).toBe(true);
    expect(chainHolds(withPrice(trial, 'main', 24))).toBe(false);
    expect(chainHolds(withPrice(trial, 'agent', 30))).toBe(true);
    expect(chainHolds(withPrice(trial, 'agent', 29))).toBe(false);
    expect(chainHolds(withPrice(trial, 'pos', 40))).toBe(true);
    expect(chainHolds(withPrice(trial, 'pos', 34))).toBe(false);
    expect(chainHolds(withPrice(trial, 'subscriber', 38))).toBe(true);
  });

  it('shows a main agent its own accounts and the accounts under it', () => {
    const nodes = [
      { id: 'b', parentId: null, layer: 'branch' },
      { id: 'm', parentId: 'b', layer: 'main_agent' },
      { id: 'a', parentId: 'm', layer: 'agent' },
      { id: 'p', parentId: 'a', layer: 'pos' },
    ];
    expect([...visibleAccountIds('m', 'main_agent', nodes)].sort()).toEqual(['a', 'm', 'p']);
    expect(visibleAccountIds('b', 'branch', nodes).size).toBe(4);
    expect([...visibleAccountIds('p', 'pos', nodes)]).toEqual(['p']);
  });
});
