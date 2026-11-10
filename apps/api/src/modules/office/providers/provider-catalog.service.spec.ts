import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import { OfficeKernel } from '../kernel/office-kernel';
import type { Actor } from '../kernel/types';
import { ProviderCatalogService } from './provider-catalog.service';

// Adding to the catalog from the provider (spec 2026-11-09-admin-review, 3), over the simulated adapter: the query
// marks what the office already has; a company and a package are added from what the provider answered.

const owner: Actor = { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'branch', impersonating: false };
const clerk: Actor = { ...owner, id: 'clerk', loginName: 'clerk', isBranchOwner: false, grants: [] };
const agent: Actor = { ...owner, id: 'agent', loginName: 'agent', layer: 'agent', isBranchOwner: false };
const ladder = (base: number) => ({ branchCost: base, mainPrice: base + 300, agentPrice: base + 500, posPrice: base + 700, subscriberPrice: base + 1000 });

function world() {
  const provider = { id: 'p-sky', code: 'sky', name: 'سكاي', actionModes: { activate: 'auto', charge: 'manual' } };
  const companies = [{ id: 'c-cell', code: 'cellcom', name: 'سلكوم' }] as { id: string; code: string; name: string }[];
  const packages = [{ id: 'k1', code: 'sky-cellcom-300', providerId: 'p-sky', providerProductCode: null as string | null }];
  const created: Record<string, unknown>[] = [];
  const kernel = new OfficeKernel(new MemoryAuthStore());
  kernel.prismaClient = {
    provider: { findUnique: async ({ where }: { where: { code: string } }) => (where.code === 'sky' ? provider : null) },
    company: {
      findMany: async ({ where }: { where: { code: { in: string[] } } }) => companies.filter((row) => where.code.in.includes(row.code)),
      findUnique: async ({ where }: { where: { code: string } }) => companies.find((row) => row.code === where.code) ?? null,
      create: async ({ data }: { data: { code: string; name: string } }) => {
        const row = { id: `c-${data.code}`, ...data };
        companies.push(row);
        created.push({ company: data });
        return row;
      },
    },
    package: {
      findMany: async () => packages,
      findFirst: async ({ where }: { where: { OR: [{ code: string }, { providerProductCode: string }] } }) =>
        packages.find((row) => row.code === where.OR[0].code || row.providerProductCode === where.OR[1].providerProductCode) ?? null,
      create: async ({ data }: { data: { code: string } }) => {
        created.push({ package: data });
        return { ...data };
      },
    },
  } as unknown as OfficeKernel['prismaClient'];
  return { service: new ProviderCatalogService(kernel), created, companies };
}

describe('ProviderCatalogService', () => {
  it('queries the provider\'s companies and marks the ones the office has', async () => {
    const result = await world().service.companies(owner, 'sky');
    expect(result.simulated).toBe(true);
    expect(result.companies.find((row) => row.code === 'cellcom')?.added).toBe(true);
    expect(result.companies.find((row) => row.code === 'golan')).toMatchObject({ name: 'جولان تليكوم', added: false });
  });

  it('queries a company\'s products and marks the ones already added as packages', async () => {
    const { products } = await world().service.products(owner, 'sky', 'cellcom');
    expect(products.find((row) => row.code === 'sky-cellcom-300')?.added).toBe(true);
    const fresh = products.find((row) => !row.added);
    expect(fresh).toMatchObject({ added: false, months: expect.any(Number), cost: expect.any(Number) });
    expect(fresh?.addons.length).toBeGreaterThan(0);
  });

  it('keeps the query and the adding to the owner and the edit grant', async () => {
    await expect(world().service.companies(clerk, 'sky')).rejects.toMatchObject({ status: 403 });
    await expect(world().service.companies(agent, 'sky')).rejects.toMatchObject({ status: 403 });
    // Past the gate: an empty body is judged (400), where a clerk without the grant never gets that far (403).
    await expect(world().service.createPackage({ ...clerk, grants: ['edit'] }, {})).rejects.toMatchObject({ status: 400 });
  });

  it('adds a company the provider sells, and refuses one the office has', async () => {
    const { service, created } = world();
    expect(await service.createCompany(owner, { providerCode: 'sky', companyCode: 'golan', simLength: 19, simPrefix: '89972', esim: true, esimPrice: 400 })).toEqual({ ok: true, code: 'golan' });
    expect(created[0]).toEqual({ company: { code: 'golan', name: 'جولان تليكوم', iccidLength: 19, iccidPrefix: '89972', esim: true, esimPrice: 400 } });
    await expect(service.createCompany(owner, { providerCode: 'sky', companyCode: 'cellcom' })).rejects.toMatchObject({ status: 409, code: 'COMPANY_EXISTS' });
    await expect(service.createCompany(owner, { providerCode: 'sky', companyCode: 'nowhere' })).rejects.toMatchObject({ status: 404, code: 'PRODUCT_NOT_FOUND' });
  });

  it('adds a package from a product: inherited modes take the provider\'s, own modes stay, add-ons come along', async () => {
    const { service, created } = world();
    const { products } = await service.products(owner, 'sky', 'cellcom');
    const product = products.find((row) => !row.added)!;
    const result = await service.createPackage(owner, {
      providerCode: 'sky', companyCode: 'cellcom', productCode: product.code,
      subscription: ladder(4000), renewal: ladder(3800),
      modes: { charge: 'auto', disconnect: 'off' },
      addons: [{ name: '10 جيجا إضافية', price: 1500 }],
    });
    expect(result).toEqual({ ok: true, code: product.code, companyCode: 'cellcom' });
    const data = created[0].package as Record<string, unknown>;
    expect(data).toMatchObject({
      code: product.code, providerProductCode: product.code, name: product.name, providerId: 'p-sky', companyId: 'c-cell',
      branchCost: 4000, subscriberPrice: 5000, renewalBranchCost: 3800,
      autoActivate: true, allowActivate: true, autoCharge: true, allowDisconnect: false,
      addons: { create: [{ name: '10 جيجا إضافية', price: 1500, position: 0 }] },
    });
    expect(data.inheritedModes).toEqual(expect.arrayContaining(['activate', 'extend', 'freeze']));
    expect(data.inheritedModes).not.toContain('charge');
    expect(data.inheritedModes).not.toContain('disconnect');
  });

  it('refuses a package already added, a price ladder that drops, and an unknown mode', async () => {
    const { service } = world();
    const base = { providerCode: 'sky', companyCode: 'cellcom', subscription: ladder(4000), renewal: ladder(3800) };
    await expect(service.createPackage(owner, { ...base, productCode: 'sky-cellcom-300' })).rejects.toMatchObject({ status: 409, code: 'PACKAGE_EXISTS' });
    const { products } = await service.products(owner, 'sky', 'cellcom');
    const productCode = products.find((row) => !row.added)!.code;
    await expect(service.createPackage(owner, { ...base, productCode, subscription: { ...ladder(4000), posPrice: 100 } })).rejects.toMatchObject({ status: 400, code: 'PRICE_BELOW_FLOOR' });
    await expect(service.createPackage(owner, { ...base, productCode, modes: { charge: 'sometimes' } })).rejects.toMatchObject({ status: 400 });
  });
});
