import { captureTerms, type LineTerms, type PackageTerms } from './prices';
import { groupChanges, groupLinePrices, repriceLine, stampRenewal } from './line-prices';

const basePrices = { branchCost: 30, mainPrice: 30, agentPrice: 30, posPrice: 30, subscriberPrice: 30 };

const pkgA300: PackageTerms = {
  code: 'a-300',
  companyCode: 'wecom',
  providerCode: 'lian',
  months: 1,
  forSale: true,
  subscription: { ...basePrices, posPrice: 3000 },
  renewal: { ...basePrices, posPrice: 3000 },
};
const pkgA600: PackageTerms = {
  code: 'a-600',
  companyCode: 'wecom',
  providerCode: 'lian',
  months: 3,
  forSale: true,
  subscription: { ...basePrices, posPrice: 6000 },
  renewal: { ...basePrices, posPrice: 6000 },
};

const terms: LineTerms = captureTerms(pkgA300, [pkgA600]);

const newer: PackageTerms = {
  code: 'b-100',
  companyCode: 'wecom',
  providerCode: 'lian',
  months: 1,
  forSale: true,
  subscription: { ...basePrices, posPrice: 5000 },
  renewal: { ...basePrices, posPrice: 5000 },
};
const newTarget: PackageTerms = {
  code: 'b-200',
  companyCode: 'wecom',
  providerCode: 'lian',
  months: 3,
  forSale: true,
  subscription: { ...basePrices, posPrice: 7000 },
  renewal: { ...basePrices, posPrice: 7000 },
};

describe('line-prices', () => {
  it('stamps the resolved renewal price into the ladder and the targets, nothing else', () => {
    const stamped = stampRenewal(terms, (code) => (code === 'a-300' ? 4100 : code === 'a-600' ? 5900 : null));
    expect(stamped.renewal.posPrice).toBe(4100);
    expect(stamped.renewalTargets[0].renewal.posPrice).toBe(5900);
    expect(stamped.renewal.branchCost).toBe(terms.renewal.branchCost);
    expect(stamped.subscription).toEqual(terms.subscription);
    expect(stampRenewal(terms, () => null)).toEqual(terms);
  });
  it('groups numbers by the renewal price they carry, lowest first', () => {
    const at = (posPrice: number) => ({ terms: { ...terms, renewal: { ...terms.renewal, posPrice } } });
    expect(groupLinePrices([at(4500), at(3500), at(4500), at(4100)])).toEqual([
      { price: 3500, count: 1 },
      { price: 4100, count: 1 },
      { price: 4500, count: 2 },
    ]);
    expect(groupLinePrices([])).toEqual([]);
  });
  it('a numeric plan changes the renewal pos price only', () => {
    const next = repriceLine(terms, { to: 4100 });
    expect(next.renewal.posPrice).toBe(4100);
    expect(next.renewalTargets).toEqual(terms.renewalTargets);
    expect(next.subscription).toEqual(terms.subscription);
  });
  it('a current plan takes the fresh ladder and targets but keeps identity, window, and subscription', () => {
    const fresh = { ...captureTerms(newer, [newTarget]), renewal: { ...newer.renewal, posPrice: 3700 } };
    const next = repriceLine({ ...terms, windowMonths: 3 }, { to: 'current', fresh });
    expect(next).toEqual({ ...fresh, packageCode: terms.packageCode, months: terms.months, windowMonths: 3, subscription: terms.subscription });
  });
  it('validates group changes and drops no-ops', () => {
    expect(groupChanges([{ from: 4500, to: 4100 }, { from: 3500, to: 3500 }, { from: 4100, to: 'current' }])).toEqual([
      { from: 4500, to: 4100 },
      { from: 4100, to: 'current' },
    ]);
    expect(groupChanges([{ from: 4500, to: -1 }])).toBeNull();
    expect(groupChanges([{ from: '45', to: 4100 }])).toBeNull();
    expect(groupChanges('x')).toBeNull();
  });
});
