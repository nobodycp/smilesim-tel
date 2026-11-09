import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActivityRecorder } from './activity-recorder';
import { NOTICE_GROUPS, hrefFor, type NoticeDraft } from './notice-kinds';
import type { NoticeService, WrittenNotice } from './notice.service';
import { OfficeKernel } from './kernel/office-kernel';
import { OFFICE_CONTROLLERS, OFFICE_PROVIDERS } from './office.module';
import { OfficeFacade } from './testing/office-facade';
import type { LineTerms } from './office-rules';
import { account, tree, type Row } from './tree-fixture';

// Moving an account or a number, and what the office is told before it does.
// The tree is the one in tree-fixture.ts: branch → ma1 → ag1 → pos1 and ma1 → ag2 → pos2, plus ma2 with nothing under it.
// The fixture's accounts hold no grants but the branch owner's, so each case gives its actor the grant it is about.

/** The stored row with this id: an account, a wallet (`w-<login>`), a terms row, a number. */
const rowOf = (rows: { id: string }[], id: string) => rows.find((item) => item.id === id) as Row;
/** Sets fields on the stored row with this id. */
const edit = (rows: { id: string }[], id: string, patch: Record<string, unknown>) => Object.assign(rowOf(rows, id), patch);
const refused = (status: number, code: string) => expect.objectContaining({ status, code });
const terms = (userId: string, packageId: string, patch: Record<string, unknown> = {}): Row => ({
  id: `${userId}:${packageId}`, packageId, userId, hidden: false, price: null, renewalPrice: null, setById: '', ...patch,
});
const sell = (ownerId: string, packageId: string, price: number, renewalPrice: number | null = null): Row => ({
  id: `${ownerId}:${packageId}`, packageId, ownerId, price, renewalPrice,
});
/** A number beside the tree's first line, on another point of sale or in another state. */
const number = (line: Row, id: string, patch: Record<string, unknown>): Row => ({ ...line, id, msisdn: `0521000${id}`, ...patch });

/**
 * ag1 with two points of sale, pos1 and pos3, and terms on all three accounts. Beside them ag2 and its pos2
 * have a wallet, rows, sell prices, and a number of their own, and none of that may travel with ag1.
 */
async function busyAgent() {
  const fixture = await tree();
  const { accounts, wallets, userPackages, sellPrices, lines, line } = fixture;
  accounts.push(account('pos3', 'pos', 'ag1'));
  wallets.push({ id: 'w-pos3', userId: 'pos3', balance: 25000, ceiling: 0 });
  edit(wallets, 'w-ag1', { balance: 40000 });
  edit(wallets, 'w-pos2', { balance: 7000 });
  edit(accounts, 'ag1', { deniedOps: 'charge' });
  edit(accounts, 'pos1', { deniedOps: 'sim,esim' });
  edit(accounts, 'pos3', { deniedOps: 'transfer' });
  userPackages.push(
    // The agent's own: 2400 is under 2500, the main agent column ma2 would pay; the other is a hidden package with a fair renewal price.
    terms('ag1', 'pa', { price: 2400 }),
    terms('ag1', 'pb', { hidden: true, renewalPrice: 2600 }),
    terms('pos1', 'pa', { price: 3300 }),
    terms('pos1', 'pb', { hidden: true }),
    terms('pos3', 'pa', { hidden: true, renewalPrice: 3000 }),
    terms('pos2', 'pa', { price: 3100 }),
  );
  sellPrices.push(sell('ag1', 'pa', 3700), sell('ag1', 'pb', 3900), sell('ag2', 'pa', 3600));
  lines.push(
    number(line, 'ln2', { posId: 'pos3', status: 'frozen' }),
    number(line, 'ln3', { posId: 'pos1', status: 'disconnected' }),
    number(line, 'ln4', { posId: 'pos2' }),
  );
  return fixture;
}

// What `busyAgent` carries to ma2: pos1 and pos3 hold 125000 together, and ag1 holds 40000 itself.
const BUSY_PREVIEW = {
  balance: 40000,
  subtreeBalance: 125000,
  own: { customPrices: 2, hidden: 1, stops: 1, belowNewFloor: 1 },
  child: { customPrices: 2, hidden: 2, stops: 3, sellPrices: 2 },
  lines: 2,
};

describe('transfer preview: what a move would carry', () => {
  it('shows the branch what ag1 takes to ma2: both balances, both sets of terms, the floor, and the numbers that can renew', async () => {
    const { service, gates } = await busyAgent();
    await expect(service.transferPreview(gates.branch, 'ag1', { parentLogin: 'ma2' })).resolves.toEqual(BUSY_PREVIEW);
  });

  it('counts the numbers that can still renew, active and frozen, and no others', async () => {
    const { service, gates, lines } = await busyAgent();
    for (const row of lines) if (row.status === 'frozen') row.status = 'disconnected';
    await expect(service.transferPreview(gates.branch, 'ag1', { parentLogin: 'ma2' })).resolves.toMatchObject({ lines: 1 });
    for (const row of lines) row.status = 'frozen';
    // pos2 belongs to ag2 and stays out: four numbers in all, three under ag1.
    await expect(service.transferPreview(gates.branch, 'ag1', { parentLogin: 'ma2' })).resolves.toMatchObject({ lines: 3 });
  });

  it('shows a point of sale its own wallet and terms, nothing below it, and what the new agent would pay', async () => {
    const { service, gates, accounts, userPackages, lines, line } = await tree();
    edit(accounts, 'pos1', { deniedOps: 'sim' });
    userPackages.push(
      // ag2 pays 3200 for alloha-150, so 3100 is under it; alloha-400 costs ag2 the agent column, 3000.
      terms('pos1', 'pa', { price: 3100 }),
      terms('pos1', 'pb', { price: 3100 }),
      terms('ag2', 'pa', { price: 3200 }),
      // What the old agent charges decides nothing.
      terms('ag1', 'pb', { price: 5000 }),
    );
    lines.push(number(line, 'ln2', { status: 'frozen' }), number(line, 'ln3', { status: 'disconnected' }));
    await expect(service.transferPreview(gates.branch, 'pos1', { parentLogin: 'ag2' })).resolves.toEqual({
      balance: 100000,
      subtreeBalance: 0,
      own: { customPrices: 2, hidden: 0, stops: 1, belowNewFloor: 1 },
      child: null,
      lines: 2,
    });
  });

  it('reads the floor from the rows of the new chain: the new agent price, else the sell price of the main agent above it', async () => {
    const { service, gates, userPackages, sellPrices } = await tree();
    userPackages.push(terms('pos1', 'pa', { price: 3100 }), terms('pos1', 'pb', { price: 3100 }));
    const below = async () => (await service.transferPreview(gates.branch, 'pos1', { parentLogin: 'ag2' })).own.belowNewFloor;
    // Both packages cost an agent 3000, the layer column, so 3100 is above it.
    await expect(below()).resolves.toBe(0);
    sellPrices.push(sell('ma1', 'pa', 3300));
    await expect(below()).resolves.toBe(1);
    userPackages.push(terms('ag2', 'pb', { price: 3150 }));
    await expect(below()).resolves.toBe(2);
    // ag2's own price for alloha-150 beats the sell price above it.
    userPackages.push(terms('ag2', 'pa', { price: 3000 }));
    await expect(below()).resolves.toBe(1);
  });

  it('holds an agent to the main agent column of ma2, and to a price ma2 has of its own', async () => {
    const { service, gates, userPackages } = await busyAgent();
    const below = async () => (await service.transferPreview(gates.branch, 'ag1', { parentLogin: 'ma2' })).own.belowNewFloor;
    await expect(below()).resolves.toBe(1);
    // ma2 pays less than the column for alloha-150, so 2400 is no longer under it.
    userPackages.push(terms('ma2', 'pa', { price: 2300 }));
    await expect(below()).resolves.toBe(0);
  });

  it('gives an agent with no points of sale a child section that counts only its sell prices, and no balance below it', async () => {
    const { service, gates, accounts, wallets, sellPrices } = await tree();
    accounts.push(account('ag3', 'agent', 'ma1'));
    wallets.push({ id: 'w-ag3', userId: 'ag3', balance: 900, ceiling: 0 });
    await expect(service.transferPreview(gates.branch, 'ag3', { parentLogin: 'ma2' })).resolves.toEqual({
      balance: 900,
      subtreeBalance: 0,
      own: { customPrices: 0, hidden: 0, stops: 0, belowNewFloor: 0 },
      child: { customPrices: 0, hidden: 0, stops: 0, sellPrices: 0 },
      lines: 0,
    });
    // A reset of what is below it deletes these, so the preview has to show them though no point of sale is there.
    sellPrices.push(sell('ag3', 'pa', 3700), sell('ag3', 'pb', 3800), sell('ag2', 'pa', 3600));
    await expect(service.transferPreview(gates.branch, 'ag3', { parentLogin: 'ma2' })).resolves.toMatchObject({
      child: { customPrices: 0, hidden: 0, stops: 0, sellPrices: 2 },
    });
  });

  it('writes nothing, and reads each table once however many points of sale it counts', async () => {
    const { service, gates, accounts, userPackages, sellPrices, wallets, lines } = await busyAgent();
    const client = (service as unknown as { prismaClient: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> }).prismaClient;
    const reads: Record<string, number> = {};
    for (const table of ['userPackage', 'sellPrice', 'package', 'wallet', 'line']) {
      reads[table] = 0;
      for (const method of ['findMany', 'findUnique', 'count']) {
        const original = client[table][method];
        if (!original) continue;
        client[table][method] = (...args) => {
          reads[table] += 1;
          return original.apply(client[table], args);
        };
      }
    }
    const stored = () => JSON.stringify({ accounts, userPackages, sellPrices, wallets, lines });
    const before = stored();
    await service.transferPreview(gates.branch, 'ag1', { parentLogin: 'ma2' });
    expect(reads).toEqual({ userPackage: 1, sellPrice: 1, package: 1, wallet: 1, line: 1 });
    expect(stored()).toBe(before);
  });
});

describe('transfer preview: the refusals are the move\'s', () => {
  it('a main agent is refused a destination it cannot see, though it holds the grant for the kind', async () => {
    const { service, gates, accounts } = await tree();
    edit(accounts, 'ma1', { liveGrants: 'transferAgents,transferPos' });
    // ma2 is another chain.
    await expect(service.transferPreview(gates.ma1, 'ag1', { parentLogin: 'ma2' })).rejects.toEqual(refused(403, 'FORBIDDEN'));
    // Inside its own chain the same actor gets the answer.
    await expect(service.transferPreview(gates.ma1, 'pos1', { parentLogin: 'ag2' })).resolves.toMatchObject({ child: null });
  });

  it('an agent without transferPos is refused, and with it still cannot move a point of sale to another agent', async () => {
    const { service, gates, accounts } = await tree();
    await expect(service.transferPreview(gates.ag1, 'pos1', { parentLogin: 'ag2' })).rejects.toEqual(refused(403, 'FORBIDDEN'));
    edit(accounts, 'ag1', { liveGrants: 'transferPos' });
    await expect(service.transferPreview(gates.ag1, 'pos1', { parentLogin: 'ag2' })).rejects.toEqual(refused(403, 'FORBIDDEN'));
  });

  it('answers a grant for another kind with a refusal', async () => {
    const { service, gates, accounts } = await tree();
    edit(accounts, 'ma1', { liveGrants: 'transferLines,transferPos' });
    await expect(service.transferPreview(gates.ma1, 'ag1', { parentLogin: 'ma2' })).rejects.toEqual(refused(403, 'FORBIDDEN'));
  });

  it('refuses a point of sale named with the agent it already sits under', async () => {
    const { service, gates } = await tree();
    await expect(service.transferPreview(gates.branch, 'pos1', { parentLogin: 'ag1' })).rejects.toEqual(refused(400, 'INVALID'));
  });

  it('refuses a destination of the wrong layer, a frozen one, and one that is not named', async () => {
    const { service, gates, accounts } = await tree();
    const preview = (login: string, parentLogin: unknown) => service.transferPreview(gates.branch, login, { parentLogin });
    await expect(preview('pos1', 'ma1')).rejects.toEqual(refused(400, 'INVALID'));
    await expect(preview('ag1', 'ag2')).rejects.toEqual(refused(400, 'INVALID'));
    await expect(preview('pos1', 'pos2')).rejects.toEqual(refused(400, 'INVALID'));
    for (const parentLogin of [undefined, '', 'ghost', ['ag2'], 7, null]) {
      await expect(preview('pos1', parentLogin)).rejects.toEqual(refused(400, 'INVALID'));
    }
    await expect(preview('pos1', 'ag2')).resolves.toMatchObject({ child: null });
    edit(accounts, 'ag2', { disabledAt: new Date('2026-11-01T00:00:00.000Z') });
    await expect(preview('pos1', 'ag2')).rejects.toEqual(refused(400, 'INVALID'));
  });

  it('refuses an account that cannot be moved: a main agent, the branch, and a login nobody has', async () => {
    const { service, gates } = await tree();
    for (const login of ['ma1', 'branch', 'ghost']) {
      await expect(service.transferPreview(gates.branch, login, { parentLogin: 'ma2' })).rejects.toEqual(refused(400, 'INVALID'));
    }
  });

  it('refuses where a transfer stop sits on the actor path, and nowhere else', async () => {
    const { service, gates, accounts } = await tree();
    edit(accounts, 'ma1', { liveGrants: 'transferPos' });
    const preview = (gate: { sessionId: string }) => service.transferPreview(gate, 'pos1', { parentLogin: 'ag2' });
    // The moved point of sale and its old agent sit below ma1: their stops are not on its path.
    edit(accounts, 'pos1', { deniedOps: 'transfer' });
    edit(accounts, 'ag1', { deniedOps: 'transfer' });
    await expect(preview(gates.ma1)).resolves.toMatchObject({ own: { stops: 1 } });
    edit(accounts, 'ma1', { deniedOps: 'transfer' });
    await expect(preview(gates.ma1)).rejects.toEqual(refused(403, 'FORBIDDEN'));
    // The branch sits above the stop.
    await expect(preview(gates.branch)).resolves.toMatchObject({ own: { stops: 1 } });
  });

  it('tells someone with no say over moves nothing about what exists: every name is a refusal', async () => {
    const { service, gates, accounts } = await tree();
    const preview = (login: string, parentLogin: string) => service.transferPreview(gates.ag1, login, { parentLogin });
    for (const login of ['ghost', 'ma1', 'branch', 'ag1', 'pos1', 'pos2']) {
      await expect(preview(login, 'ag2')).rejects.toEqual(refused(403, 'FORBIDDEN'));
    }
    // A grant for numbers is no say over accounts.
    edit(accounts, 'ag1', { liveGrants: 'transferLines' });
    await expect(preview('ghost', 'ag2')).rejects.toEqual(refused(403, 'FORBIDDEN'));
    // Whoever may move a point of sale or an agent is told that the name is wrong.
    edit(accounts, 'ag1', { liveGrants: 'transferPos' });
    await expect(preview('ghost', 'ag2')).rejects.toEqual(refused(400, 'INVALID'));
    await expect(preview('ma1', 'ma2')).rejects.toEqual(refused(400, 'INVALID'));
  });

  it('refuses an impersonating session, even when it is the branch owner entered', async () => {
    const { service, auth } = await tree();
    const sessionId = await auth.saveImpersonation({ userId: 'branch', operatorId: 'branch', userAgent: '', ip: '' });
    for (const login of ['ag1', 'pos1', 'ma1', 'ghost']) {
      await expect(service.transferPreview({ sessionId }, login, { parentLogin: 'ma2' })).rejects.toEqual(refused(403, 'FORBIDDEN'));
    }
  });

  it('asks for a session', async () => {
    const { service } = await tree();
    await expect(service.transferPreview({}, 'ag1', { parentLogin: 'ma2' })).rejects.toEqual(refused(401, 'LOGIN_REQUIRED'));
  });
});

// What a move is asked to do. Both bodies are complete and reset nothing; a case overrides what it is about.
const posMove = (patch: Record<string, unknown> = {}) => ({ parentLogin: 'ag2', ownPrices: 'keep', ownStops: 'keep', linePrices: 'keep', ...patch });
const agentMove = (patch: Record<string, unknown> = {}) => ({
  parentLogin: 'ma2', ownPrices: 'keep', ownStops: 'keep', childPrices: 'keep', childStops: 'keep', linePrices: 'keep', ...patch,
});
const everyReset = { ownPrices: 'reset', ownStops: 'reset', childPrices: 'reset', childStops: 'reset' };
// A number moves by its own route. Its body names the point of sale and what the number's renewal price does; there is no default.
const lineMove = (patch: Record<string, unknown> = {}) => ({ posLogin: 'pos2', linePrices: 'keep', ...patch });
/** The renewal price a number carries. */
const renewalOf = (item: Row) => (item.terms as LineTerms).renewal.posPrice;
/** Makes a number carry this renewal price. */
const carries = (item: Row, posPrice: number) => {
  const held = item.terms as LineTerms;
  item.terms = { ...held, renewal: { ...held.renewal, posPrice } };
};
/** The tree where ag1 sells its points of sale renewals at 3300 and ag2 at 3400; the layer column, and what ln1 carries, is 3200. */
async function sellers() {
  const fixture = await tree();
  fixture.sellPrices.push(sell('ag1', 'pa', 3700, 3300), sell('ag2', 'pa', 3700, 3400));
  return fixture;
}
/**
 * Makes the notice writer list what it is asked to write, and the live channel list what it is asked to
 * publish. The writer still writes, so the rows reach the fixture's `notices` as they reach the table.
 */
function listen(notice: NoticeService) {
  const written: { userIds: string[]; actorId: string; draft: NoticeDraft }[] = [];
  const published: WrittenNotice[][] = [];
  const write = notice.write.bind(notice);
  notice.write = async (tx, userIds, actor, draft) => {
    written.push({ userIds, actorId: actor.id, draft });
    return write(tx, userIds, actor, draft);
  };
  notice.publish = async (rows) => {
    published.push(rows);
  };
  return { written, published };
}

describe('transfer: a point of sale', () => {
  /** pos1 with a stop and two rows of its own, a row each on its old and its new agent, and a number on pos2. */
  async function withTerms() {
    const fixture = await tree();
    edit(fixture.accounts, 'pos1', { deniedOps: 'sim' });
    fixture.userPackages.push(
      terms('pos1', 'pa', { price: 3100 }),
      terms('pos1', 'pb', { hidden: true }),
      // What its old and its new agent wrote for themselves is not the point of sale's to take or to leave.
      terms('ag1', 'pa', { price: 2800 }),
      terms('ag2', 'pb', { price: 3300 }),
    );
    fixture.lines.push(number(fixture.line, 'ln2', { posId: 'pos2' }));
    return fixture;
  }
  /** What pos1 is offered once it sits under ag2, with the price it would pay. */
  const offered = async ({ service, gates }: Awaited<ReturnType<typeof withTerms>>) =>
    Object.fromEntries((await service.packages(gates.pos1)).packages.map((item) => [item.code, item.price]));

  it('moves a point of sale with its balance and keeps or resets its own terms as asked', async () => {
    const reset = await withTerms();
    await expect(reset.service.transferAccount(reset.gates.branch, 'pos1', posMove({ ownPrices: 'reset' }))).resolves.toEqual({ ok: true, lines: 0 });
    expect(rowOf(reset.accounts, 'pos1')).toMatchObject({ parentId: 'ag2', deniedOps: 'sim' });
    expect(rowOf(reset.wallets, 'w-pos1').balance).toBe(100000);
    // Its own rows are gone and it prices through the new agent; the rows its two agents wrote for themselves stay.
    expect(reset.userPackages.map((item) => item.id).sort()).toEqual(['ag1:pa', 'ag2:pb']);
    await expect(offered(reset)).resolves.toEqual({ 'alloha-150': 3500, 'alloha-400': 3500 });
    // Its number is stamped with the agent it was sold under; the number on pos2 is nobody's to stamp.
    expect(rowOf(reset.lines, 'ln1').originAgentId).toBe('ag1');
    expect(rowOf(reset.lines, 'ln2').originAgentId).toBeNull();

    const keep = await withTerms();
    await expect(keep.service.transferAccount(keep.gates.branch, 'pos1', posMove({ ownStops: 'reset' }))).resolves.toEqual({ ok: true, lines: 0 });
    expect(rowOf(keep.accounts, 'pos1')).toMatchObject({ parentId: 'ag2', deniedOps: '' });
    expect(rowOf(keep.wallets, 'w-pos1').balance).toBe(100000);
    expect(keep.userPackages.map((item) => item.id).sort()).toEqual(['ag1:pa', 'ag2:pb', 'pos1:pa', 'pos1:pb']);
    // It keeps its own price and the package it hid.
    await expect(offered(keep)).resolves.toEqual({ 'alloha-150': 3100 });
  });

  it('keeps the stamp of the agent a number was first sold under when its point of sale moves again', async () => {
    const { service, gates, accounts, lines } = await tree();
    accounts.push(account('ag3', 'agent', 'ma1'));
    await service.transferAccount(gates.branch, 'pos1', posMove());
    await service.transferAccount(gates.branch, 'pos1', posMove({ parentLogin: 'ag3' }));
    expect(rowOf(accounts, 'pos1').parentId).toBe('ag3');
    expect(rowOf(lines, 'ln1').originAgentId).toBe('ag1');
  });

  it('no zero-wallet rule remains', async () => {
    const { service, gates, wallet } = await tree();
    wallet.balance = 5000;
    await expect(service.transferAccount(gates.branch, 'pos1', posMove())).resolves.toEqual({ ok: true, lines: 0 });
    expect(wallet.balance).toBe(5000);
  });
});

describe('transfer: an agent', () => {
  const moved = async (patch: Record<string, unknown>) => {
    const fixture = await busyAgent();
    await expect(fixture.service.transferAccount(fixture.gates.branch, 'ag1', agentMove(patch))).resolves.toMatchObject({ ok: true });
    return fixture;
  };
  /** What is left of the terms ag1 carries: its rows, the rows of its two points of sale, its sell prices, and the three stops. */
  const left = ({ accounts, userPackages, sellPrices }: Awaited<ReturnType<typeof busyAgent>>) => ({
    own: userPackages.filter((item) => item.userId === 'ag1').length,
    below: userPackages.filter((item) => item.userId === 'pos1' || item.userId === 'pos3').length,
    sells: sellPrices.filter((item) => item.ownerId === 'ag1').length,
    stops: ['ag1', 'pos1', 'pos3'].map((id) => rowOf(accounts, id).deniedOps),
  });
  const kept = { own: 2, below: 3, sells: 2, stops: ['charge', 'sim,esim', 'transfer'] };

  it('moves an agent: child rows, its sell prices, and stops follow the four choices', async () => {
    // Nothing reset: every row, sell price, and stop travels with ag1.
    await expect(moved({}).then(left)).resolves.toEqual(kept);
    // Each choice resets what it names and nothing else; its sell prices go only with the child prices.
    await expect(moved({ ownPrices: 'reset' }).then(left)).resolves.toEqual({ ...kept, own: 0 });
    await expect(moved({ ownStops: 'reset' }).then(left)).resolves.toEqual({ ...kept, stops: ['', 'sim,esim', 'transfer'] });
    await expect(moved({ childPrices: 'reset' }).then(left)).resolves.toEqual({ ...kept, below: 0, sells: 0 });
    await expect(moved({ childStops: 'reset' }).then(left)).resolves.toEqual({ ...kept, stops: ['charge', '', ''] });
    await expect(moved(everyReset).then(left)).resolves.toEqual({ own: 0, below: 0, sells: 0, stops: ['', '', ''] });
  });

  it('moves the agent and nothing else: its points of sale stay under it, every wallet and number stays, the other agent is untouched', async () => {
    const { service, gates, accounts, wallets, userPackages, sellPrices, lines } = await busyAgent();
    const balances = () => Object.fromEntries(wallets.map((item) => [item.userId, item.balance]));
    const before = { balances: balances(), numbers: JSON.stringify(lines) };
    expect(before.balances).toMatchObject({ ag1: 40000, pos1: 100000, pos3: 25000, pos2: 7000 });
    await service.transferAccount(gates.branch, 'ag1', agentMove(everyReset));
    expect(Object.fromEntries(accounts.map((item) => [item.id, item.parentId]))).toEqual({
      branch: null, ma1: 'branch', ma2: 'branch', ag1: 'ma2', ag2: 'ma1', pos1: 'ag1', pos2: 'ag2', pos3: 'ag1',
    });
    // Wallets travel with their accounts, and no number changes point of sale, is stamped, or is repriced.
    expect(balances()).toEqual(before.balances);
    expect(JSON.stringify(lines)).toBe(before.numbers);
    // What belongs to the other agent survives every reset.
    expect(userPackages.map((item) => item.id)).toEqual(['pos2:pa']);
    expect(sellPrices.map((item) => item.id)).toEqual(['ag2:pa']);
    expect(rowOf(accounts, 'pos2').deniedOps).toBe('');
  });

  it('recaptures the renewable numbers under it after the resets, and no other number', async () => {
    const run = async (patch: Record<string, unknown>) => {
      const fixture = await busyAgent();
      for (const item of fixture.lines) carries(item, 4500);
      edit(fixture.sellPrices, 'ag1:pa', { renewalPrice: 3600 });
      const told = await fixture.service.transferPreview(fixture.gates.branch, 'ag1', { parentLogin: 'ma2' });
      const result = await fixture.service.transferAccount(fixture.gates.branch, 'ag1', agentMove({ linePrices: 'recapture', ...patch }));
      // The preview counted exactly what the move repriced.
      expect(result.lines).toBe(told.lines);
      return { result, prices: fixture.lines.map(renewalOf) };
    };
    // ln1 (pos1, active) and ln2 (pos3, frozen) renew; ln3 (disconnected) and ln4 (under ag2) do not.
    // pos1 pays through the sell price of ag1, 3600; pos3 has a renewal price of its own, 3000.
    await expect(run({})).resolves.toEqual({ result: { ok: true, lines: 2 }, prices: [3600, 3000, 4500, 4500] });
    // Once the rows of its points of sale and the sell prices of ag1 are reset, they pay the layer column.
    await expect(run({ childPrices: 'reset' })).resolves.toEqual({ result: { ok: true, lines: 2 }, prices: [3200, 3200, 4500, 4500] });
  });
});

describe('transfer: the prices of the moved numbers', () => {
  it('recapture prices moved numbers under the new parent', async () => {
    const recaptured = await sellers();
    const before = structuredClone(recaptured.line.terms) as LineTerms;
    expect(before.renewal.posPrice).toBe(3200);
    await expect(recaptured.service.transferAccount(recaptured.gates.branch, 'pos1', posMove({ linePrices: 'recapture' }))).resolves.toEqual({ ok: true, lines: 1 });
    // Under ag2, not under ag1 and not the layer column; what the number was captured with stays.
    expect(renewalOf(recaptured.line)).toBe(3400);
    expect(recaptured.line.terms).toMatchObject({
      packageCode: before.packageCode, months: before.months, windowMonths: before.windowMonths, subscription: before.subscription,
    });

    const kept = await sellers();
    const unchanged = structuredClone(kept.line.terms);
    await expect(kept.service.transferAccount(kept.gates.branch, 'pos1', posMove({ linePrices: 'keep' }))).resolves.toEqual({ ok: true, lines: 0 });
    expect(kept.line.terms).toEqual(unchanged);
    expect(renewalOf(kept.line)).toBe(3200);
  });

  it('recapture runs after the resets, so a price that was reset no longer wins', async () => {
    const run = async (ownPrices: string) => {
      const { service, gates, userPackages, line } = await sellers();
      userPackages.push(terms('pos1', 'pa', { renewalPrice: 3100 }));
      await service.transferAccount(gates.branch, 'pos1', posMove({ ownPrices, linePrices: 'recapture' }));
      return renewalOf(line);
    };
    // Kept, the point of sale's own price is the nearest one; reset, the sell price of the new agent is.
    await expect(run('keep')).resolves.toBe(3100);
    await expect(run('reset')).resolves.toBe(3400);
  });

  it('recaptures only the renewable numbers of the moved point of sale', async () => {
    const { service, gates, lines, line } = await sellers();
    lines.push(
      number(line, 'ln2', { status: 'frozen' }),
      number(line, 'ln3', { status: 'disconnected' }),
      number(line, 'ln4', { posId: 'pos2' }),
    );
    await expect(service.transferAccount(gates.branch, 'pos1', posMove({ linePrices: 'recapture' }))).resolves.toEqual({ ok: true, lines: 2 });
    expect(lines.map(renewalOf)).toEqual([3400, 3400, 3200, 3200]);
  });
});

describe('transfer: notices and the one transaction', () => {
  it('writes transfer.out to the old parent and transfer.in to the new one', async () => {
    const pos = await tree();
    const heardPos = listen(pos.notice);
    await pos.service.transferAccount(pos.gates.branch, 'pos1', posMove());
    expect(heardPos.written).toEqual([
      { userIds: ['ag1'], actorId: 'branch', draft: { kind: 'transfer.out', payload: { kind: 'pos', subject: 'pos1', toLogin: 'ag2', actorName: 'branch' } } },
      { userIds: ['ag2'], actorId: 'branch', draft: { kind: 'transfer.in', payload: { kind: 'pos', subject: 'pos1', fromLogin: 'ag1', actorName: 'branch' } } },
    ]);
    // Both are published together, after the move has committed.
    expect(heardPos.published.map((rows) => rows.map((row) => [row.userId, row.kind]))).toEqual([[['ag1', 'transfer.out'], ['ag2', 'transfer.in']]]);
    // And both are stored: one row for the parent it left and one for the parent it joined.
    expect(pos.notices.map((row) => [row.userId, row.kind])).toEqual([['ag1', 'transfer.out'], ['ag2', 'transfer.in']]);

    const agent = await tree();
    const heardAgent = listen(agent.notice);
    await agent.service.transferAccount(agent.gates.branch, 'ag1', agentMove());
    expect(heardAgent.written).toEqual([
      { userIds: ['ma1'], actorId: 'branch', draft: { kind: 'transfer.out', payload: { kind: 'agent', subject: 'ag1', toLogin: 'ma2', actorName: 'branch' } } },
      { userIds: ['ma2'], actorId: 'branch', draft: { kind: 'transfer.in', payload: { kind: 'agent', subject: 'ag1', fromLogin: 'ma1', actorName: 'branch' } } },
    ]);
    expect(agent.notices.map((row) => [row.userId, row.kind])).toEqual([['ma1', 'transfer.out'], ['ma2', 'transfer.in']]);
  });

  it('files the notices with the wallet group, and they open the users page', () => {
    const payload = { kind: 'pos' as const, subject: 'pos1', actorName: 'branch' };
    expect(hrefFor({ kind: 'transfer.out', payload: { ...payload, toLogin: 'ag2' } })).toBe('/users');
    expect(hrefFor({ kind: 'transfer.in', payload: { ...payload, fromLogin: 'ag1' } })).toBe('/users');
    expect(NOTICE_GROUPS.wallet).toEqual(expect.arrayContaining(['transfer.out', 'transfer.in']));
  });

  it('is one transaction: a notice that cannot be written puts the whole move back and publishes nothing', async () => {
    const fixture = await busyAgent();
    const { service, gates, notice, notices, accounts, userPackages, sellPrices, wallets, lines } = fixture;
    const heard = listen(notice);
    const write = notice.write.bind(notice);
    // The first notice is already stored when the second one fails, so the empty table afterwards is the rollback and not a notice never written.
    const storedWhenItFails: number[] = [];
    notice.write = async (tx, userIds, actor, draft) => {
      if (draft.kind === 'transfer.in') {
        storedWhenItFails.push(notices.length);
        throw new Error('connection lost');
      }
      return write(tx, userIds, actor, draft);
    };
    const stored = () => JSON.stringify({ accounts, userPackages, sellPrices, wallets, lines });
    const before = stored();
    // Every write of an agent's move has run when the second notice fails: the resets and the recapture.
    await expect(service.transferAccount(gates.branch, 'ag1', agentMove({ ...everyReset, linePrices: 'recapture' }))).rejects.toThrow('connection lost');
    expect(stored()).toBe(before);
    expect(notices).toHaveLength(0);
    // So have the stamp and the parent of a point of sale.
    await expect(service.transferAccount(gates.branch, 'pos1', posMove({ ownPrices: 'reset', ownStops: 'reset', linePrices: 'recapture' }))).rejects.toThrow('connection lost');
    expect(stored()).toBe(before);
    expect(notices).toHaveLength(0);
    expect(storedWhenItFails).toEqual([1, 1]);
    expect(heard.published).toEqual([]);
  });
});

describe('transfer: refusals', () => {
  /** Everything a refused move must leave alone. */
  const stored = ({ accounts, userPackages, sellPrices, wallets, lines }: Awaited<ReturnType<typeof busyAgent>>) =>
    JSON.stringify({ accounts, userPackages, sellPrices, wallets, lines });
  const bodyFor = (login: string, parentLogin: string) => (login.startsWith('pos') ? posMove({ parentLogin }) : agentMove({ parentLogin }));

  it('refuses what the rules refuse, as the preview does, and writes nothing', async () => {
    const fixture = await busyAgent();
    const { service, gates, accounts, notice } = fixture;
    const heard = listen(notice);
    // ma1 holds the grants for points of sale and agents but sees only its own chain; ag1 holds neither.
    edit(accounts, 'ma1', { liveGrants: 'transferPos,transferAgents' });
    const before = stored(fixture);
    const cases: [who: string, login: string, parentLogin: string, status: number, code: string][] = [
      ['ag1', 'pos1', 'ag2', 403, 'FORBIDDEN'],
      ['ma1', 'ag1', 'ma2', 403, 'FORBIDDEN'],
      // Someone with no say over moves is told nothing about what exists: every name is a refusal.
      ['ag1', 'ghost', 'ag2', 403, 'FORBIDDEN'],
      ['branch', 'pos1', 'ag1', 400, 'INVALID'],
      ['branch', 'pos1', 'ma1', 400, 'INVALID'],
      ['branch', 'ag1', 'ag2', 400, 'INVALID'],
      ['branch', 'ma1', 'ma2', 400, 'INVALID'],
      ['branch', 'ghost', 'ma2', 400, 'INVALID'],
      ['branch', 'ag1', 'ghost', 400, 'INVALID'],
    ];
    for (const [who, login, parentLogin, status, code] of cases) {
      await expect(service.transferPreview(gates[who], login, { parentLogin })).rejects.toEqual(refused(status, code));
      await expect(service.transferAccount(gates[who], login, bodyFor(login, parentLogin))).rejects.toEqual(refused(status, code));
    }
    // The choices are read before the rules, so an incomplete body is INVALID even to ag1, who may move nothing.
    await expect(service.transferAccount(gates.ag1, 'pos1', { parentLogin: 'ag2' })).rejects.toEqual(refused(400, 'INVALID'));
    await expect(service.transferAccount(gates.branch, 'pos1', { ...posMove(), parentLogin: undefined })).rejects.toEqual(refused(400, 'INVALID'));
    expect(stored(fixture)).toBe(before);
    expect(heard.written).toEqual([]);
    // A frozen destination is refused too.
    edit(accounts, 'ma2', { disabledAt: new Date('2026-11-01T00:00:00.000Z') });
    await expect(service.transferAccount(gates.branch, 'ag1', agentMove())).rejects.toEqual(refused(400, 'INVALID'));
    expect(rowOf(accounts, 'ag1').parentId).toBe('ma1');
  });

  it('a missing or unknown choice is INVALID, and so is a choice about what a point of sale does not have', async () => {
    const fixture = await busyAgent();
    const { service, gates } = fixture;
    const before = stored(fixture);
    const pos = (patch: Record<string, unknown>) => service.transferAccount(gates.branch, 'pos1', posMove(patch));
    const agent = (patch: Record<string, unknown>) => service.transferAccount(gates.branch, 'ag1', agentMove(patch));
    const invalid = refused(400, 'INVALID');
    // A point of sale states three choices, and neither of the other two is its to state.
    for (const key of ['ownPrices', 'ownStops', 'linePrices']) await expect(pos({ [key]: undefined })).rejects.toEqual(invalid);
    await expect(pos({ childPrices: 'keep' })).rejects.toEqual(invalid);
    await expect(pos({ childStops: 'reset' })).rejects.toEqual(invalid);
    // An agent states all five.
    for (const key of ['ownPrices', 'ownStops', 'childPrices', 'childStops', 'linePrices']) await expect(agent({ [key]: undefined })).rejects.toEqual(invalid);
    // There is no default and no other word: reset is no choice for numbers, recapture none for terms.
    for (const value of ['', 'KEEP', 'drop', 'recapture', null, 1, true, ['keep']]) await expect(agent({ ownPrices: value })).rejects.toEqual(invalid);
    for (const value of ['', 'RECAPTURE', 'reset', null, 0, false, ['keep']]) await expect(agent({ linePrices: value })).rejects.toEqual(invalid);
    expect(stored(fixture)).toBe(before);
  });

  it('reads the choices in three steps: their words before any account is read, then the rules, then what is below the account', async () => {
    const { service, gates } = await tree();
    // Counts the reads of the account list: the rules need it, and a body that is not a move must not cost it.
    const users = (service as unknown as { prismaClient: { user: { findMany: (...args: unknown[]) => Promise<unknown> } } }).prismaClient.user;
    const findMany = users.findMany.bind(users);
    let listed = 0;
    users.findMany = (...args) => {
      listed += 1;
      return findMany(...args);
    };
    const invalid = refused(400, 'INVALID');
    const forbidden = refused(403, 'FORBIDDEN');
    // 1. A choice that is missing or is not a word is INVALID to everyone, and no account is read for it: ag1 may move
    // nothing, and nobody has the login ghost. What is below the account may be left out here, but a stated one is a word.
    await expect(service.transferAccount(gates.ag1, 'pos1', posMove({ ownPrices: 'maybe' }))).rejects.toEqual(invalid);
    await expect(service.transferAccount(gates.branch, 'ghost', posMove({ linePrices: undefined }))).rejects.toEqual(invalid);
    await expect(service.transferAccount(gates.ag1, 'pos1', posMove({ childStops: null }))).rejects.toEqual(invalid);
    await expect(service.transferAccount(gates.ag1, 'ag2', agentMove({ childPrices: 'drop' }))).rejects.toEqual(invalid);
    expect(listed).toBe(0);
    // 2. A body of words reads the accounts, and the rules answer.
    await expect(service.transferAccount(gates.ag1, 'pos1', posMove())).rejects.toEqual(forbidden);
    expect(listed).toBe(1);
    // 3. Whether what is below the account is stated depends on its kind, so it is judged once the rules allow the move:
    // a point of sale that states it, or an agent that leaves it out, is INVALID to the branch and FORBIDDEN to ag1.
    await expect(service.transferAccount(gates.branch, 'pos1', posMove({ childPrices: 'keep' }))).rejects.toEqual(invalid);
    await expect(service.transferAccount(gates.branch, 'ag1', agentMove({ childStops: undefined }))).rejects.toEqual(invalid);
    await expect(service.transferAccount(gates.ag1, 'pos1', posMove({ childPrices: 'keep' }))).rejects.toEqual(forbidden);
    await expect(service.transferAccount(gates.ag1, 'ag2', agentMove({ childStops: undefined }))).rejects.toEqual(forbidden);
  });

  it('refuses where a transfer stop sits on the actor path, and not the branch above it', async () => {
    const { service, gates, accounts } = await tree();
    edit(accounts, 'ma1', { liveGrants: 'transferPos', deniedOps: 'transfer' });
    await expect(service.transferAccount(gates.ma1, 'pos1', posMove())).rejects.toEqual(refused(403, 'FORBIDDEN'));
    expect(rowOf(accounts, 'pos1').parentId).toBe('ag1');
    await expect(service.transferAccount(gates.branch, 'pos1', posMove())).resolves.toEqual({ ok: true, lines: 0 });
    expect(rowOf(accounts, 'pos1').parentId).toBe('ag2');
  });

  it('lets a main agent move a point of sale inside its chain', async () => {
    const { service, gates, accounts } = await tree();
    edit(accounts, 'ma1', { liveGrants: 'transferPos' });
    await expect(service.transferAccount(gates.ma1, 'pos1', posMove())).resolves.toEqual({ ok: true, lines: 0 });
    expect(rowOf(accounts, 'pos1').parentId).toBe('ag2');
  });

  it('refuses an impersonating session, even when it is the branch owner entered, and asks for a session', async () => {
    const { service, auth, accounts } = await tree();
    const sessionId = await auth.saveImpersonation({ userId: 'branch', operatorId: 'branch', userAgent: '', ip: '' });
    await expect(service.transferAccount({ sessionId }, 'ag1', agentMove())).rejects.toEqual(refused(403, 'FORBIDDEN'));
    await expect(service.transferAccount({}, 'ag1', agentMove())).rejects.toEqual(refused(401, 'LOGIN_REQUIRED'));
    expect(rowOf(accounts, 'ag1').parentId).toBe('ma1');
  });
});

describe('transfer: a number', () => {
  /** What a move of a number touches, and so what a refused one must leave alone. */
  const stored = ({ lines, entries, notices, wallets }: Awaited<ReturnType<typeof tree>>) => JSON.stringify({ lines, entries, notices, wallets });

  it('lets an agent move a number between its own points of sale', async () => {
    const { service, gates, accounts, line } = await tree();
    accounts.push(account('pos3', 'pos', 'ag1'));
    edit(accounts, 'ag1', { liveGrants: 'transferLines' });
    await expect(service.transferLine(gates.ag1, 'ln1', lineMove({ posLogin: 'pos3' }))).resolves.toEqual({ ok: true });
    expect(line).toMatchObject({ posId: 'pos3', opsLocked: false });
  });

  it('refuses an agent a point of sale under another agent, and lets the main agent above both move the number there', async () => {
    const { service, gates, accounts, line } = await tree();
    edit(accounts, 'ag1', { liveGrants: 'transferLines' });
    edit(accounts, 'ma1', { liveGrants: 'transferLines' });
    // pos2 sits under ag2: outside what ag1 sees, inside what ma1 sees.
    await expect(service.transferLine(gates.ag1, 'ln1', lineMove())).rejects.toEqual(refused(403, 'FORBIDDEN'));
    expect(line.posId).toBe('pos1');
    await expect(service.transferLine(gates.ma1, 'ln1', lineMove())).resolves.toEqual({ ok: true });
    expect(line.posId).toBe('pos2');
  });

  it('recapture prices the number under the new point of sale, and keep leaves its terms as they are', async () => {
    const recaptured = await sellers();
    const before = structuredClone(recaptured.line.terms) as LineTerms;
    expect(before.renewal.posPrice).toBe(3200);
    await expect(recaptured.service.transferLine(recaptured.gates.branch, 'ln1', lineMove({ linePrices: 'recapture' }))).resolves.toEqual({ ok: true });
    // Under ag2, not under ag1 and not the layer column; what the number was captured with stays.
    expect(recaptured.line.posId).toBe('pos2');
    expect(renewalOf(recaptured.line)).toBe(3400);
    expect(recaptured.line.terms).toMatchObject({
      packageCode: before.packageCode, months: before.months, windowMonths: before.windowMonths, subscription: before.subscription,
    });

    const kept = await sellers();
    const unchanged = structuredClone(kept.line.terms);
    await expect(kept.service.transferLine(kept.gates.branch, 'ln1', lineMove({ linePrices: 'keep' }))).resolves.toEqual({ ok: true });
    expect(kept.line.posId).toBe('pos2');
    expect(kept.line.terms).toEqual(unchanged);
    expect(renewalOf(kept.line)).toBe(3200);
  });

  it('recapture resolves through the new point of sale: its own price is the nearest, and nothing of the old one follows the number', async () => {
    const run = async (...rows: Row[]) => {
      const { service, gates, userPackages, line } = await sellers();
      userPackages.push(...rows);
      await service.transferLine(gates.branch, 'ln1', lineMove({ linePrices: 'recapture' }));
      return renewalOf(line);
    };
    // On the new path ag2 sells at 3400. What the old agent sells at (3300) does not follow the number, and neither does a price of its own on the old point of sale.
    await expect(run()).resolves.toBe(3400);
    await expect(run(terms('pos1', 'pa', { renewalPrice: 3050 }))).resolves.toBe(3400);
    // The new point of sale's own price beats the sell price of its agent.
    await expect(run(terms('pos2', 'pa', { renewalPrice: 3100 }))).resolves.toBe(3100);
  });

  it('recaptures a number that can still renew, active or frozen, and moves one that cannot with its terms as they are', async () => {
    const moved = async (status: string) => {
      const { service, gates, line } = await sellers();
      line.status = status;
      const before = structuredClone(line.terms);
      await expect(service.transferLine(gates.branch, 'ln1', lineMove({ linePrices: 'recapture' }))).resolves.toEqual({ ok: true });
      // Whatever its state, the number moves and keeps it.
      expect(line).toMatchObject({ posId: 'pos2', status });
      return { line, before };
    };
    for (const status of ['active', 'frozen']) {
      const { line } = await moved(status);
      expect(renewalOf(line)).toBe(3400);
    }
    // As in the move of an account, only the numbers that can renew are priced again.
    for (const status of ['disconnected', 'suspended']) {
      const { line, before } = await moved(status);
      expect(line.terms).toEqual(before);
      expect(renewalOf(line)).toBe(3200);
    }
  });

  it('refuses where a transfer stop sits on the actor path, and not the branch above it', async () => {
    const { service, gates, accounts, line } = await tree();
    edit(accounts, 'ma1', { liveGrants: 'transferLines', deniedOps: 'transfer' });
    await expect(service.transferLine(gates.ma1, 'ln1', lineMove())).rejects.toEqual(refused(403, 'FORBIDDEN'));
    expect(line.posId).toBe('pos1');
    await expect(service.transferLine(gates.branch, 'ln1', lineMove())).resolves.toEqual({ ok: true });
    expect(line.posId).toBe('pos2');
  });

  it('judges the stop on whoever moves the number, not on the point of sale that owns it', async () => {
    const { service, gates, accounts, line } = await tree();
    edit(accounts, 'ma1', { liveGrants: 'transferLines' });
    // The stops of the selling account and of its agent sit below ma1, not on its path.
    edit(accounts, 'pos1', { deniedOps: 'transfer' });
    edit(accounts, 'ag1', { deniedOps: 'transfer' });
    await expect(service.transferLine(gates.ma1, 'ln1', lineMove())).resolves.toEqual({ ok: true });
    expect(line.posId).toBe('pos2');
  });

  it('refuses a frozen point of sale, and a number that already is on the one named', async () => {
    const { service, gates, accounts, line } = await tree();
    edit(accounts, 'pos2', { disabledAt: new Date('2026-11-01T00:00:00.000Z') });
    await expect(service.transferLine(gates.branch, 'ln1', lineMove())).rejects.toEqual(refused(400, 'INVALID'));
    expect(line.posId).toBe('pos1');
    await expect(service.transferLine(gates.branch, 'ln1', lineMove({ posLogin: 'pos1' }))).rejects.toEqual(refused(400, 'INVALID'));
    // A frozen point of sale may still send a number away.
    edit(accounts, 'pos2', { disabledAt: null });
    edit(accounts, 'pos1', { disabledAt: new Date('2026-11-01T00:00:00.000Z') });
    await expect(service.transferLine(gates.branch, 'ln1', lineMove())).resolves.toEqual({ ok: true });
    expect(line.posId).toBe('pos2');
  });

  it('refuses what the rules refuse, as the move of an account does, and writes nothing', async () => {
    const fixture = await tree();
    const { service, gates, accounts, lines, line, notice } = fixture;
    // A second chain under ma2, with a number of its own. ma1 holds the grant for numbers but sees only its own chain.
    accounts.push(account('ag3', 'agent', 'ma2'), account('pos4', 'pos', 'ag3'));
    lines.push(number(line, 'ln2', { posId: 'pos4' }));
    edit(accounts, 'ma1', { liveGrants: 'transferLines' });
    // A grant for another kind is no grant for numbers.
    edit(accounts, 'ag1', { liveGrants: 'transferPos,transferAgents' });
    const heard = listen(notice);
    const before = stored(fixture);
    const cases: [who: string, lineId: string, posLogin: unknown, status: number, code: string][] = [
      ['ag1', 'ln1', 'pos2', 403, 'FORBIDDEN'],
      ['ma1', 'ln1', 'pos4', 403, 'FORBIDDEN'],
      ['ma1', 'ln2', 'pos2', 403, 'FORBIDDEN'],
      ['branch', 'ghost', 'pos2', 404, 'NOT_FOUND'],
      ['branch', 'ln1', 'pos1', 400, 'INVALID'],
      ['branch', 'ln1', 'ag2', 400, 'INVALID'],
      ['branch', 'ln1', 'ma1', 400, 'INVALID'],
      ['branch', 'ln1', 'ghost', 400, 'INVALID'],
      ...[undefined, '', ['pos2'], 7, null].map((posLogin): [string, string, unknown, number, string] => ['branch', 'ln1', posLogin, 400, 'INVALID']),
    ];
    for (const [who, lineId, posLogin, status, code] of cases) {
      await expect(service.transferLine(gates[who], lineId, lineMove({ posLogin }))).rejects.toEqual(refused(status, code));
    }
    expect(stored(fixture)).toBe(before);
    expect(heard.written).toEqual([]);
  });

  it('reads the price choice before the number or any account: a word that is not one is INVALID to everyone', async () => {
    const { service, gates } = await tree();
    type Read = (...args: unknown[]) => Promise<unknown>;
    const client = (service as unknown as { prismaClient: { user: { findMany: Read }; line: { findUnique: Read } } }).prismaClient;
    let reads = 0;
    const listed = client.user.findMany.bind(client.user);
    client.user.findMany = (...args) => {
      reads += 1;
      return listed(...args);
    };
    const found = client.line.findUnique.bind(client.line);
    client.line.findUnique = (...args) => {
      reads += 1;
      return found(...args);
    };
    // The branch may move numbers and ag1 may not; the choice is wrong for both, and nothing says which line or account exists.
    for (const who of ['branch', 'ag1']) {
      for (const linePrices of [undefined, '', 'KEEP', 'reset', 'drop', 'Recapture', null, 0, 1, true, ['keep'], {}]) {
        await expect(service.transferLine(gates[who], 'ln1', lineMove({ linePrices }))).rejects.toEqual(refused(400, 'INVALID'));
      }
      await expect(service.transferLine(gates[who], 'ghost', { posLogin: 'pos2' })).rejects.toEqual(refused(400, 'INVALID'));
    }
    expect(reads).toBe(0);
    // A body of words reads the number and the accounts, and the rules answer: the spy does count.
    await expect(service.transferLine(gates.ag1, 'ln1', lineMove())).rejects.toEqual(refused(403, 'FORBIDDEN'));
    expect(reads).toBeGreaterThan(0);
  });

  it('refuses an impersonating session, even when it is the branch owner entered, and asks for a session', async () => {
    const { service, auth, line } = await tree();
    const sessionId = await auth.saveImpersonation({ userId: 'branch', operatorId: 'branch', userAgent: '', ip: '' });
    await expect(service.transferLine({ sessionId }, 'ln1', lineMove())).rejects.toEqual(refused(403, 'FORBIDDEN'));
    await expect(service.transferLine({}, 'ln1', lineMove())).rejects.toEqual(refused(401, 'LOGIN_REQUIRED'));
    expect(line.posId).toBe('pos1');
  });

  it('writes transfer.out to the point of sale that lost the number and transfer.in to the one that received it', async () => {
    const { service, gates, notice, notices } = await tree();
    const heard = listen(notice);
    await service.transferLine(gates.branch, 'ln1', lineMove());
    expect(heard.written).toEqual([
      { userIds: ['pos1'], actorId: 'branch', draft: { kind: 'transfer.out', payload: { kind: 'line', subject: '0521000001', toLogin: 'pos2', actorName: 'branch' } } },
      { userIds: ['pos2'], actorId: 'branch', draft: { kind: 'transfer.in', payload: { kind: 'line', subject: '0521000001', fromLogin: 'pos1', actorName: 'branch' } } },
    ]);
    // Both are published together, once the move has committed, and both are stored.
    expect(heard.published.map((rows) => rows.map((row) => [row.userId, row.kind]))).toEqual([[['pos1', 'transfer.out'], ['pos2', 'transfer.in']]]);
    expect(notices.map((row) => [row.userId, row.kind])).toEqual([['pos1', 'transfer.out'], ['pos2', 'transfer.in']]);
  });

  it('keeps the transfer on the operation record of the point of sale the number left, and moves no money', async () => {
    for (const linePrices of ['keep', 'recapture']) {
      const { service, gates, entries, wallets } = await sellers();
      await service.transferLine(gates.branch, 'ln1', lineMove({ linePrices }));
      expect(entries).toEqual([
        expect.objectContaining({ userId: 'pos1', actorId: 'branch', kind: 'transfer', amount: 0, balanceAfter: 100000, msisdn: '0521000001', lineId: 'ln1', packageName: '150 جيجا' }),
      ]);
      expect(rowOf(wallets, 'w-pos1').balance).toBe(100000);
      expect(rowOf(wallets, 'w-pos2').balance).toBe(0);
    }
  });

  it('is one transaction: a notice that cannot be written puts the number, its price, and its record back and publishes nothing', async () => {
    const fixture = await sellers();
    const { service, gates, notice, notices, entries, line } = fixture;
    const heard = listen(notice);
    const write = notice.write.bind(notice);
    // The first notice is stored and the number has moved when the second one fails, so what is back afterwards is the rollback and not a write that never ran.
    const whenItFails: { entries: number; notices: number; posId: unknown; price: number }[] = [];
    notice.write = async (tx, userIds, actor, draft) => {
      if (draft.kind === 'transfer.in') {
        whenItFails.push({ entries: entries.length, notices: notices.length, posId: line.posId, price: renewalOf(line) });
        throw new Error('connection lost');
      }
      return write(tx, userIds, actor, draft);
    };
    const before = stored(fixture);
    await expect(service.transferLine(gates.branch, 'ln1', lineMove({ linePrices: 'recapture' }))).rejects.toThrow('connection lost');
    expect(whenItFails).toEqual([{ entries: 1, notices: 1, posId: 'pos2', price: 3400 }]);
    expect(stored(fixture)).toBe(before);
    expect(line).toMatchObject({ posId: 'pos1' });
    expect(renewalOf(line)).toBe(3200);
    expect(heard.published).toEqual([]);
  });

  it('refuses the whole move when a recapture cannot be priced, and keep still moves the number', async () => {
    const fixture = await tree();
    const { service, gates, pkgA, pkgB, line } = fixture;
    // The package lists a renewal target that has no company, so the number cannot be captured again.
    pkgA.renewals = [{ target: { ...pkgB, company: null } }];
    const before = stored(fixture);
    await expect(service.transferLine(gates.branch, 'ln1', lineMove({ linePrices: 'recapture' }))).rejects.toEqual(refused(400, 'INVALID'));
    expect(stored(fixture)).toBe(before);
    expect(line.posId).toBe('pos1');
    await expect(service.transferLine(gates.branch, 'ln1', lineMove({ linePrices: 'keep' }))).resolves.toEqual({ ok: true });
    expect(line.posId).toBe('pos2');
  });
});

describe('the transfer routes under /office', () => {
  let app: INestApplication | undefined;
  const recorded: unknown[][] = [];

  afterEach(async () => {
    await app?.close();
    app = undefined;
    recorded.length = 0;
  });

  async function appFor(service: OfficeFacade) {
    // Every office route, whichever controller holds it, over this service's kernel (its in-memory tables).
    const kernel = (service as unknown as { kernel: OfficeKernel }).kernel;
    const moduleRef = await Test.createTestingModule({
      controllers: OFFICE_CONTROLLERS,
      providers: [
        ...OFFICE_PROVIDERS.filter((provider) => provider !== OfficeKernel),
        { provide: OfficeKernel, useValue: kernel },
        {
          provide: ActivityRecorder,
          useValue: {
            recordOffice: async (...args: unknown[]) => {
              recorded.push(args);
            },
          },
        },
      ],
    }).compile();
    const created = moduleRef.createNestApplication();
    await created.init();
    return created;
  }

  it('GET transfer-preview answers the preview as JSON, refuses as the move would, and records no activity', async () => {
    const { service, gates } = await busyAgent();
    app = await appFor(service);
    const get = (gate: { sessionId: string } | null, search: string) => {
      const call = request(app!.getHttpServer()).get(`/office/users/ag1/transfer-preview${search}`);
      return gate ? call.set('Cookie', `sid=${gate.sessionId}`) : call;
    };

    const ok = await get(gates.branch, '?parentLogin=ma2');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(BUSY_PREVIEW);

    const forbidden = await get(gates.ag1, '?parentLogin=ma2');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });

    for (const search of ['', '?parentLogin=', '?parentLogin=ma2&parentLogin=ag2']) {
      const invalid = await get(gates.branch, search);
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ code: 'INVALID' });
    }

    const anonymous = await get(null, '?parentLogin=ma2');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'LOGIN_REQUIRED' });

    expect(recorded).toEqual([]);
  });

  it('POST transfer moves the account, answers the count, and records user_transfer under the moved login', async () => {
    const { service, gates } = await busyAgent();
    app = await appFor(service);
    const post = (gate: { sessionId: string }, login: string, body: object) =>
      request(app!.getHttpServer()).post(`/office/users/${login}/transfer`).set('Cookie', `sid=${gate.sessionId}`).send(body);

    const ok = await post(gates.branch, 'ag1', agentMove({ linePrices: 'recapture' }));
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ ok: true, lines: 2 });

    const forbidden = await post(gates.ag1, 'pos1', posMove());
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });

    const invalid = await post(gates.branch, 'pos1', { parentLogin: 'ag2' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ code: 'INVALID' });

    // Every answer is recorded under the moved login, with the reason a refusal gave.
    const event = (login: string) => ({ action: 'user_transfer', subjectKind: 'user', subjectRef: login });
    expect(recorded.map(([, , draft, result, reason]) => [draft, result, reason])).toEqual([
      [event('ag1'), 'ok', ''],
      [event('pos1'), 'fail', 'FORBIDDEN'],
      [event('pos1'), 'fail', 'INVALID'],
    ]);
  });

  it('POST lines/:id/transfer hands the service the whole body: the point of sale and the price choice', async () => {
    const { service, gates, accounts, line } = await sellers();
    edit(accounts, 'ag1', { liveGrants: 'transferLines' });
    app = await appFor(service);
    const post = (gate: { sessionId: string }, body: object) =>
      request(app!.getHttpServer()).post('/office/lines/ln1/transfer').set('Cookie', `sid=${gate.sessionId}`).send(body);

    const forbidden = await post(gates.ag1, lineMove());
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });

    // A body that names the point of sale and leaves the price out is not a move.
    const invalid = await post(gates.branch, { posLogin: 'pos2' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ code: 'INVALID' });
    expect(line.posId).toBe('pos1');

    // The choice reaches the service: the number takes the price of its new point of sale.
    const ok = await post(gates.branch, lineMove({ linePrices: 'recapture' }));
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ ok: true });
    expect(line.posId).toBe('pos2');
    expect(renewalOf(line)).toBe(3400);
  });
});
