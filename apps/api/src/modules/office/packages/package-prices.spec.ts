import { tree } from '../tree-fixture';

// Review 2026-11-10, S2: the package list gives a layer its own price column and the ones below it, never what
// the layers above it pay, and how the provider runs an operation is the branch's alone.
describe('package list by layer', () => {
  type Row = Record<string, unknown>;
  const first = async (who: string) => {
    const { service, gates } = await tree();
    return ((await service.packages(gates[who])) as { packages: Row[] }).packages[0];
  };

  it('gives the branch the whole ladder and the run modes', async () => {
    expect(await first('branch')).toMatchObject({ branchCost: 2000, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, subscriberPrice: 3800, autoActivate: true });
  });

  it('hides the branch cost from a main agent', async () => {
    expect(await first('ma1')).toMatchObject({ branchCost: null, mainPrice: 2500, agentPrice: 3000, posPrice: 3500, autoActivate: null });
  });

  it('hides the branch cost and the main agent price from an agent', async () => {
    expect(await first('ag1')).toMatchObject({ branchCost: null, mainPrice: null, agentPrice: 3000, posPrice: 3500 });
  });

  it('gives a point of sale only its own column and the subscriber price', async () => {
    expect(await first('pos1')).toMatchObject({ branchCost: null, mainPrice: null, agentPrice: null, posPrice: 3500, subscriberPrice: 3800, autoActivate: null, price: 3500 });
  });
});
