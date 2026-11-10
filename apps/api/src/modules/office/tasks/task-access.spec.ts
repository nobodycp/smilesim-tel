import { canHandleTasks, taskAudience, taskReaders, taskWhereFor } from './task-access';

const accounts = [
  { id: 'b1', parentId: null, layer: 'branch' },
  { id: 'b2', parentId: null, layer: 'branch' },
  { id: 'm1', parentId: 'b1', layer: 'main_agent' },
  { id: 'a1', parentId: 'm1', layer: 'agent' },
  { id: 'p1', parentId: 'a1', layer: 'pos' },
  { id: 'p2', parentId: 'a1', layer: 'pos' },
  { id: 'm2', parentId: 'b1', layer: 'main_agent' },
];

describe('task reading follows the number', () => {
  const task = { submitterId: 'a1', posId: 'p1' };

  it('lets the pos, its chain, the submitter, and every branch user read', () => {
    const readers = taskReaders(task, accounts);
    expect([...readers].sort()).toEqual(['a1', 'b1', 'b2', 'm1', 'p1']);
  });

  it('keeps a sibling pos and another main agent out', () => {
    const readers = taskReaders(task, accounts);
    expect(readers.has('p2')).toBe(false);
    expect(readers.has('m2')).toBe(false);
  });

  it('counts the submitter even when it sits outside the chain', () => {
    const readers = taskReaders({ submitterId: 'm2', posId: 'p1' }, accounts);
    expect(readers.has('m2')).toBe(true);
  });

  it('builds a list filter that is empty for the branch and scoped for the chain', () => {
    expect(taskWhereFor({ id: 'b2', layer: 'branch' }, accounts)).toEqual({});
    expect(taskWhereFor({ id: 'a1', layer: 'agent' }, accounts)).toEqual({
      OR: [{ submitterId: 'a1' }, { posId: { in: ['p1', 'p2'] } }],
    });
    expect(taskWhereFor({ id: 'p1', layer: 'pos' }, accounts)).toEqual({
      OR: [{ submitterId: 'p1' }, { posId: { in: ['p1'] } }],
    });
  });

  it('sends each task event to the side that needs it', () => {
    const open = { submitterId: 'a1', posId: 'p1', assigneeId: null };
    const held = { ...open, assigneeId: 'b1' };
    const handlers = ['b1', 'b2'];
    expect(taskAudience('opened', open, handlers)).toEqual(handlers);
    expect(taskAudience('released', held, handlers)).toEqual(handlers);
    expect(taskAudience('taken', held, handlers)).toEqual(['a1', 'p1']);
    expect(taskAudience('done', held, handlers)).toEqual(['a1', 'p1']);
    expect(taskAudience('rejected', held, handlers)).toEqual(['a1', 'p1']);
    expect(taskAudience('cancelled', held, handlers)).toEqual(['b1']);
    expect(taskAudience('cancelled', open, handlers)).toEqual(handlers);
    expect(taskAudience('note', held, handlers, { id: 'b1', handler: true })).toEqual(['a1', 'p1']);
    expect(taskAudience('note', held, handlers, { id: 'a1', handler: false })).toEqual(['b1']);
    expect(taskAudience('note', open, handlers, { id: 'p1', handler: false })).toEqual(handlers);
    expect(taskAudience('done', { submitterId: 'p1', posId: 'p1', assigneeId: 'b1' }, handlers)).toEqual(['p1']);
  });

  it('handles only from the branch with the grant or as owner', () => {
    expect(canHandleTasks({ layer: 'branch', isBranchOwner: true, grants: [] })).toBe(true);
    expect(canHandleTasks({ layer: 'branch', isBranchOwner: false, grants: ['tasks'] })).toBe(true);
    expect(canHandleTasks({ layer: 'branch', isBranchOwner: false, grants: ['read'] })).toBe(false);
    expect(canHandleTasks({ layer: 'main_agent', isBranchOwner: false, grants: ['tasks'] })).toBe(false);
  });
});
