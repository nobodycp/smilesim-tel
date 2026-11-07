import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ActivityRecorder } from './activity-recorder';
import { OfficeController } from './office.controller';
import { OfficeService } from './office.service';
import { account, tree, type Row } from './tree-fixture';

// Moving an account, and what the office is told before it does.
// The tree is the one in tree-fixture.ts: branch → ma1 → ag1 → pos1 and ma1 → ag2 → pos2, plus ma2 with nothing under it.
// The fixture's accounts hold no grants but the branch owner's, so each case gives its actor the grant it is about.

/** Sets fields on the stored row with this id: an account, or a wallet (`w-<login>`). */
const edit = (rows: { id: string }[], id: string, patch: Record<string, unknown>) => Object.assign(rows.find((item) => item.id === id) as Row, patch);
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

  it('gives an agent with no points of sale an empty child section and no balance below it', async () => {
    const { service, gates, accounts, wallets } = await tree();
    accounts.push(account('ag3', 'agent', 'ma1'));
    wallets.push({ id: 'w-ag3', userId: 'ag3', balance: 900, ceiling: 0 });
    await expect(service.transferPreview(gates.branch, 'ag3', { parentLogin: 'ma2' })).resolves.toEqual({
      balance: 900,
      subtreeBalance: 0,
      own: { customPrices: 0, hidden: 0, stops: 0, belowNewFloor: 0 },
      child: null,
      lines: 0,
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
  const refused = (status: number, code: string) => expect.objectContaining({ status, code });

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
    const sessionId = await auth.saveImpersonation({ userId: 'branch', userAgent: '', ip: '' });
    for (const login of ['ag1', 'pos1', 'ma1', 'ghost']) {
      await expect(service.transferPreview({ sessionId }, login, { parentLogin: 'ma2' })).rejects.toEqual(refused(403, 'FORBIDDEN'));
    }
  });

  it('asks for a session', async () => {
    const { service } = await tree();
    await expect(service.transferPreview({}, 'ag1', { parentLogin: 'ma2' })).rejects.toEqual(refused(401, 'LOGIN_REQUIRED'));
  });
});

describe('GET /office/users/:loginName/transfer-preview', () => {
  let app: INestApplication | undefined;
  const recorded: unknown[][] = [];

  afterEach(async () => {
    await app?.close();
    app = undefined;
    recorded.length = 0;
  });

  async function appFor(service: OfficeService) {
    const moduleRef = await Test.createTestingModule({
      controllers: [OfficeController],
      providers: [
        { provide: OfficeService, useValue: service },
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

  it('answers the preview as JSON, refuses as the move would, and records no activity', async () => {
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
});
