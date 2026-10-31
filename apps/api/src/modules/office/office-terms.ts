import { chargeDebit, type LineTerms, type PackageTerms, type Prices } from './office-rules';

export type PackagePriceRow = Prices & {
  code: string;
  providerId: string;
  companyId: string | null;
  months: number;
  forSale: boolean;
  company: { code: string };
  provider: { code: string };
  renewalBranchCost: number;
  renewalMainPrice: number;
  renewalAgentPrice: number;
  renewalPosPrice: number;
  renewalSubscriberPrice: number;
};

export function packageTermsOf(row: PackagePriceRow): PackageTerms {
  return {
    code: row.code,
    companyCode: row.company.code,
    providerCode: row.provider.code,
    months: row.months,
    forSale: row.forSale,
    subscription: {
      branchCost: row.branchCost,
      mainPrice: row.mainPrice,
      agentPrice: row.agentPrice,
      posPrice: row.posPrice,
      subscriberPrice: row.subscriberPrice,
    },
    renewal: {
      branchCost: row.renewalBranchCost,
      mainPrice: row.renewalMainPrice,
      agentPrice: row.renewalAgentPrice,
      posPrice: row.renewalPosPrice,
      subscriberPrice: row.renewalSubscriberPrice,
    },
  };
}

export function priced(kind: 'subscription' | 'renewal', terms: LineTerms, offer: number | null): number {
  const base = kind === 'subscription' ? terms.subscription.posPrice : chargeDebit(terms);
  return offer ?? base;
}
