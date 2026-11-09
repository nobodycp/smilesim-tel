/**
 * What a provider's API answers about its catalog (spec 2026-11-09-admin-review, 3): the companies (operators) it
 * sells, and each company's products. Money is integer agorot. A real adapter per provider replaces the simulated one
 * once the provider's API documentation exists (`docs/project-plan.md`, «مزامنة المنتجات»).
 */
export type ProviderCompany = {
  code: string;
  name: string;
  /** The SIM serial rules the provider states for this company; the owner may change them before saving. */
  sim: { length: number | null; prefix: string; esim: boolean };
  esimPrice: number;
};

export type ProviderProduct = {
  /** The provider's own product code; a package added from it keeps it (`Package.providerProductCode`). */
  code: string;
  name: string;
  dataGb: number | null;
  smsCount: number | null;
  minutes: number | null;
  months: number;
  details: string;
  /** What the provider charges the branch: a new subscription, and a renewal. */
  cost: number;
  renewalCost: number;
  /** Extra operations the provider offers on this product, with its price for each. */
  addons: { name: string; price: number }[];
};

export interface ProviderAdapter {
  /** True while the answers are made up here, not read from the provider. */
  readonly simulated: boolean;
  companies(): Promise<ProviderCompany[]>;
  products(companyCode: string): Promise<ProviderProduct[]>;
}
