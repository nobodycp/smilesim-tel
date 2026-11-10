import type { Action } from '../kernel/types';
import { TASK_STATUSES } from '../rules/office-paging';
import { queryCursor, queryOneOf, queryText } from '../../shared/schemas';
import { z } from 'zod';

/** The longest note or refusal reason written on a task. */
export const TASK_NOTE_MAX = 2000;

/** An inspection note. `internal` is the branch's own note, which only the branch may write and read. */
export const TaskNoteBody = z.object({
  text: z.string().trim().min(1).max(TASK_NOTE_MAX),
  internal: z.boolean().optional().default(false),
});
export type TaskNoteBody = z.input<typeof TaskNoteBody>;

export const TaskRejectBody = z.object({ reason: z.string().trim().min(1).max(TASK_NOTE_MAX) });
export type TaskRejectBody = z.input<typeof TaskRejectBody>;

/** The operations a task may carry (`Action` in kernel/types.ts). */
const TASK_ACTIONS = ['activate', 'charge', 'extend', 'reactivate', 'disconnect', 'freeze', 'unfreeze', 'switch', 'rename', 'sim', 'esim', 'refresh', 'addon'] as const satisfies readonly Action[];

/** GET tasks — the filters of the tasks list. */
export const TasksQuery = z.object({
  cursor: queryCursor,
  q: queryText(),
  status: queryOneOf(TASK_STATUSES),
  action: queryOneOf(TASK_ACTIONS),
  packageCode: queryText(),
  company: queryText(),
  provider: queryText(),
});
export type TasksQuery = z.input<typeof TasksQuery>;
