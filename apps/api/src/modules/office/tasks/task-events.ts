import { parseTaskLogLine } from '../task-log';

// What happened on a task, newest first, as its page shows it. Pure.

export type TaskEventView = {
  id: string;
  kind: 'system' | 'note' | 'result';
  /** An internal note: the branch only. */
  internal?: boolean;
  body: string;
  authorName: string | null;
  at: string;
};

type Named = { nickname: string | null; loginName: string };
type TaskWithNotes = {
  createdAt: Date;
  updatedAt: Date;
  assignee: Named | null;
  notes: { id: string; internal: boolean; body: string; createdAt: Date; author: Named }[];
};

/**
 * The task's log lines (pass an empty log for a reader who is not a handler), its notes, and its result, as one
 * list. The caller has already left out the notes this reader may not see.
 */
export function taskEvents(task: TaskWithNotes, log: string, resultNote: string | null): TaskEventView[] {
  const events: TaskEventView[] = [];
  log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const parsed = parseTaskLogLine(line, task.createdAt.toISOString());
      events.push({ id: `log-${String(index).padStart(4, '0')}`, kind: 'system', body: parsed.body, authorName: null, at: parsed.at });
    });
  for (const note of task.notes) {
    events.push({
      id: note.id,
      kind: 'note',
      ...(note.internal ? { internal: true } : {}),
      body: note.body,
      authorName: note.author.nickname || note.author.loginName,
      at: note.createdAt.toISOString(),
    });
  }
  if (resultNote) {
    events.push({ id: 'result', kind: 'result', body: resultNote, authorName: task.assignee?.nickname || task.assignee?.loginName || null, at: task.updatedAt.toISOString() });
  }
  return events.sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
}
