import 'reflect-metadata';
import { groupLinePrices } from './line-prices';
import { captureTerms, type LineTerms } from './office-rules';
import { packageTermsOf, type PackagePriceRow } from './office-terms';
import { account, tree, type Row } from './testing/tree.fixture';

/** A number beside the tree's first line: the same package and point of sale, carrying `posPrice` at renewal. */
const at = (line: Row, id: string, posPrice: number, status = 'active'): Row => ({
  ...line,
  id,
  msisdn: `05210000${id}`,
  status,
  terms: { ...(line.terms as LineTerms), renewal: { ...(line.terms as LineTerms).renewal, posPrice } },
});

/** The tree plus the numbers the price tests start from: two at 4500, one frozen at 4100, and a disconnected one at 9900 that no save may touch. */
async function withNumbers() {
  const fixture = await tree();
  const { lines, line } = fixture;
  lines.push(at(line, 'ln2', 4500), at(line, 'ln3', 4500), at(line, 'ln4', 4100, 'frozen'), at(line, 'ln5', 9900, 'disconnected'));
  return fixture;
}

describe('catalog through user terms', () => {
  it('omits a package hidden on the agent from the point of sale, not from the main agent', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'ag1', hidden: true, price: null, renewalPrice: null });
    const pos = await service.packages(gates.pos1);
    expect(pos.packages.map((row) => row.code)).toEqual(['alloha-150']);
    const ma = await service.packages(gates.ma1);
    expect(ma.packages.map((row) => row.code).sort()).toEqual(['alloha-150', 'alloha-400']);
  });

  it('shows the point of sale its own price and whether it may activate', async () => {
    const { service, gates, userPackages, accounts } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: 2900, renewalPrice: null });
    (accounts.find((row) => row.id === 'ma1') as Row).deniedOps = 'activate';
    const pos = await service.packages(gates.pos1);
    const row = pos.packages.find((item) => item.code === 'alloha-150');
    expect(row).toMatchObject({ price: 2900, renewalPrice: 3200, canActivate: false });
    const plain = pos.packages.find((item) => item.code === 'alloha-400');
    expect(plain).toMatchObject({ price: 3500, renewalPrice: 3200, canActivate: false });
  });

  it('shows an agent its own sell price and the layer default it replaces', async () => {
    const { service, gates, sellPrices } = await tree();
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: null });
    const agent = await service.packages(gates.ag1);
    const row = agent.packages.find((item) => item.code === 'alloha-150');
    expect(row).toMatchObject({ sellPrice: 3700, sellRenewalPrice: null, sellDefault: 3500, sellRenewalDefault: 3200 });
    const plain = agent.packages.find((item) => item.code === 'alloha-400');
    expect(plain).toMatchObject({ sellPrice: null, sellRenewalPrice: null, sellDefault: 3500 });
    const pos = await service.packages(gates.pos1);
    expect(pos.packages.find((item) => item.code === 'alloha-150')).toMatchObject({ price: 3700, sellDefault: null });
  });
});

describe('run path through user terms', () => {
  it('refuses to activate a package hidden above the point of sale', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'ag1', hidden: true, price: null, renewalPrice: null });
    await expect(service.activate(gates.branch, { packageCode: 'alloha-150', posLogin: 'pos1', iccid: '8997202000000000002', outcome: 'success' }))
      .rejects.toMatchObject({ code: 'PACKAGE_HIDDEN' });
  });

  it('a charge stopped on the main agent is refused and absent for the point of sale', async () => {
    const { service, gates, accounts, line } = await tree();
    (accounts.find((row) => row.id === 'ma1') as Row).deniedOps = 'charge';
    line.status = 'disconnected';
    await expect(service.operate(gates.pos1, 'ln1', 'charge', { outcome: 'success' })).rejects.toMatchObject({ code: 'OPERATION_DENIED', status: 403 });
    const card = await service.line(gates.pos1, 'ln1');
    expect(card.line.operations).not.toContain('charge');
  });

  it('the user stop is checked before the package mode', async () => {
    const { service, gates, accounts, pkgA } = await tree();
    (accounts.find((row) => row.id === 'pos1') as Row).deniedOps = 'freeze';
    pkgA.actionModes = { freeze: 'off' };
    await expect(service.operate(gates.pos1, 'ln1', 'freeze', { outcome: 'success' })).rejects.toMatchObject({ code: 'OPERATION_DENIED' });
  });

  it('an eSIM request stopped on the account is refused', async () => {
    const { service, gates, accounts } = await tree();
    (accounts.find((row) => row.id === 'pos1') as Row).deniedOps = 'esim';
    await expect(service.requestEsim(gates.pos1, 'ln1')).rejects.toMatchObject({ code: 'OPERATION_DENIED' });
  });

  it('a switch target hidden above the point of sale is not offered', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'ag1', hidden: true, price: null, renewalPrice: null });
    const card = await service.line(gates.pos1, 'ln1');
    expect(card.line.switchTargets).toEqual([]);
    await expect(service.switchPackage(gates.pos1, 'ln1', { packageCode: 'alloha-400', outcome: 'success' })).rejects.toMatchObject({ code: 'PACKAGE_HIDDEN' });
  });

  it('activation debits the special price, else the parent sell price, else the layer price', async () => {
    const activate = (iccid: string) => ({ packageCode: 'alloha-150', posLogin: 'pos1', iccid, outcome: 'success' as const });
    const custom = await tree();
    custom.userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: 2900, renewalPrice: null });
    await custom.service.activate(custom.gates.pos1, activate('8997202000000000002'));
    expect(custom.entries[0]).toMatchObject({ kind: 'activate', amount: -2900 });

    const sold = await tree();
    sold.sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: null });
    await sold.service.activate(sold.gates.pos1, activate('8997202000000000003'));
    expect(sold.entries[0]).toMatchObject({ kind: 'activate', amount: -3700 });

    const plain = await tree();
    await plain.service.activate(plain.gates.pos1, activate('8997202000000000004'));
    expect(plain.entries[0]).toMatchObject({ kind: 'activate', amount: -3500 });
  });

  it('moving a point of sale drops the terms its old parent wrote', async () => {
    const { service, gates, userPackages, accounts } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: 2900, renewalPrice: null });
    userPackages.push({ id: 'r2', packageId: 'pa', userId: 'ag1', hidden: true, price: null, renewalPrice: null });
    await service.transferAccount(gates.branch, 'pos1', { parentLogin: 'ag2', ownPrices: 'reset', ownStops: 'keep', linePrices: 'keep' });
    expect(userPackages.map((row) => row.userId)).toEqual(['ag1']);
    expect((accounts.find((row) => row.id === 'pos1') as Row).parentId).toBe('ag2');
  });
});

describe('me and the stops on the actor path', () => {
  const setStops = (accounts: { id: string }[], id: string, deniedOps: string) => { (accounts.find((item) => item.id === id) as Row).deniedOps = deniedOps; };

  it('an agent learns the stop its main agent carries; the branch above it learns none', async () => {
    const { service, gates, accounts } = await tree();
    setStops(accounts, 'ma1', 'transfer');
    await expect(service.me(gates.ag1)).resolves.toMatchObject({ stops: ['transfer'] });
    await expect(service.me(gates.branch)).resolves.toMatchObject({ stops: [] });
  });

  it('counts the actor own node, passes a stop down to a point of sale, and leaves the other branches of the tree alone', async () => {
    const { service, gates, accounts } = await tree();
    setStops(accounts, 'ma1', 'transfer');
    expect((await service.me(gates.ma1)).stops).toEqual(['transfer']);
    expect((await service.me(gates.pos1)).stops).toEqual(['transfer']);
    setStops(accounts, 'ma1', '');
    setStops(accounts, 'ag1', 'transfer');
    expect((await service.me(gates.ag1)).stops).toEqual(['transfer']);
    expect((await service.me(gates.pos1)).stops).toEqual(['transfer']);
    expect((await service.me(gates.ag2)).stops).toEqual([]);
    expect((await service.me(gates.ma1)).stops).toEqual([]);
  });

  it('unions every node of the path in display order and drops keys it does not know', async () => {
    const { service, gates, accounts } = await tree();
    setStops(accounts, 'ma1', 'transfer,bogus');
    setStops(accounts, 'pos1', 'sim,charge');
    expect((await service.me(gates.pos1)).stops).toEqual(['charge', 'sim', 'transfer']);
    expect((await service.me(gates.ag1)).stops).toEqual(['transfer']);
  });

  it('answers an empty list when nothing is stopped, beside the rest of the answer', async () => {
    const { service, gates } = await tree();
    const me = await service.me(gates.ag1);
    expect(me.stops).toEqual([]);
    expect(me).toMatchObject({ loginName: 'ag1', layer: 'agent', isBranchOwner: false, impersonating: false });
  });
});

describe('writing user terms', () => {
  const row = (userId: string, patch: Record<string, unknown> = {}) => ({ id: `x-${userId}`, packageId: 'pa', userId, hidden: false, price: null, renewalPrice: null, setById: '', ...patch });

  it('the parent may not price below what it pays itself; zero margin passes', async () => {
    const { service, gates, userPackages } = await tree();
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { price: 2800 })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
    const saved = await service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { price: 3000 });
    expect(saved).toMatchObject({ code: 'alloha-150', price: 3000, effective: 3000, source: 'custom', parentBuy: 3000 });
    expect(userPackages).toHaveLength(1);
    expect(userPackages[0]).toMatchObject({ userId: 'pos1', price: 3000, setById: 'ag1' });
  });

  it('a later rise of the parent buy price does not block the hide switch on an older row', async () => {
    const { service, gates, userPackages, sellPrices } = await tree();
    userPackages.push(row('pos1', { price: 3000 }));
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ma1', price: 3200, renewalPrice: null });
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { hidden: true })).resolves.toMatchObject({ hidden: true, price: 3000, parentBuy: 3200 });
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { renewalPrice: 3300 })).resolves.toMatchObject({ renewalPrice: 3300 });
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { price: 3000 })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
  });

  it('deleting an account removes its terms and sell rows first', async () => {
    const { service, gates, userPackages, sellPrices, accounts } = await tree();
    userPackages.push({ ...row('ma2', { hidden: true }), packageId: 'pb' });
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ma2', price: 3100, renewalPrice: null });
    await expect(service.removeUser(gates.branch, 'ma2')).resolves.toEqual({ ok: true });
    expect(accounts.some((item) => item.id === 'ma2')).toBe(false);
    expect(userPackages).toHaveLength(0);
    expect(sellPrices).toHaveLength(0);
  });

  it('only the direct parent or the branch may write', async () => {
    const { service, gates } = await tree();
    await expect(service.setUserPackage(gates.ma1, 'pos1', 'alloha-150', { hidden: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setUserPackage(gates.pos1, 'pos1', 'alloha-150', { hidden: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setUserPackage(gates.branch, 'pos1', 'alloha-150', { hidden: true })).resolves.toMatchObject({ hidden: true });
  });

  it('a parent cannot unhide what an ancestor hid; the branch can clear the ancestor row', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push(row('ma1', { hidden: true }));
    await expect(service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { hidden: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setUserPackage(gates.branch, 'ma1', 'alloha-150', { hidden: false })).resolves.toMatchObject({ hidden: false });
    expect(userPackages).toHaveLength(0);
  });

  it('a row back on its defaults is deleted, not kept', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push(row('pos1', { price: 3100, renewalPrice: 3000 }));
    await service.setUserPackage(gates.ag1, 'pos1', 'alloha-150', { price: null, renewalPrice: null });
    expect(userPackages).toHaveLength(0);
  });

  it('bulk hide skips packages already hidden above and reports the summary', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push({ ...row('ma1', { hidden: true }), packageId: 'pb' });
    const out = await service.setUserPackagesBulk(gates.ag1, 'pos1', { codes: ['alloha-150', 'alloha-400'], hidden: true });
    expect(userPackages.filter((item) => item.userId === 'pos1').map((item) => item.packageId)).toEqual(['pa']);
    expect(out.summary).toEqual({ total: 2, visible: 0, custom: 0 });
  });

  it('bulk show is one transaction: a failure on the second package leaves the first untouched', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push(row('pos1', { hidden: true }));
    userPackages.push({ ...row('pos1', { hidden: true }), packageId: 'pb' });
    const table = (service as unknown as { prismaClient: { userPackage: { delete: (args: { where: { packageId_userId: { packageId: string } } }) => Promise<unknown> } } }).prismaClient.userPackage;
    const real = table.delete;
    table.delete = async (args) => {
      if (args.where.packageId_userId.packageId === 'pb') throw new Error('connection lost');
      return real(args);
    };
    await expect(service.setUserPackagesBulk(gates.ag1, 'pos1', { codes: ['alloha-150', 'alloha-400'], hidden: false })).rejects.toThrow('connection lost');
    expect(userPackages.filter((item) => item.userId === 'pos1').map((item) => [item.packageId, item.hidden])).toEqual([['pa', true], ['pb', true]]);
  });

  it('lists the user packages grouped by company with the inherited state', async () => {
    const { service, gates, userPackages, sellPrices, line, lines } = await tree();
    lines.push(at(line, 'ln2', 4500), at(line, 'ln3', 4500), at(line, 'ln4', 4500, 'disconnected'));
    userPackages.push({ ...row('ma1', { hidden: true }), packageId: 'pb' });
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3100, renewalPrice: null });
    const sheet = await service.userPackages(gates.ag1, 'pos1');
    expect(sheet.summary).toEqual({ total: 2, visible: 1, custom: 0 });
    expect(sheet.companies).toHaveLength(1);
    const [a, b] = sheet.companies[0].packages;
    expect(a).toMatchObject({ code: 'alloha-150', hidden: false, hiddenAbove: null, parentBuy: 3000, effective: 3100, renewalEffective: 3200, source: 'parent', lines: 3 });
    expect(b).toMatchObject({ code: 'alloha-400', hidden: false, hiddenAbove: 'ma1', lines: 0 });
  });

  it('custom prices list the priced users only and clearing keeps a hide', async () => {
    const { service, gates, userPackages } = await tree();
    userPackages.push(row('pos1', { price: 2900 }));
    userPackages.push(row('ag2', { hidden: true }));
    const listed = await service.customPrices(gates.branch, 'alloha-150');
    expect(listed.map((item) => item.loginName)).toEqual(['pos1']);
    expect(listed[0]).toMatchObject({ layer: 'pos', parentLogin: 'ag1', defaultPrice: 3500, defaultRenewalPrice: 3200, price: 2900, renewalPrice: null });
    await expect(service.customPrices(gates.ma1, 'alloha-150')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.setCustomPrice(gates.branch, 'alloha-150', 'ag2', { price: 2950 });
    expect(userPackages.find((item) => item.userId === 'ag2')).toMatchObject({ hidden: true, price: 2950 });
    await service.clearCustomPrice(gates.branch, 'alloha-150', 'ag2');
    expect(userPackages.find((item) => item.userId === 'ag2')).toMatchObject({ hidden: true, price: null, renewalPrice: null });
  });

  it('a sell price is owned by a main agent or agent and floored at its own buy', async () => {
    const { service, gates, sellPrices } = await tree();
    await expect(service.setSellPrice(gates.ag1, 'alloha-150', { price: 2999 })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
    await expect(service.setSellPrice(gates.pos1, 'alloha-150', { price: 4000 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setSellPrice(gates.branch, 'alloha-150', { price: 4000 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setSellPrice(gates.ag1, 'alloha-150', { price: 3000, renewalPrice: 2700 })).resolves.toEqual({ price: 3000, renewalPrice: 2700 });
    expect(sellPrices[0]).toMatchObject({ ownerId: 'ag1', price: 3000, renewalPrice: 2700 });
  });

  it('clearing a sell price returns the owner to the layer column; others may not clear it', async () => {
    const { service, gates, sellPrices } = await tree();
    await service.setSellPrice(gates.ag1, 'alloha-150', { price: 3700 });
    expect(sellPrices).toHaveLength(1);
    await expect(service.clearSellPrice(gates.pos1, 'alloha-150')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.clearSellPrice(gates.branch, 'alloha-150')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.clearSellPrice(gates.ag1, 'alloha-150')).resolves.toEqual({ ok: true });
    expect(sellPrices).toHaveLength(0);
    await expect(service.clearSellPrice(gates.ag1, 'alloha-150')).resolves.toEqual({ ok: true });
    const pos = await service.packages(gates.pos1);
    expect(pos.packages.find((item) => item.code === 'alloha-150')).toMatchObject({ price: 3500 });
  });

  it('operation stops: the parent writes, cannot lift an inherited stop, the branch can', async () => {
    const { service, gates, accounts } = await tree();
    (accounts.find((item) => item.id === 'ma1') as Row).deniedOps = 'charge';
    await expect(service.userOps(gates.ag1, 'pos1')).resolves.toEqual({ denied: [], deniedAbove: [{ op: 'charge', login: 'ma1' }] });
    await expect(service.setUserOps(gates.ag1, 'pos1', { denied: ['sim'] })).resolves.toMatchObject({ denied: ['sim'] });
    expect((accounts.find((item) => item.id === 'pos1') as Row).deniedOps).toBe('sim');
    await expect(service.setUserOps(gates.ag1, 'ma1', { denied: [] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setUserOps(gates.branch, 'ma1', { denied: [] })).resolves.toMatchObject({ denied: [] });
  });

  it('a custom renewal price written after activation does not change what the number pays', async () => {
    const { service, gates, userPackages, line, entries } = await tree();
    userPackages.push(row('pos1', { price: 3100, renewalPrice: 3100 }));
    line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await service.extend(gates.pos1, 'ln1', { outcome: 'success' });
    expect(entries[0]).toMatchObject({ kind: 'extend', amount: -3200 });
  });

  it('a renewal onto another package pays the price frozen for that target, whatever its rows say today', async () => {
    const { service, gates, pkgA, pkgB, userPackages, line, entries } = await tree();
    const target = packageTermsOf(pkgB as unknown as PackagePriceRow);
    // The number froze 3300 for alloha-400 when it was activated; a custom 2950 came later.
    line.terms = captureTerms(packageTermsOf(pkgA as unknown as PackagePriceRow), [{ ...target, renewal: { ...target.renewal, posPrice: 3300 } }]);
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'pos1', hidden: false, price: null, renewalPrice: 2950 });
    line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await service.extend(gates.pos1, 'ln1', { outcome: 'success', targetCode: 'alloha-400' });
    expect(entries[0]).toMatchObject({ kind: 'extend', amount: -3300 });
  });
});

describe('capturing the renewal price', () => {
  const activate = (iccid: string) => ({ packageCode: 'alloha-150', posLogin: 'pos1', iccid, outcome: 'success' as const });
  const termsOf = (row: Row) => row.terms as LineTerms;
  // A branch task the owner has taken, ready to be closed.
  const taken = (patch: Record<string, unknown>) => ({
    id: 't1', status: 'working', assigneeId: 'branch', submitterId: 'pos1', posId: 'pos1', packageId: 'pa', nextPackageId: null,
    lineId: null, msisdn: '0521000099', iccid: '8997202000000000009', esim: false, esimQr: null, posDelta: 0, ...patch,
  });

  it('activation stamps the custom renewal price, else the parent sell price, else the layer price', async () => {
    const custom = await tree();
    custom.userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3100 });
    await custom.service.activate(custom.gates.pos1, activate('8997202000000000002'));
    expect(termsOf(custom.lines[1]).renewal.posPrice).toBe(3100);

    const sold = await tree();
    sold.sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: 3400 });
    await sold.service.activate(sold.gates.pos1, activate('8997202000000000003'));
    expect(termsOf(sold.lines[1]).renewal.posPrice).toBe(3400);

    const plain = await tree();
    await plain.service.activate(plain.gates.pos1, activate('8997202000000000004'));
    expect(termsOf(plain.lines[1]).renewal.posPrice).toBe(3200);
  });

  it('activation stamps each renewal target from the rows of that target alone', async () => {
    const { service, gates, pkgA, pkgB, userPackages, sellPrices, lines } = await tree();
    pkgA.renewals = [{ target: pkgB }];
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: 3400 });
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'pos1', hidden: false, price: null, renewalPrice: 2950 });
    await service.activate(gates.pos1, activate('8997202000000000005'));
    const stamped = termsOf(lines[1]);
    expect(stamped.renewal.posPrice).toBe(3400);
    expect(stamped.renewalTargets).toMatchObject([{ code: 'alloha-400', renewal: { posPrice: 2950 } }]);
  });

  it('an activation closed by a branch task stamps the price the point of sale would pay now', async () => {
    const { service, gates, userPackages, lines, tasks } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3100 });
    tasks.push(taken({ action: 'activate', posDelta: -3500 }));
    await service.completeTask(gates.branch, 't1', {});
    expect(termsOf(lines[1]).renewal.posPrice).toBe(3100);
  });

  it('a switch stamps the target renewal price through the path and debits from it', async () => {
    const { service, gates, userPackages, line, lines, entries } = await tree();
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'pos1', hidden: false, price: null, renewalPrice: 3000 });
    line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await service.switchPackage(gates.pos1, 'ln1', { packageCode: 'alloha-400', outcome: 'success' });
    expect(termsOf(lines[0]).renewal.posPrice).toBe(3000);
    // The quote priced the target from the same ladder the line now carries.
    expect(entries[0]).toMatchObject({ kind: 'switch', packagePrice: 3000 });
  });

  it('a switch closed by a branch task stamps the same price', async () => {
    const { service, gates, pkgA, userPackages, line, lines, tasks, entries } = await tree();
    pkgA.switches = [{ target: { code: 'alloha-400' } }];
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'pos1', hidden: false, price: null, renewalPrice: 3000 });
    line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    tasks.push(taken({ action: 'switch', nextPackageId: 'pb', lineId: 'ln1', msisdn: '0521000001' }));
    await service.completeTask(gates.branch, 't1', {});
    expect(termsOf(lines[0]).renewal.posPrice).toBe(3000);
    expect(entries[0]).toMatchObject({ kind: 'switch', packagePrice: 3000 });
  });

  it('leaves the terms as captured when the point of sale is unknown', async () => {
    const { service, pkgA } = await tree();
    const captured = captureTerms(packageTermsOf(pkgA as unknown as PackagePriceRow), []);
    const stamp = (service as unknown as { stampFor: (terms: LineTerms, posId: string) => Promise<LineTerms> }).stampFor.bind(service);
    await expect(stamp(captured, 'ghost')).resolves.toEqual(captured);
  });
});

describe('prices on existing numbers', () => {
  it('GET line-prices groups the renewable numbers in scope and tells the current price', async () => {
    const { service, gates } = await withNumbers();
    await expect(service.linePrices(gates.ag1, 'alloha-150', { scope: 'pos1' })).resolves.toEqual({
      current: 3200,
      groups: [{ price: 3200, count: 1 }, { price: 4100, count: 1 }, { price: 4500, count: 2 }],
    });
    await expect(service.linePrices(gates.branch, 'alloha-150', { scope: 'all' })).resolves.toMatchObject({ current: null });
    await expect(service.linePrices(gates.ma1, 'alloha-150', { scope: 'all' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.linePrices(gates.ag2, 'alloha-150', { scope: 'pos1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.linePrices(gates.pos1, 'alloha-150', { scope: 'pos1' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a scope reaches the numbers of that package under it and no others', async () => {
    const { service, gates, lines, line } = await withNumbers();
    // A number at pos2, under the other agent, and a number of another package at pos1: neither is in ag1's table.
    lines.push({ ...at(line, 'ln6', 4800), posId: 'pos2' }, { ...at(line, 'ln7', 4700), packageId: 'pb' });
    const own = [{ price: 3200, count: 1 }, { price: 4100, count: 1 }, { price: 4500, count: 2 }];
    // An agent and a main agent run the table over their own subtree by naming themselves.
    await expect(service.linePrices(gates.ag1, 'alloha-150', { scope: 'ag1' })).resolves.toMatchObject({ groups: own });
    await expect(service.linePrices(gates.ma1, 'alloha-150', { scope: 'ag2' })).resolves.toMatchObject({ groups: [{ price: 4800, count: 1 }] });
    await expect(service.linePrices(gates.ma1, 'alloha-150', { scope: 'ma1' })).resolves.toMatchObject({ groups: [...own, { price: 4800, count: 1 }] });
    await expect(service.linePrices(gates.branch, 'alloha-150', { scope: 'all' })).resolves.toMatchObject({ groups: [...own, { price: 4800, count: 1 }] });
    await expect(service.linePrices(gates.branch, 'alloha-400', { scope: 'all' })).resolves.toEqual({ current: null, groups: [{ price: 4700, count: 1 }] });
  });

  it('refuses a scope that names no account, a branch account, or nothing', async () => {
    const { service, gates } = await tree();
    await expect(service.linePrices(gates.branch, 'alloha-150', { scope: 'ghost' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.linePrices(gates.branch, 'alloha-150', { scope: 'branch' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.linePrices(gates.branch, 'alloha-150', {})).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.linePrices(gates.branch, 'alloha-150', { scope: ['pos1'] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.linePrices(gates.branch, 'nope-1', { scope: 'all' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('case 1: every group to the current price', async () => {
    const { service, gates, userPackages, lines } = await withNumbers();
    // pos1 has its own renewal price, 3100; its numbers carry 4500 twice, 4100 and the layer's 3200
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3100 });
    const result = await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 'current' }, { from: 4100, to: 'current' }, { from: 3200, to: 'current' }] });
    expect(result).toEqual({ ok: true, lines: 4 });
    expect(lines.filter((l) => l.status !== 'disconnected').map((l) => (l.terms as LineTerms).renewal.posPrice)).toEqual([3100, 3100, 3100, 3100]);
    expect((lines[4].terms as LineTerms).renewal.posPrice).toBe(9900);
  });

  it('case 2: old numbers to 41 while the custom activation price stays 35', async () => {
    const { service, gates, userPackages, lines } = await withNumbers();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: 3500, renewalPrice: null });
    await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 4100 }] });
    expect(lines.filter((l) => (l.terms as LineTerms).renewal.posPrice === 4100)).toHaveLength(3);
    expect(userPackages[0]).toMatchObject({ price: 3500, renewalPrice: null });
  });

  it('case 3: two groups, two prices, one call', async () => {
    const { service, gates, lines } = await withNumbers();
    await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 3900 }, { from: 4100, to: 3700 }] });
    expect(groupLinePrices(lines.filter((l) => l.status !== 'disconnected').map((l) => ({ terms: l.terms as LineTerms })))).toEqual([{ price: 3200, count: 1 }, { price: 3700, count: 1 }, { price: 3900, count: 2 }]);
  });

  it('a price below one number floor refuses the whole save and changes nothing', async () => {
    const { service, gates, lines } = await withNumbers();
    // agent pays renewal 2700 → pos floor 2700
    await expect(service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 2600 }, { from: 4100, to: 3000 }] })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
    expect((lines[3].terms as LineTerms).renewal.posPrice).toBe(4100);
    // The refused group may come after groups that are fine: none of them is kept.
    await expect(service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 3900 }, { from: 4100, to: 2600 }] })).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
    expect(lines.map((l) => (l.terms as LineTerms).renewal.posPrice)).toEqual([3200, 4500, 4500, 4100, 9900]);
  });

  it('the nearer custom price wins when an agent runs current over its subtree', async () => {
    const { service, gates, sellPrices, userPackages, lines } = await withNumbers();
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: 3400 });
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3000 });
    await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'ag1', groups: [{ from: 4500, to: 'current' }] });
    expect((lines[1].terms as LineTerms).renewal.posPrice).toBe(3000);
  });

  it('after case 1 the next extend debits the new price', async () => {
    const { service, gates, userPackages, line, entries } = await withNumbers();
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3100 });
    await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 'current' }, { from: 4100, to: 'current' }, { from: 3200, to: 'current' }] });
    line.endsAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await service.extend(gates.pos1, 'ln1', { outcome: 'success' });
    expect(entries[0]).toMatchObject({ kind: 'extend', amount: -3100 });
  });

  it('bad bodies are INVALID', async () => {
    const { service, gates } = await tree();
    await expect(service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: 'x' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: -1 }] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.setLinePrices(gates.ag1, 'alloha-150', { groups: [] })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('a save reaches the numbers of that package under the scope and prices each through its own point of sale', async () => {
    const { service, gates, accounts, sellPrices, userPackages, lines, line } = await withNumbers();
    accounts.push(account('pos3', 'pos', 'ag1'));
    sellPrices.push({ id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: 3400 });
    userPackages.push({ id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3000 });
    // pos3 is under ag1 with no row of its own; pos2 is under ag2, outside the scope; ln8 is on another package.
    lines.push({ ...at(line, 'ln6', 4500), posId: 'pos3' }, { ...at(line, 'ln7', 4500), posId: 'pos2' }, { ...at(line, 'ln8', 4500), packageId: 'pb' });
    await expect(service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'ag1', groups: [{ from: 4500, to: 'current' }] })).resolves.toEqual({ ok: true, lines: 3 });
    expect(lines.map((l) => (l.terms as LineTerms).renewal.posPrice)).toEqual([3200, 3000, 3000, 4100, 9900, 3400, 4500, 4500]);
  });

  it('current takes the renewal targets the package lists today; a flat price leaves the targets alone', async () => {
    const { service, gates, pkgA, pkgB, userPackages, lines, line } = await withNumbers();
    // ln2 and ln4 were captured with a target the package no longer lists; it now lists alloha-400, which pos1 has its own price for.
    const stale = { code: 'alloha-300', months: 1, renewal: { ...(line.terms as LineTerms).renewal, posPrice: 5000 } };
    for (const row of [lines[1], lines[3]]) row.terms = { ...(row.terms as LineTerms), renewalTargets: [stale] };
    pkgA.renewals = [{ target: pkgB }];
    userPackages.push({ id: 'r1', packageId: 'pb', userId: 'pos1', hidden: false, price: null, renewalPrice: 2950 });
    await service.setLinePrices(gates.ag1, 'alloha-150', { scope: 'pos1', groups: [{ from: 4500, to: 'current' }, { from: 4100, to: 3900 }] });
    expect(lines[1].terms).toMatchObject({ packageCode: 'alloha-150', renewal: { posPrice: 3200 }, renewalTargets: [{ code: 'alloha-400', renewal: { posPrice: 2950 } }] });
    expect(lines[3].terms).toMatchObject({ renewal: { posPrice: 3900 }, renewalTargets: [stale] });
  });

  it('a save goes through the same doors as the table', async () => {
    const { service, gates } = await withNumbers();
    const save = (gate: { sessionId: string }, scope: string, from: number, code = 'alloha-150') =>
      service.setLinePrices(gate, code, { scope, groups: [{ from, to: 3900 }] });
    await expect(save(gates.ma1, 'all', 4500)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(save(gates.ag2, 'pos1', 4500)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The main agent is not the parent of pos1; it reaches those numbers through ag1.
    await expect(save(gates.ma1, 'pos1', 4500)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(save(gates.pos1, 'pos1', 4500)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(save(gates.branch, 'ghost', 4500)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(save(gates.branch, 'all', 4500, 'nope-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(save(gates.ma1, 'ag1', 4500)).resolves.toEqual({ ok: true, lines: 2 });
    await expect(save(gates.branch, 'all', 4100)).resolves.toEqual({ ok: true, lines: 1 });
  });

  it('a save reads the price rows once for every number, to current or to a flat price, across points of sale and packages', async () => {
    const { service, gates, accounts, pkgA, pkgB, sellPrices, userPackages, lines, line } = await withNumbers();
    accounts.push(account('pos3', 'pos', 'ag1'));
    // Every ladder spans two packages: the one repriced and the renewal target it lists today.
    pkgA.renewals = [{ target: pkgB }];
    // pos1 has rows of its own on both packages; pos3 pays through ag1's sell price on A; pos2 through ag2's on both.
    // Above them, ma1 sells A to its agents at 2900 and ag2 has its own price for A, 3050: those two set the floors.
    userPackages.push(
      { id: 'r1', packageId: 'pa', userId: 'pos1', hidden: false, price: null, renewalPrice: 3000 },
      { id: 'r2', packageId: 'pb', userId: 'pos1', hidden: false, price: null, renewalPrice: 2950 },
      { id: 'r3', packageId: 'pa', userId: 'ag2', hidden: false, price: null, renewalPrice: 3050 },
    );
    sellPrices.push(
      { id: 's1', packageId: 'pa', ownerId: 'ag1', price: 3700, renewalPrice: 3400 },
      { id: 's2', packageId: 'pa', ownerId: 'ag2', price: 3700, renewalPrice: 3100 },
      { id: 's3', packageId: 'pb', ownerId: 'ag2', price: 3900, renewalPrice: 3300 },
      { id: 's4', packageId: 'pa', ownerId: 'ma1', price: 3300, renewalPrice: 2900 },
    );
    lines.push(
      { ...at(line, 'ln6', 4500), posId: 'pos3' },
      { ...at(line, 'ln7', 4100), posId: 'pos3' },
      { ...at(line, 'ln8', 4500), posId: 'pos2' },
      { ...at(line, 'ln9', 4100), posId: 'pos2' },
      // A point of sale that has left the tree keeps the ladder as captured.
      { ...at(line, 'ln10', 4500), posId: 'ghost' },
    );
    // The transaction hands out the same table objects as the client, so counting on them counts the save's reads.
    const client = (service as unknown as { prismaClient: Record<string, { findMany: (args?: unknown) => Promise<unknown> }> }).prismaClient;
    const tables = ['package', 'packageRenewal', 'userPackage', 'sellPrice'];
    const reads: Record<string, number> = {};
    const reset = () => {
      for (const table of tables) reads[table] = 0;
    };
    reset();
    for (const table of tables) {
      const findMany = client[table].findMany.bind(client[table]);
      client[table].findMany = async (args) => {
        reads[table] += 1;
        return findMany(args);
      };
    }
    const prices = () => lines.map((l) => (l.terms as LineTerms).renewal.posPrice);
    const save = (groups: { from: number; to: number | 'current' }[]) => service.setLinePrices(gates.branch, 'alloha-150', { scope: 'all', groups });

    await expect(save([{ from: 4500, to: 'current' }, { from: 4100, to: 'current' }])).resolves.toEqual({ ok: true, lines: 8 });
    // One read of each table for the whole save, not one per point of sale.
    expect(reads).toEqual({ package: 1, packageRenewal: 1, userPackage: 1, sellPrice: 1 });
    // Each number carries the ladder of its own path: pos1 3000 and 2950, pos3 3400 and the layer's 3200, pos2 3100 and 3300.
    const current = [3200, 3000, 3000, 3000, 9900, 3400, 3400, 3100, 3100, 3200];
    expect(prices()).toEqual(current);
    expect(lines.map((l) => (l.terms as LineTerms).renewalTargets.map((target) => target.renewal.posPrice))).toEqual([[], [2950], [2950], [2950], [], [3200], [3200], [3300], [3300], [3200]]);

    // A flat price is held to the floor of each number's own point of sale, from the same single read:
    // 2900 for pos1 and pos3 (ma1's sell price), 3050 for pos2 (ag2's own price), cost for the point of sale that left the tree.
    reset();
    await expect(save([{ from: 3100, to: 3000 }])).rejects.toMatchObject({ code: 'PRICE_BELOW_FLOOR' });
    expect(reads).toEqual({ package: 1, packageRenewal: 0, userPackage: 1, sellPrice: 1 });
    expect(prices()).toEqual(current);
    reset();
    await expect(save([{ from: 3200, to: 2900 }, { from: 3100, to: 3050 }])).resolves.toEqual({ ok: true, lines: 4 });
    expect(reads).toEqual({ package: 1, packageRenewal: 0, userPackage: 1, sellPrice: 1 });
    expect(prices()).toEqual([2900, 3000, 3000, 3000, 9900, 3400, 3400, 3050, 3050, 2900]);
  });
});
