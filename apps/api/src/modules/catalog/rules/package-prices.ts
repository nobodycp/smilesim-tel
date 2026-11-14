// Money units and a package's own prices: the eSIM fee and its source, the price chain the catalog stores and
// checks. Pure: no Nest, no Prisma. Slice R.3: from `rules/prices.ts`; what a line keeps of these is pricing's.

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

export type PriceField = 'main' | 'agent' | 'pos' | 'subscriber';

export type Prices = {
  branchCost: number;
  mainPrice: number;
  agentPrice: number;
  posPrice: number;
  subscriberPrice: number;
};

export function chainHolds(prices: Prices): boolean {
  return (
    prices.mainPrice >= prices.branchCost &&
    prices.agentPrice >= prices.mainPrice &&
    prices.posPrice >= prices.agentPrice &&
    prices.subscriberPrice >= prices.posPrice
  );
}
