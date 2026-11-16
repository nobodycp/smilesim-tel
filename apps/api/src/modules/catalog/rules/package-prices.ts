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

/** A duration's unit. A month is 30 days, as a paid period has always been. */
export type DurationUnit = 'day' | 'month';
export const MONTH_DAYS = 30;

export function durationDays(unit: string, count: number): number {
  return (unit === 'month' ? MONTH_DAYS : 1) * Math.max(1, count);
}

/**
 * The one duration row every package has while its own columns still hold a duration and a renewal ladder (plan
 * D.2 to D.10): its months at its renewal prices. Written in the same statement as those columns, so they agree.
 */
export function mirroredDuration(months: number, renewal: Prices): { unit: DurationUnit; count: number } & Prices {
  return {
    unit: 'month',
    count: Math.max(1, months),
    branchCost: renewal.branchCost,
    mainPrice: renewal.mainPrice,
    agentPrice: renewal.agentPrice,
    posPrice: renewal.posPrice,
    subscriberPrice: renewal.subscriberPrice,
  };
}

/** Whether a duration is the one that mirrors the package's own months (plan D.2 to D.10). */
export function isMirroredDuration(months: number, duration: { unit: string; count: number }): boolean {
  return duration.unit === 'month' && duration.count === Math.max(1, months);
}
