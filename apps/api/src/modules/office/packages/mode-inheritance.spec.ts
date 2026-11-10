import { ProvidersRepository } from '../providers/providers.repository';
import { PackagesRepository } from './packages.repository';
import { OfficeGraph } from '../testing/office-graph';
import { MemoryAuthStore } from '../../auth/testing/memory-auth.store';
import type { Actor } from '../kernel/types';
import { ProvidersService } from '../providers/providers.service';
import { PackagesService } from './packages.service';

// Run modes that follow the provider (spec 2026-11-09-admin-review, 3): a package lists the actions it inherits; the
// provider's change reaches those and no other; a package can follow again or take a mode of its own.

const owner: Actor = { id: 'branch', loginName: 'branch', nickname: 'b', layer: 'branch', isBranchOwner: true, grants: [], operatorId: 'branch', impersonating: false };
const flags = {
  autoActivate: false, allowActivate: true, autoCharge: false, allowCharge: true, autoExtend: false, allowExtend: true,
  autoDisconnect: false, allowDisconnect: true, autoFreeze: false, allowFreeze: true, autoSwitch: false, allowSwitch: true,
  autoRename: false, allowRename: true, autoSim: false, allowSim: true,
};

function world() {
  const provider = { id: 'p1', code: 'sky', name: 'سكاي', actionModes: { activate: 'manual', charge: 'manual' } as Record<string, string> };
  const packages = [
    { id: 'k1', code: 'sky-a', providerId: 'p1', ...flags, actionModes: {}, inheritedModes: ['charge'] },
    { id: 'k2', code: 'sky-b', providerId: 'p1', ...flags, actionModes: {}, inheritedModes: [] as string[] },
  ];
  const kernel = new OfficeGraph(new MemoryAuthStore());
  const apply = (row: Record<string, unknown>, data: Record<string, unknown>) => Object.assign(row, data);
  kernel.prismaClient = {
    provider: {
      findUnique: async ({ where }: { where: { code?: string; id?: string } }) => (where.code === provider.code || where.id === provider.id ? provider : null),
      update: async ({ data }: { data: Record<string, unknown> }) => apply(provider, data),
    },
    package: {
      findUnique: async ({ where }: { where: { code: string } }) => packages.find((row) => row.code === where.code) ?? null,
      findMany: async ({ where }: { where: { providerId: string; inheritedModes: { has: string } } }) =>
        packages.filter((row) => row.providerId === where.providerId && row.inheritedModes.includes(where.inheritedModes.has)),
      update: async ({ where, data }: { where: { id?: string; code?: string }; data: Record<string, unknown> }) =>
        apply(packages.find((row) => row.id === where.id || row.code === where.code) as Record<string, unknown>, data),
    },
    $transaction: async (work: Promise<unknown>[]) => Promise.all(work),
  } as unknown as OfficeGraph['prismaClient'];
  return { provider, packages, providers: new ProvidersService(new ProvidersRepository(kernel.uow)), catalog: new PackagesService(kernel.uow, kernel.tree, kernel.ladder, new PackagesRepository(kernel.uow)) };
}

describe('run modes that follow the provider', () => {
  it('a provider change reaches only the packages that inherit that action', async () => {
    const { providers, packages } = world();
    expect(await providers.setMode(owner, 'sky', { action: 'charge', mode: 'auto' })).toEqual({ ok: true });
    expect(packages[0]).toMatchObject({ autoCharge: true, allowCharge: true });
    expect((packages[0].actionModes as Record<string, string>).charge).toBe('auto');
    expect(packages[1]).toMatchObject({ autoCharge: false, allowCharge: true });
  });

  it('a provider change to an action a package does not inherit leaves every package alone', async () => {
    const { providers, packages } = world();
    expect(await providers.setMode(owner, 'sky', { action: 'activate', mode: 'off' })).toEqual({ ok: true });
    expect(packages.every((row) => row.allowActivate)).toBe(true);
  });

  it('a package follows the provider again with «inherit», and stops following with a mode of its own', async () => {
    const { catalog, packages, provider } = world();
    provider.actionModes.activate = 'auto';
    await catalog.setMode(owner, 'sky-b', { action: 'activate', mode: 'inherit' });
    expect(packages[1].inheritedModes).toEqual(['activate']);
    expect(packages[1]).toMatchObject({ autoActivate: true, allowActivate: true });

    await catalog.setMode(owner, 'sky-a', { action: 'charge', mode: 'off' });
    expect(packages[0].inheritedModes).toEqual([]);
    expect(packages[0]).toMatchObject({ allowCharge: false });
  });

  it('refuses a mode it does not know', async () => {
    const { catalog } = world();
    await expect(catalog.setMode(owner, 'sky-a', { action: 'charge', mode: 'sometimes' })).rejects.toMatchObject({ status: 400 });
  });
});
