import { holds } from './policy';
import { type AccountNode, visibleAccountIds } from './office-rules';

export type TaskSubject = { submitterId: string; posId: string };
export type Handler = { layer: string; isBranchOwner: boolean; grants: string[] };

/** Who reads a task: its submitter, the point of sale, the chain above it, and every branch user. */
export function taskReaders(task: TaskSubject, accounts: AccountNode[]): Set<string> {
  const byId = new Map(accounts.map((node) => [node.id, node]));
  const readers = new Set<string>([task.submitterId]);
  for (const node of accounts) if (node.layer === 'branch') readers.add(node.id);
  let cursor: AccountNode | undefined = byId.get(task.posId);
  while (cursor) {
    readers.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return readers;
}

/** Prisma `where` that lists the tasks an actor may read. The branch reads everything. */
export function taskWhereFor(actor: { id: string; layer: string }, accounts: AccountNode[]) {
  if (actor.layer === 'branch') return {};
  const visible = visibleAccountIds(actor.id, actor.layer, accounts);
  const posIds = accounts.filter((node) => node.layer === 'pos' && visible.has(node.id)).map((node) => node.id);
  return { OR: [{ submitterId: actor.id }, { posId: { in: posIds } }] };
}

/** Handling (take, release, complete, reject) stays with the branch owner and the `tasks` grant. */
export function canHandleTasks(actor: Handler): boolean {
  return holds(actor, 'tasks');
}

/** The chain side of a task: its submitter and the point of sale that owns the number. */
export function chainSide(task: TaskSubject): string[] {
  return [...new Set([task.submitterId, task.posId])];
}

export type TaskEvent = 'opened' | 'taken' | 'released' | 'note' | 'done' | 'rejected' | 'cancelled';

/**
 * Who hears about a task event. `handlers` are the branch users who may take tasks.
 * A note goes to the other side of the conversation. The caller removes the actor.
 */
export function taskAudience(
  event: TaskEvent,
  task: TaskSubject & { assigneeId: string | null },
  handlers: string[],
  author?: { id: string; handler: boolean },
): string[] {
  if (event === 'opened' || event === 'released') return handlers;
  if (event === 'taken' || event === 'done' || event === 'rejected') return chainSide(task);
  if (event === 'cancelled') return task.assigneeId ? [task.assigneeId] : handlers;
  if (author?.handler) return chainSide(task);
  return task.assigneeId ? [task.assigneeId] : handlers;
}
