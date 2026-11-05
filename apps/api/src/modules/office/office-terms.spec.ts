import { packageTermsOf } from './office-terms';

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
describe('office line pricing', () => {
  it('saves shelf codes instead of database ids', () => {
    const terms = packageTermsOf({
      code: 'lian-wecom-month',
      providerId: 'provider-id',
      provider: { code: 'lian' },
      companyId: 'company-id',
      company: { code: 'wecom' },
      months: 1,
      forSale: true,
      ...subscription,
      renewalBranchCost: renewal.branchCost,
      renewalMainPrice: renewal.mainPrice,
      renewalAgentPrice: renewal.agentPrice,
      renewalPosPrice: renewal.posPrice,
      renewalSubscriberPrice: renewal.subscriberPrice,
    });

    expect(terms.companyCode).toBe('wecom');
    expect(terms.providerCode).toBe('lian');
  });

  it('rejects a package with no company on the shelf', () => {
    expect(() =>
      packageTermsOf({
        code: 'lian-wecom-month',
        providerId: 'provider-id',
        provider: { code: 'lian' },
        companyId: null,
        company: null,
        months: 1,
        forSale: true,
        ...subscription,
        renewalBranchCost: renewal.branchCost,
        renewalMainPrice: renewal.mainPrice,
        renewalAgentPrice: renewal.agentPrice,
        renewalPosPrice: renewal.posPrice,
        renewalSubscriberPrice: renewal.subscriberPrice,
      }),
    ).toThrow('INVALID');
  });
});
