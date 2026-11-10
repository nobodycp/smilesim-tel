import { OfficeFailure } from '../../shared/office-failure';
import { tree } from '../testing/tree.fixture';

// Line add-ons (spec 2026-11-09-offers-tasks-addons-wallet-esim, 3): an extra operation named on the package opens
// a manual task that holds its price; done, the point of sale pays it under the add-on's name.
describe('line add-ons', () => {
  async function setup() {
    const world = await tree();
    const addons = [
      { id: 'ad1', packageId: 'pa', name: '10 جيجا إضافية', price: 1500, active: true, position: 0 },
      { id: 'ad2', packageId: 'pa', name: 'موقوفة', price: 500, active: false, position: 1 },
      { id: 'ad3', packageId: 'pb', name: 'لرزمة أخرى', price: 700, active: true, position: 0 },
    ];
    const table = {
      findUnique: async ({ where }: { where: { id: string } }) => addons.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where }: { where: { packageId: string; active?: boolean } }) => addons.filter((row) => row.packageId === where.packageId && (where.active === undefined || row.active === where.active)),
    };
    (world.service as unknown as { prismaClient: { packageAddon: unknown } }).prismaClient.packageAddon = table;
    return world;
  }

  it('lists the package\'s live add-ons on the number\'s card', async () => {
    const { service, gates } = await setup();
    const card = await service.line(gates.pos1, 'ln1');
    expect((card.line as { addons: { name: string; price: number }[] }).addons).toEqual([{ id: 'ad1', name: '10 جيجا إضافية', price: 1500, packageId: 'pa', active: true, position: 0 }]);
  });

  it('opens a task that holds the price, and refuses a stopped add-on or one of another package', async () => {
    const { service, gates, tasks } = await setup();
    const answer = await service.requestAddon(gates.pos1, 'ln1', { addonId: 'ad1' });
    expect(answer).toMatchObject({ applied: false, taskId: expect.any(String) });
    expect(tasks.at(-1)).toMatchObject({ action: 'addon', status: 'working', posDelta: -1500, note: '10 جيجا إضافية', held: 1500 });
    await expect(service.requestAddon(gates.pos1, 'ln1', { addonId: 'ad2' })).rejects.toBeInstanceOf(OfficeFailure);
    await expect(service.requestAddon(gates.pos1, 'ln1', { addonId: 'ad3' })).rejects.toBeInstanceOf(OfficeFailure);
  });

  it('charges the add-on under its name when the branch marks the task done', async () => {
    const { service, gates, tasks, entries, wallet } = await setup();
    await service.requestAddon(gates.pos1, 'ln1', { addonId: 'ad1' });
    const id = tasks.at(-1)!.id as string;
    // The in-memory wallet cannot replay the hold's increment; the hold itself is checked in the test above.
    Object.assign(tasks.at(-1)!, { held: 0 });
    Object.assign(wallet, { held: 0 });
    await service.completeTask(gates.branch, id, {});
    expect(entries.find((row) => row.kind === 'addon')).toMatchObject({ kind: 'addon', amount: -1500, note: '10 جيجا إضافية' });
    expect(tasks.at(-1)).toMatchObject({ status: 'done' });
  });
});
