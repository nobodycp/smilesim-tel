import type { GrantCode } from './office-grants';
import {
  DESTINATION_LAYER,
  TRANSFER_GRANT,
  canTransfer,
  parseChoice,
  parseLineChoice,
  transferKind,
} from './transfer-rules';
import type { OpKey } from './user-terms';

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
