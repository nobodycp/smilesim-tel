import { publicPackageCode } from './package-code';

describe('publicPackageCode', () => {
  const id = '3f9a2c1e-0000-4000-8000-000000000000';

  it('names the company and the size, and ends with the start of the id', () => {
    expect(publicPackageCode({ companyCode: 'cellcom', dataGb: 400, months: 1, id })).toBe('cellcom-400gb-3f9a2');
    expect(publicPackageCode({ companyCode: 'wecom', dataGb: 500, months: 3, id })).toBe('wecom-500gb-3m-3f9a2');
  });

  it('stands without a company or a size', () => {
    expect(publicPackageCode({ companyCode: null, dataGb: null, months: 1, id })).toBe('pkg-pkg-3f9a2');
  });

  it('gives two providers\' packages of one company and size different codes, neither naming a provider', () => {
    const sky = publicPackageCode({ companyCode: 'cellcom', dataGb: 400, months: 1, id: 'aaaaa111-0000-4000-8000-000000000000' });
    const lian = publicPackageCode({ companyCode: 'cellcom', dataGb: 400, months: 1, id: 'bbbbb222-0000-4000-8000-000000000000' });
    expect(sky).not.toBe(lian);
    expect(`${sky} ${lian}`).not.toMatch(/sky|lian/);
  });
});
