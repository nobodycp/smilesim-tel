import { catalog, companies as seededCompanies, packageCode, packageName, type CatalogPackage } from '../../office-catalog';
import type { ProviderAdapter, ProviderCompany, ProviderProduct } from './provider-adapter';

const AGOROT = 100;

/** Companies a provider offers that the office has not added yet, so «إضافة شركة» has something to find. */
const NEW_COMPANIES: ProviderCompany[] = [
  { code: 'golan', name: 'جولان تليكوم', sim: { length: 19, prefix: '89972', esim: true }, esimPrice: 500 },
  { code: 'xphone', name: 'إكس فون', sim: { length: 19, prefix: '89973', esim: false }, esimPrice: 500 },
];

/** Tiers a provider sells beyond the seeded ones: GB and months. */
const MORE_TIERS: { gb: number; months: number }[] = [
  { gb: 100, months: 1 },
  { gb: 250, months: 1 },
  { gb: 600, months: 1 },
  { gb: 250, months: 3 },
];

const ADDONS = [
  { name: '10 جيجا إضافية', price: 15 * AGOROT },
  { name: 'تجوال أسبوع', price: 25 * AGOROT },
];

/** A made-up but steady price: more data and more months cost more. */
const costOf = (gb: number, months: number) => Math.round((20 + gb / 20) * months * (months > 1 ? 0.9 : 1)) * AGOROT;

/**
 * The provider's catalog, made up from the seed (spec 2026-11-09-admin-review, 3; owner: «ابني وهمي حالياً»), the
 * way matching is simulated. The seeded packages come back with the codes they were stored under, so they read as
 * already added; a few more tiers and two new companies are there to add. The same provider always answers the same.
 */
export class SimulatedProviderAdapter implements ProviderAdapter {
  readonly simulated = true;

  constructor(private readonly providerCode: string) {}

  private seeded() {
    return catalog.find((provider) => provider.code === this.providerCode)?.companies ?? [];
  }

  async companies(): Promise<ProviderCompany[]> {
    const own = this.seeded().map((company) => ({
      code: company.code,
      name: company.name,
      sim: { length: null, prefix: '', esim: true },
      esimPrice: 500,
    }));
    return [...own, ...NEW_COMPANIES];
  }

  async products(companyCode: string): Promise<ProviderProduct[]> {
    const known = this.seeded().find((company) => company.code === companyCode);
    const isCompany = known || NEW_COMPANIES.some((company) => company.code === companyCode) || seededCompanies.some((company) => company.code === companyCode);
    if (!isCompany) return [];
    const seededTiers = (known?.packages ?? []).map((item) => ({
      code: packageCode(this.providerCode, companyCode, item),
      name: packageName(item),
      gb: item.gb,
      months: item.months,
      cost: item.subscription.branchCost * AGOROT,
      renewalCost: item.renewal.branchCost * AGOROT,
    }));
    const taken = new Set(seededTiers.map((tier) => `${tier.gb}-${tier.months}`));
    const more = MORE_TIERS.filter((tier) => !taken.has(`${tier.gb}-${tier.months}`)).map((tier) => {
      // The code and the name read only the GB and the months.
      const item = { gb: tier.gb, months: tier.months } as CatalogPackage;
      return { code: packageCode(this.providerCode, companyCode, item), name: packageName(item), gb: tier.gb, months: tier.months, cost: costOf(tier.gb, tier.months), renewalCost: costOf(tier.gb, tier.months) };
    });
    return [...seededTiers, ...more].map((tier, index) => ({
      code: tier.code,
      name: tier.name,
      dataGb: tier.gb,
      smsCount: index % 2 === 0 ? -1 : 500,
      minutes: -1,
      months: tier.months,
      details: '',
      cost: tier.cost,
      renewalCost: tier.renewalCost,
      addons: tier.gb >= 300 ? ADDONS : ADDONS.slice(0, 1),
    }));
  }
}

/** The adapter for a provider: every provider is simulated until its real adapter is written. */
export function adapterFor(providerCode: string): ProviderAdapter {
  return new SimulatedProviderAdapter(providerCode);
}
