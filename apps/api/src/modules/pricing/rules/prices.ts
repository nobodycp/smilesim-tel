// What a line keeps of its package's prices (its terms), what the branch pays the provider for an operation, and
// which price a layer may edit. Pure: no Nest, no Prisma. The money unit and a package's own prices are the
// catalog's (`catalog/rules/package-prices.ts`); the credit ceiling is the wallets' (`wallets/ceiling.ts`). Slice R.3.

import { AGOROT, type PriceField, type Prices } from '../../catalog/rules/package-prices';

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

export function editableField(layer: string): PriceField | null {
  if (layer === 'branch') return 'main';
  if (layer === 'main_agent') return 'agent';
  if (layer === 'agent') return 'pos';
  return null;
}
