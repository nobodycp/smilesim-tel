import { catalog, packageCode } from './office-catalog';

describe('wholesale catalog', () => {
  it('keeps the five providers and a distinct package under each company', () => {
    expect(catalog.map((provider) => provider.name)).toEqual(['سكاي', 'ليان', 'عرين', 'كويك لاين', 'الوها']);
    const codes = catalog.flatMap((provider) =>
      provider.companies.flatMap((company) => company.packages.map((item) => packageCode(provider.code, company.code, item))),
    );
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(22);
    expect(codes).toContain('sky-cellcom-300');
    expect(codes).toContain('lian-wecom-500-3m');
    expect(codes).toContain('quickline-cellcom-400-3m');
    expect(codes).toContain('alloha-alloha-150');
  });
});
