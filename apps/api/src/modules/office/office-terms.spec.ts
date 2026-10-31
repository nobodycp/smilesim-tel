import { captureTerms, type LineTerms, type PackageTerms } from './office-rules';
import { priced } from './office-terms';

const subscription = {
  branchCost: 20,
  mainPrice: 21,
  agentPrice: 23,
  posPrice: 25,
  subscriberPrice: 27,
};
const renewal = {
  branchCost: 24,
  mainPrice: 25,
  agentPrice: 27,
  posPrice: 30,
  subscriberPrice: 32,
};
const month: PackageTerms = {
  code: 'month',
  companyCode: 'company',
  providerCode: 'provider',
  months: 1,
  forSale: true,
  subscription,
  renewal,
};

describe('office line pricing', () => {
  it('wraps the saved subscription and renewal prices with a point-of-sale offer', () => {
    const terms: LineTerms = captureTerms(month, []);

    expect(priced('subscription', terms, null)).toBe(25);
    expect(priced('renewal', terms, null)).toBe(30);
    expect(priced('renewal', terms, 22)).toBe(22);
  });
});
