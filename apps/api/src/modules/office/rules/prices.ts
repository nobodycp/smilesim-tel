// Money units, the price ladder of a package and what a line keeps of it (its terms). Pure: no Nest, no Prisma.

/** One shekel is 100 agorot. Money columns store agorot. */
export const AGOROT = 100;
/** Five shekels, what a point of sale pays for an eSIM when no company, provider, or package says otherwise. Kept out of a disconnect split. */
export const ESIM_PRICE_DEFAULT = 5 * AGOROT;

export type EsimPriceSource = 'package' | 'provider' | 'company';
type PricedEsim = { esimPrice?: number | null } | null | undefined;

/** The package price wins, then the provider, then the company. A company without a price is the default. */
export function esimPriceOf(parts: { pkg?: PricedEsim; provider?: PricedEsim; company?: PricedEsim }): { price: number; source: EsimPriceSource } {
  if (typeof parts.pkg?.esimPrice === 'number') return { price: parts.pkg.esimPrice, source: 'package' };
  if (typeof parts.provider?.esimPrice === 'number') return { price: parts.provider.esimPrice, source: 'provider' };
  if (typeof parts.company?.esimPrice === 'number') return { price: parts.company.esimPrice, source: 'company' };
  return { price: ESIM_PRICE_DEFAULT, source: 'company' };
}

/**
 * What the branch pays the provider for an activation: the subscription branch cost, plus the eSIM fee when
 * the line is an eSIM. The eSIM fee is the same price the point of sale pays; there is no separate cost.
 * Stored on the wallet entry so provider operations read it back as it was on the day.
 */
export function activationProviderCost(subscriptionBranchCost: number, esim: boolean, esimFee: number): number | undefined {
  return esim ? subscriptionBranchCost + esimFee : undefined;
}
/** Half a shekel. The provider's disconnect fee, inside the one disconnect posting. */
export const DISCONNECT_FEE = AGOROT / 2;
export type PriceField = 'main' | 'agent' | 'pos' | 'subscriber';

export type Prices = {
  branchCost: number;
  mainPrice: number;
  agentPrice: number;
  posPrice: number;
  subscriberPrice: number;
};

export type PackageTerms = {
  code: string;
  companyCode: string;
  providerCode: string;
  months: number;
  forSale: boolean;
  subscription: Prices;
  renewal: Prices;
};

export type RenewalTarget = { code: string; months: number; renewal: Prices };

export type LineTerms = {
  packageCode: string;
  months: number;
  /** Cycle length of the window that ends at `endsAt`, when it differs from `months`. */
  windowMonths?: number;
  subscription: Prices;
  renewal: Prices;
  renewalTargets: RenewalTarget[];
};

export function captureTerms(pkg: PackageTerms, targets: PackageTerms[]): LineTerms {
  return {
    packageCode: pkg.code,
    months: pkg.months,
    subscription: { ...pkg.subscription },
    renewal: { ...pkg.renewal },
    renewalTargets: targets.map((target) => ({
      code: target.code,
      months: target.months,
      renewal: { ...target.renewal },
    })),
  };
}

const RENEWAL_COST_KINDS = new Set(['charge', 'extend', 'reactivate']);
const SUBSCRIPTION_COST_KINDS = new Set(['activate', 'switch']);

/** What the branch pays the provider for one line operation. Other kinds cost nothing. */
export function providerBranchCost(
  kind: string,
  terms: { subscription?: { branchCost?: number }; renewal?: { branchCost?: number } } | null,
  fallback: { branchCost: number; renewalBranchCost: number } | null,
): number {
  const renewal = RENEWAL_COST_KINDS.has(kind);
  if (!renewal && !SUBSCRIPTION_COST_KINDS.has(kind)) return 0;
  const saved = (renewal ? terms?.renewal : terms?.subscription)?.branchCost;
  if (typeof saved === 'number') return saved;
  if (!fallback) return 0;
  return renewal ? fallback.renewalBranchCost : fallback.branchCost;
}

export function withinCeiling(layer: string, balance: number, ceiling: number, debit: number): boolean {
  if (debit <= 0) return true;
  if (layer === 'branch') return true;
  return balance - debit >= -ceiling;
}

export function chainHolds(prices: Prices): boolean {
  return (
    prices.mainPrice >= prices.branchCost &&
    prices.agentPrice >= prices.mainPrice &&
    prices.posPrice >= prices.agentPrice &&
    prices.subscriberPrice >= prices.posPrice
  );
}

export function editableField(layer: string): PriceField | null {
  if (layer === 'branch') return 'main';
  if (layer === 'main_agent') return 'agent';
  if (layer === 'agent') return 'pos';
  return null;
}
