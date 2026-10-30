export type CatalogPackage = { gb: number; months: number; price: number };
export type CatalogCompany = { code: string; name: string; packages: CatalogPackage[] };
export type CatalogProvider = { code: string; name: string; companies: CatalogCompany[] };

/** The wholesale pyramid: provider, then company, then package. The price is the branch cost; every layer starts at it. */
export const catalog: CatalogProvider[] = [
  {
    code: 'sky',
    name: 'سكاي',
    companies: [
      { code: 'cellcom', name: 'سليكوم', packages: [{ gb: 300, months: 1, price: 35 }, { gb: 400, months: 1, price: 41 }] },
      { code: 'hot', name: 'هوت موبايل', packages: [{ gb: 300, months: 1, price: 35 }, { gb: 150, months: 1, price: 30 }] },
      { code: 'pelephone', name: 'بليفون', packages: [{ gb: 350, months: 1, price: 35 }, { gb: 500, months: 1, price: 45 }] },
    ],
  },
  {
    code: 'lian',
    name: 'ليان',
    companies: [
      { code: 'wecom', name: 'ويكوم', packages: [{ gb: 500, months: 1, price: 30 }, { gb: 500, months: 3, price: 80 }] },
      { code: 'rami', name: 'رمي ليفي', packages: [{ gb: 200, months: 1, price: 35 }, { gb: 500, months: 1, price: 60 }] },
      { code: 'hot', name: 'هوت موبايل', packages: [{ gb: 200, months: 1, price: 33 }] },
      { code: 'partner', name: 'بارتنر', packages: [{ gb: 500, months: 1, price: 39 }, { gb: 300, months: 1, price: 33 }] },
      { code: '019', name: '019', packages: [{ gb: 100, months: 1, price: 33 }, { gb: 200, months: 1, price: 35 }] },
    ],
  },
  {
    code: 'aren',
    name: 'عرين',
    companies: [
      { code: 'cellcom', name: 'سليكوم', packages: [{ gb: 400, months: 1, price: 44 }] },
      { code: 'wecom', name: 'ويكوم', packages: [{ gb: 500, months: 1, price: 32 }] },
    ],
  },
  {
    code: 'quickline',
    name: 'كويك لاين',
    companies: [
      { code: 'cellcom', name: 'سليكوم', packages: [{ gb: 400, months: 1, price: 40 }, { gb: 400, months: 3, price: 75 }] },
    ],
  },
  {
    code: 'alloha',
    name: 'الوها',
    companies: [
      { code: 'alloha', name: 'الوها', packages: [{ gb: 150, months: 1, price: 30 }] },
      { code: 'wecom', name: 'ويكوم', packages: [{ gb: 500, months: 1, price: 30 }] },
      { code: 'cellcom', name: 'سليكوم', packages: [{ gb: 400, months: 1, price: 40 }] },
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
