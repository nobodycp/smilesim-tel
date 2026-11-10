import type { GrantCode } from '../rules/office-grants';
import {
  DESTINATION_LAYER,
  TRANSFER_GRANT,
  canTransfer,
  parseChoice,
  parseLineChoice,
  previewOf,
  transferKind,
} from './transfer-rules';
import type { OpKey, PathNode, SellRow, TermRow } from '../rules/user-terms';

type Input = Parameters<typeof canTransfer>[0];

// The tree these cases read: branch → ma1 → ag1 → pos1, pos2 and ma1 → ag2 → pos3; branch → ma2 → ag3.
// `visible` is what the actor sees, so each case lists the accounts of its own subtree.
const holding = (...grants: GrantCode[]) => ({ grants, impersonating: false });
const stopped = (...keys: OpKey[]) => new Set<OpKey>(keys);

// An agent holding transferLines moves a number from pos1 to its other point of sale, pos2.
const agentMovesNumber = (patch: Partial<Input> = {}): Input => ({
  kind: 'line',
  actor: holding('read', 'accounting', 'tasks', 'transferLines'),
  actorStops: stopped(),
  currentParentId: 'pos1',
  destination: { id: 'pos2', layer: 'pos', frozen: false },
  visible: new Set(['ag1', 'pos1', 'pos2']),
  ...patch,
});

// A main agent holding transferPos moves pos1 from ag1 to ag2, both inside its chain.
const mainMovesPos = (patch: Partial<Input> = {}): Input => ({
  kind: 'pos',
  actor: holding('read', 'accounting', 'tasks', 'transferLines', 'transferPos'),
  actorStops: stopped(),
  currentParentId: 'ag1',
  destination: { id: 'ag2', layer: 'agent', frozen: false },
  visible: new Set(['ma1', 'ag1', 'ag2', 'pos1', 'pos2', 'pos3']),
  ...patch,
});

// The branch owner moves ag1 from ma1 to ma2 and sees every account.
const branchMovesAgent = (patch: Partial<Input> = {}): Input => ({
  kind: 'agent',
  actor: holding('read', 'edit', 'accounting', 'tasks', 'reports', 'staff', 'enter', 'transferLines', 'transferPos', 'transferAgents'),
  actorStops: stopped(),
  currentParentId: 'ma1',
  destination: { id: 'ma2', layer: 'main_agent', frozen: false },
  visible: new Set(['branch', 'ma1', 'ma2', 'ag1', 'ag2', 'ag3', 'pos1', 'pos2', 'pos3']),
  ...patch,
});

describe('transferKind', () => {
  it('names a point of sale and an agent by their own layer', () => {
    expect(transferKind('pos')).toBe('pos');
    expect(transferKind('agent')).toBe('agent');
  });

  it('is null for a main agent, the branch, and anything unknown', () => {
    expect(transferKind('main_agent')).toBeNull();
    expect(transferKind('branch')).toBeNull();
    expect(transferKind('')).toBeNull();
    expect(transferKind('staff')).toBeNull();
  });
});

describe('what each kind needs', () => {
  it('answers to its own grant', () => {
    expect(TRANSFER_GRANT).toEqual({ line: 'transferLines', pos: 'transferPos', agent: 'transferAgents' });
  });

  it('lands on the layer one step above what moves', () => {
    expect(DESTINATION_LAYER).toEqual({ line: 'pos', pos: 'agent', agent: 'main_agent' });
  });
});

describe('canTransfer: numbers', () => {
  it('lets an agent holding transferLines move a number between its own points of sale', () => {
    expect(canTransfer(agentMovesNumber())).toBeNull();
  });

  it('refuses a destination outside the actor subtree', () => {
    expect(canTransfer(agentMovesNumber({ visible: new Set(['ag1', 'pos1']) }))).toBe('FORBIDDEN');
  });

  it('refuses a number that sits outside the actor subtree', () => {
    expect(canTransfer(agentMovesNumber({ visible: new Set(['ag1', 'pos2']) }))).toBe('FORBIDDEN');
  });

  it('refuses when the grant is missing', () => {
    expect(canTransfer(agentMovesNumber({ actor: holding('read', 'accounting', 'tasks') }))).toBe('FORBIDDEN');
    expect(canTransfer(agentMovesNumber({ actor: holding() }))).toBe('FORBIDDEN');
  });

  it('does not take another kind grant for this one', () => {
    expect(canTransfer(agentMovesNumber({ actor: holding('transferPos', 'transferAgents') }))).toBe('FORBIDDEN');
  });

  it('refuses an impersonating session that holds the grant', () => {
    expect(canTransfer(agentMovesNumber({ actor: { ...holding('transferLines'), impersonating: true } }))).toBe('FORBIDDEN');
  });

  it('refuses when transfer is stopped on the actor path', () => {
    expect(canTransfer(agentMovesNumber({ actorStops: stopped('transfer') }))).toBe('FORBIDDEN');
    expect(canTransfer(agentMovesNumber({ actorStops: stopped('charge', 'transfer') }))).toBe('FORBIDDEN');
  });

  it('is not stopped by the other operation stops', () => {
    expect(canTransfer(agentMovesNumber({ actorStops: stopped('activate', 'charge', 'sim', 'esim') }))).toBeNull();
  });

  it('refuses a destination that is not there', () => {
    expect(canTransfer(agentMovesNumber({ destination: null }))).toBe('INVALID');
  });

  it('refuses a destination of the wrong layer', () => {
    expect(canTransfer(agentMovesNumber({ destination: { id: 'ag2', layer: 'agent', frozen: false } }))).toBe('INVALID');
    expect(canTransfer(agentMovesNumber({ destination: { id: 'ma1', layer: 'main_agent', frozen: false } }))).toBe('INVALID');
  });

  it('refuses a frozen destination', () => {
    expect(canTransfer(agentMovesNumber({ destination: { id: 'pos2', layer: 'pos', frozen: true } }))).toBe('INVALID');
  });

  it('refuses the point of sale the number already sits on', () => {
    expect(canTransfer(agentMovesNumber({ destination: { id: 'pos1', layer: 'pos', frozen: false } }))).toBe('INVALID');
  });
});

describe('canTransfer: points of sale', () => {
  it('lets a main agent move a point of sale between agents of its chain', () => {
    expect(canTransfer(mainMovesPos())).toBeNull();
  });

  it('refuses an agent of another chain', () => {
    expect(canTransfer(mainMovesPos({ destination: { id: 'ag3', layer: 'agent', frozen: false } }))).toBe('FORBIDDEN');
  });

  it('refuses a point of sale that is not in its chain', () => {
    expect(canTransfer(mainMovesPos({ currentParentId: 'ag3', visible: new Set(['ma1', 'ag1', 'ag2', 'pos1']) }))).toBe('FORBIDDEN');
  });

  it('needs transferPos, not transferLines', () => {
    expect(canTransfer(mainMovesPos({ actor: holding('transferLines') }))).toBe('FORBIDDEN');
  });

  it('refuses a main agent as the destination of a point of sale', () => {
    expect(canTransfer(mainMovesPos({ destination: { id: 'ma1', layer: 'main_agent', frozen: false } }))).toBe('INVALID');
  });

  it('refuses when transfer is stopped on the main agent', () => {
    expect(canTransfer(mainMovesPos({ actorStops: stopped('transfer') }))).toBe('FORBIDDEN');
  });
});

describe('canTransfer: agents', () => {
  it('lets the branch move an agent from one main agent to another', () => {
    expect(canTransfer(branchMovesAgent())).toBeNull();
  });

  it('needs transferAgents, not the two grants below it', () => {
    expect(canTransfer(branchMovesAgent({ actor: holding('transferLines', 'transferPos') }))).toBe('FORBIDDEN');
  });

  it('refuses an agent as the destination of an agent', () => {
    expect(canTransfer(branchMovesAgent({ destination: { id: 'ag2', layer: 'agent', frozen: false } }))).toBe('INVALID');
  });

  it('refuses the main agent the agent already sits under', () => {
    expect(canTransfer(branchMovesAgent({ destination: { id: 'ma1', layer: 'main_agent', frozen: false } }))).toBe('INVALID');
  });

  it('refuses a main agent the actor cannot see', () => {
    const visible = new Set(['ma1', 'ag1']);
    expect(canTransfer(branchMovesAgent({ actor: holding('transferAgents'), visible }))).toBe('FORBIDDEN');
  });

  it('refuses when transfer is stopped on the actor path, whoever holds the grant', () => {
    expect(canTransfer(branchMovesAgent({ actorStops: stopped('transfer') }))).toBe('FORBIDDEN');
  });
});

describe('canTransfer: order of the rules', () => {
  it('a missing grant or an impersonation answers FORBIDDEN before the destination is read', () => {
    expect(canTransfer(agentMovesNumber({ actor: holding(), destination: null }))).toBe('FORBIDDEN');
    expect(canTransfer(agentMovesNumber({ actor: { ...holding('transferLines'), impersonating: true }, destination: null }))).toBe('FORBIDDEN');
  });

  it('a stop answers FORBIDDEN before the destination is read', () => {
    expect(canTransfer(agentMovesNumber({ actorStops: stopped('transfer'), destination: null }))).toBe('FORBIDDEN');
    expect(canTransfer(agentMovesNumber({ actorStops: stopped('transfer'), destination: { id: 'pos2', layer: 'pos', frozen: true } }))).toBe('FORBIDDEN');
  });

  it('a destination that cannot be valid answers INVALID before visibility is looked at', () => {
    const outside = new Set<string>();
    expect(canTransfer(agentMovesNumber({ visible: outside, destination: { id: 'pos9', layer: 'pos', frozen: true } }))).toBe('INVALID');
    expect(canTransfer(agentMovesNumber({ visible: outside, destination: { id: 'ag9', layer: 'agent', frozen: false } }))).toBe('INVALID');
    expect(canTransfer(agentMovesNumber({ visible: outside, destination: { id: 'pos1', layer: 'pos', frozen: false } }))).toBe('INVALID');
  });

  it('visibility is the last word, and it fails on either end', () => {
    expect(canTransfer(agentMovesNumber({ visible: new Set() }))).toBe('FORBIDDEN');
    expect(canTransfer(agentMovesNumber({ visible: new Set(['pos1']) }))).toBe('FORBIDDEN');
    expect(canTransfer(agentMovesNumber({ visible: new Set(['pos2']) }))).toBe('FORBIDDEN');
  });
});

describe('parseChoice', () => {
  it('accepts keep and reset', () => {
    expect(parseChoice('keep')).toBe('keep');
    expect(parseChoice('reset')).toBe('reset');
  });

  it('has no default: anything else is null', () => {
    for (const value of ['x', '', 'KEEP', ' keep', 'recapture', undefined, null, 1, true, {}, ['keep']]) {
      expect(parseChoice(value)).toBeNull();
    }
  });
});

describe('parseLineChoice', () => {
  it('accepts keep and recapture', () => {
    expect(parseLineChoice('keep')).toBe('keep');
    expect(parseLineChoice('recapture')).toBe('recapture');
  });

  it('has no default, and reset is not a choice for numbers', () => {
    for (const value of ['reset', 'x', '', 'Recapture', undefined, null, 0, false, {}, ['keep']]) {
      expect(parseLineChoice(value)).toBeNull();
    }
  });
});

// The preview of a move reads the same tree as above. A path runs from the account up to the root, so the moved
// account is its first entry. The layer columns of the package: agents pay 3000 (renewal 2700), main agents 2500 (2200).
type Preview = Parameters<typeof previewOf>[0];

const node = (id: string, layer: string, deniedOps = ''): PathNode => ({ id, loginName: id, layer, deniedOps });
const branch = node('branch', 'branch');
const ma1 = node('ma1', 'main_agent');
const ma2 = node('ma2', 'main_agent');
const columns = {
  branchCost: 2000,
  mainPrice: 2500,
  agentPrice: 3000,
  posPrice: 3500,
  renewalBranchCost: 1800,
  renewalMainPrice: 2200,
  renewalAgentPrice: 2700,
  renewalPosPrice: 3200,
};
const alloha = { id: 'pa', ...columns };
const heavy = { id: 'pb', ...columns, agentPrice: 3200 };
const row = (userId: string, patch: Partial<TermRow> = {}, packageId = 'pa'): TermRow & { packageId: string } => ({
  packageId,
  userId,
  hidden: false,
  price: null,
  renewalPrice: null,
  ...patch,
});
const sold = (ownerId: string, price: number, renewalPrice: number | null = null, packageId = 'pa'): SellRow & { packageId: string } => ({
  packageId,
  ownerId,
  price,
  renewalPrice,
});

describe('previewOf: a point of sale moving between agents', () => {
  const pos1 = node('pos1', 'pos');
  // pos1 leaves ag1 for ag2, both under ma1.
  const move = (patch: Partial<Preview> = {}): Preview => ({
    moved: [pos1, node('ag1', 'agent'), ma1, branch],
    nextPath: [pos1, node('ag2', 'agent'), ma1, branch],
    // A point of sale has nothing below it, which is not the same as an agent with no points of sale.
    children: null,
    terms: [],
    sells: [],
    packages: [alloha],
    ...patch,
  });

  it('counts a kept custom price that sits below what the new parent pays', () => {
    const answer = previewOf(move({ terms: [row('pos1', { price: 2900 })] }));
    expect(answer.own).toEqual({ customPrices: 1, hidden: 0, stops: 0, belowNewFloor: 1 });
  });

  it('has nothing below it: a point of sale carries no child terms', () => {
    const answer = previewOf(move({ terms: [row('pos1', { price: 2900 })], sells: [sold('ma1', 3300)] }));
    expect(answer.child).toBeNull();
  });

  it('does not count a price that equals the floor or sits above it', () => {
    expect(previewOf(move({ terms: [row('pos1', { price: 3000 })] })).own.belowNewFloor).toBe(0);
    expect(previewOf(move({ terms: [row('pos1', { price: 3100 })] })).own.belowNewFloor).toBe(0);
  });

  it('counts a row once, and holds each of its two prices to its own floor', () => {
    const below = (patch: Partial<TermRow>) => previewOf(move({ terms: [row('pos1', patch)] })).own;
    expect(below({ price: 2900, renewalPrice: 2600 })).toMatchObject({ customPrices: 1, belowNewFloor: 1 });
    // Only the renewal price is under its floor, 2700.
    expect(below({ price: 3100, renewalPrice: 2600 })).toMatchObject({ customPrices: 1, belowNewFloor: 1 });
    expect(below({ renewalPrice: 2600 })).toMatchObject({ customPrices: 1, belowNewFloor: 1 });
    expect(below({ price: 3100, renewalPrice: 2700 })).toMatchObject({ customPrices: 1, belowNewFloor: 0 });
    // The subscription price is not judged against the renewal floor, nor the renewal price against the subscription one.
    expect(below({ price: 2800 })).toMatchObject({ belowNewFloor: 1 });
    expect(below({ renewalPrice: 2800 })).toMatchObject({ belowNewFloor: 0 });
  });

  it('reads the floor through the new parent: its own price, else the sell price above it, else its layer column', () => {
    const kept = row('pos1', { price: 3250 });
    expect(previewOf(move({ terms: [kept] })).own.belowNewFloor).toBe(0);
    // ma1 sells to its agents at 3400, so ag2 pays 3400 and pos1 sits under it.
    expect(previewOf(move({ terms: [kept], sells: [sold('ma1', 3400)] })).own.belowNewFloor).toBe(1);
    // ag2's own price, 3200, beats the sell price above it.
    const own = row('ag2', { price: 3200 });
    expect(previewOf(move({ terms: [kept, own], sells: [sold('ma1', 3400)] })).own.belowNewFloor).toBe(0);
    expect(previewOf(move({ terms: [kept, row('ag2', { price: 3300 })] })).own.belowNewFloor).toBe(1);
  });

  it('ignores what the old parent charges: only the new chain sets the floor', () => {
    const terms = [row('pos1', { price: 3100 }), row('ag1', { price: 4000, renewalPrice: 4000 })];
    expect(previewOf(move({ terms, sells: [sold('ag1', 4100, 4100)] })).own.belowNewFloor).toBe(0);
  });

  it('judges each row against the columns of its own package', () => {
    const terms = [row('pos1', { price: 3100 }), row('pos1', { price: 3100 }, 'pb')];
    // alloha costs the new agent 3000, the heavy package 3200.
    expect(previewOf(move({ terms, packages: [alloha, heavy] })).own).toMatchObject({ customPrices: 2, belowNewFloor: 1 });
  });

  it('counts a row on a package it has no columns for, but cannot judge it', () => {
    const answer = previewOf(move({ terms: [row('pos1', { price: 1 }, 'gone')] }));
    expect(answer.own).toMatchObject({ customPrices: 1, belowNewFloor: 0 });
  });

  it('counts a hidden package and a stop without taking them for prices, and drops stops it does not know', () => {
    const answer = previewOf(move({
      moved: [node('pos1', 'pos', 'charge,bogus,transfer'), node('ag1', 'agent'), ma1, branch],
      terms: [row('pos1', { hidden: true }), row('pos1', { hidden: true, price: 3100 }, 'pb')],
      packages: [alloha, { ...heavy, agentPrice: 3000 }],
    }));
    expect(answer.own).toEqual({ customPrices: 1, hidden: 2, stops: 2, belowNewFloor: 0 });
  });

  it('counts only the rows written on the moved account', () => {
    const terms = [row('pos1', { price: 3100 }), row('pos9', { price: 100, hidden: true }), row('ag1', { hidden: true, price: 100 })];
    expect(previewOf(move({ terms })).own).toEqual({ customPrices: 1, hidden: 0, stops: 0, belowNewFloor: 0 });
  });

  it('does not touch what it is given', () => {
    const freeze = <T>(value: T): T => {
      if (value && typeof value === 'object') for (const inner of Object.values(value)) freeze(inner);
      return Object.freeze(value) as T;
    };
    const input = freeze(move({ terms: [row('pos1', { price: 2900 })], sells: [sold('ma1', 3300)] }));
    expect(() => previewOf(input)).not.toThrow();
  });
});

describe('previewOf: an agent moving between main agents', () => {
  const ag1 = node('ag1', 'agent', 'charge');
  const pos1 = node('pos1', 'pos', 'sim,esim');
  const pos3 = node('pos3', 'pos', 'transfer');
  // ag1 leaves ma1 for ma2 with pos1 and pos3.
  const move = (patch: Partial<Preview> = {}): Preview => ({
    moved: [ag1, ma1, branch],
    nextPath: [ag1, ma2, branch],
    children: [
      [pos1, ag1, ma2, branch],
      [pos3, ag1, ma2, branch],
    ],
    terms: [],
    sells: [],
    packages: [alloha],
    ...patch,
  });

  it('adds up the terms and stops of its points of sale and counts its own sell prices', () => {
    const answer = previewOf(move({
      terms: [
        row('pos1', { price: 3300 }),
        row('pos1', { hidden: true }, 'pb'),
        row('pos3', { hidden: true, renewalPrice: 3000 }),
        // A point of sale under another agent travels with nobody.
        row('pos2', { price: 3100, hidden: true }),
      ],
      sells: [sold('ag1', 3700), sold('ag1', 3900, 3500, 'pb'), sold('ag2', 3600)],
    }));
    expect(answer.child).toEqual({ customPrices: 2, hidden: 2, stops: 3, sellPrices: 2 });
  });

  it('holds its own prices to the main agent columns of the new parent', () => {
    // ma2 pays 2500 (renewal 2200) as a main agent.
    const prices = (patch: Partial<TermRow>) => previewOf(move({ terms: [row('ag1', patch)] })).own;
    expect(prices({ price: 2400 })).toEqual({ customPrices: 1, hidden: 0, stops: 1, belowNewFloor: 1 });
    expect(prices({ price: 2500, renewalPrice: 2200 }).belowNewFloor).toBe(0);
    expect(prices({ renewalPrice: 2100 }).belowNewFloor).toBe(1);
  });

  it('reads the floor from ma2 own price, not from ma1', () => {
    const terms = [row('ag1', { price: 2600 }), row('ma1', { price: 2000 }), row('ma2', { price: 2700 })];
    expect(previewOf(move({ terms })).own.belowNewFloor).toBe(1);
    expect(previewOf(move({ terms: terms.slice(0, 2) })).own.belowNewFloor).toBe(0);
  });

  it('still has a child section with no points of sale: its own sell prices go with the choice', () => {
    // The row of ag2 belongs to another agent and is not counted.
    const sells = [sold('ag1', 3700), sold('ag1', 3900, 3500, 'pb'), sold('ag2', 3600)];
    expect(previewOf(move({ children: [], sells })).child).toEqual({ customPrices: 0, hidden: 0, stops: 0, sellPrices: 2 });
  });

  it('counts nothing below an agent that has no points of sale and no sell prices', () => {
    expect(previewOf(move({ children: [] })).child).toEqual({ customPrices: 0, hidden: 0, stops: 0, sellPrices: 0 });
  });
});
