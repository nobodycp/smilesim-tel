import { catalog, companies, packageCode } from './office-catalog';

describe('wholesale catalog', () => {
  it('lists the eleven company shelf names', () => {
    expect(companies.map((company) => company.name)).toEqual([
      'سلكوم',
      'ويكوم',
      'الوها',
      'بليفون',
      'بارتنر',
      'هوت موبايل',
      'رامي ليفي',
      '019',
      'كلام',
      'سيمفوني',
      'سكاي',
    ]);
    expect(catalog.find((provider) => provider.code === 'lian')?.companies.find((company) => company.code === 'wecom')?.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gb: 500, months: 1, price: 30 }),
        expect.objectContaining({ gb: 500, months: 3, price: 80 }),
      ]),
    );
  });

  it('keeps the five providers and a distinct package under each company', () => {
    expect(catalog.map((provider) => provider.name)).toEqual(['سكاي', 'ليان', 'عرين', 'كويك لاين', 'الوها']);
    const codes = catalog.flatMap((provider) =>
      provider.companies.flatMap((company) => company.packages.map((item) => packageCode(provider.code, company.code, item))),
    );
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(23);
    expect(codes).toContain('sky-hot-200');
    expect(codes).toContain('sky-cellcom-300');
    expect(codes).toContain('lian-wecom-500-3m');
    expect(codes).toContain('quickline-cellcom-400-3m');
    expect(codes).toContain('alloha-alloha-150');
  });
});
