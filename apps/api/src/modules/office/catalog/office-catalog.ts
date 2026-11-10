import type { Prices } from '../rules/prices';

export const companies = [
  { code: 'cellcom', name: 'سلكوم' },
  { code: 'wecom', name: 'ويكوم' },
  { code: 'alloha', name: 'الوها' },
  { code: 'pelephone', name: 'بليفون' },
  { code: 'partner', name: 'بارتنر' },
  { code: 'hot', name: 'هوت موبايل' },
  { code: 'rami', name: 'رامي ليفي' },
  { code: '019', name: '019' },
  { code: 'kalam', name: 'كلام' },
  { code: 'symphony', name: 'سيمفوني' },
  { code: 'sky', name: 'سكاي' },
] as const;

export type CatalogPackage = {
  gb: number;
  months: number;
  price: number;
  forSale: boolean;
  subscription: Prices;
  renewal: Prices;
};
export type CatalogCompany = { code: string; name: string; packages: CatalogPackage[] };
export type CatalogProvider = { code: string; name: string; companies: CatalogCompany[] };

const companyByCode = new Map(companies.map((company) => [company.code, company.name]));

function pricesOf(amount: number): Prices {
  return {
    branchCost: amount,
    mainPrice: amount,
    agentPrice: amount,
    posPrice: amount,
    subscriberPrice: amount,
  };
}

function seedPackage(gb: number, months: number, price: number): CatalogPackage {
  const tier = pricesOf(price);
  return { gb, months, price, forSale: true, subscription: tier, renewal: { ...tier } };
}

function shelfCompany(code: (typeof companies)[number]['code'], packages: CatalogPackage[]): CatalogCompany {
  const name = companyByCode.get(code);
  if (!name) throw new Error(`Unknown company code: ${code}`);
  return { code, name, packages };
}

/** The wholesale pyramid: provider, then company, then package. The price is the branch cost; every layer starts at it. */
export const catalog: CatalogProvider[] = [
  {
    code: 'sky',
    name: 'سكاي',
    companies: [
      shelfCompany('cellcom', [seedPackage(300, 1, 35), seedPackage(400, 1, 41)]),
      shelfCompany('hot', [seedPackage(300, 1, 35), seedPackage(200, 1, 40), seedPackage(150, 1, 38)]),
      shelfCompany('pelephone', [seedPackage(350, 1, 35), seedPackage(500, 1, 45)]),
    ],
  },
  {
    code: 'lian',
    name: 'ليان',
    companies: [
      shelfCompany('wecom', [seedPackage(500, 1, 30), seedPackage(500, 3, 80)]),
      shelfCompany('rami', [seedPackage(200, 1, 35), seedPackage(500, 1, 60)]),
      shelfCompany('hot', [seedPackage(200, 1, 33)]),
      shelfCompany('partner', [seedPackage(500, 1, 39), seedPackage(300, 1, 33)]),
      shelfCompany('019', [seedPackage(100, 1, 33), seedPackage(200, 1, 35)]),
    ],
  },
  {
    code: 'aren',
    name: 'عرين',
    companies: [
      shelfCompany('cellcom', [seedPackage(400, 1, 44)]),
      shelfCompany('wecom', [seedPackage(500, 1, 32)]),
    ],
  },
  {
    code: 'quickline',
    name: 'كويك لاين',
    companies: [shelfCompany('cellcom', [seedPackage(400, 1, 40), seedPackage(400, 3, 75)])],
  },
  {
    code: 'alloha',
    name: 'الوها',
    companies: [
      shelfCompany('alloha', [seedPackage(150, 1, 30)]),
      shelfCompany('wecom', [seedPackage(500, 1, 30)]),
      shelfCompany('cellcom', [seedPackage(400, 1, 40)]),
    ],
  },
];

export function packageCode(provider: string, company: string, item: CatalogPackage): string {
  const span = item.months === 1 ? '' : `-${item.months}m`;
  return `${provider}-${company}-${item.gb}${span}`;
}

export function packageName(item: CatalogPackage): string {
  return item.months === 1 ? `${item.gb} جيجا` : `${item.gb} جيجا · ${item.months} أشهر`;
}
